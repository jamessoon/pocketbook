begin;
create table hh_private.widget_keys (
  household_id uuid primary key references public.households(id) on delete cascade,
  token text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','')
);
alter table hh_private.widget_keys enable row level security;
revoke all on hh_private.widget_keys from public,anon,authenticated;

create function public.get_widget_token() returns text
language plpgsql security definer set search_path='' as $$
declare h uuid := hh_private.my_household(); result text;
begin
  if h is null then raise exception 'Join a household first'; end if;
  insert into hh_private.widget_keys(household_id) values(h) on conflict do nothing;
  select token into strict result from hh_private.widget_keys where household_id=h;
  return result;
end $$;

create function public.rotate_widget_token() returns text
language plpgsql security definer set search_path='' as $$
declare h uuid := hh_private.my_household(); result text;
begin
  if h is null then raise exception 'Join a household first'; end if;
  insert into hh_private.widget_keys(household_id) values(h)
  on conflict(household_id) do update set token=excluded.token returning token into result;
  return result;
end $$;

create function hh_private.widget_home(p_token text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare h uuid;
begin
  if length(p_token)=64 then
    select household_id into h from hh_private.widget_keys where token=p_token;
  end if;
  if h is null then raise exception 'Widget token is invalid. Copy a new script from Settings.' using errcode='42501'; end if;
  return h;
end $$;

create function public.widget_summary(token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid := hh_private.widget_home(token); d date; summary jsonb; spent numeric; recent jsonb;
begin
  select (now() at time zone timezone)::date into d from public.households where id=h;
  summary := hh_private.month_summary_at(h,d,d);
  select coalesce(sum(amount_sgd),0) into spent from public.expenses
    where household_id=h and trip_id is null and spent_on>=date_trunc('month',d)::date
      and spent_on<(date_trunc('month',d)+interval '1 month')::date;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.spent_on desc,r.created_at desc,r.id desc),'[]') into recent from
    (select e.id,e.spent_on,e.created_at,coalesce(nullif(e.description,''),c.name) as label,e.amount_sgd
     from public.expenses e join public.categories c on c.id=e.category_id
     where e.household_id=h and not e.is_fixed and e.trip_id is null and e.spent_on<=d
     order by e.spent_on desc,e.created_at desc,e.id desc limit 3) r;
  return jsonb_build_object('month',summary->'month','monthly_budget',summary->'monthly_budget',
    'daily_budget',summary->'daily_budget','left_today',summary->'left_today','spent',spent,'recent',recent);
end $$;

create function public.widget_categories(token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid := hh_private.widget_home(token);
begin
  return (select coalesce(jsonb_agg(to_jsonb(r) order by uses desc,sort_order,name,id),'[]') from
    (select c.id,c.name,c.icon,c.color,c.sort_order,count(e.id) as uses from public.categories c
     left join public.expenses e on e.category_id=c.id and e.household_id=h
     where c.household_id=h and not c.archived group by c.id
     order by uses desc,c.sort_order,c.name,c.id limit 8) r);
end $$;

create function public.widget_suggestions(token text,category_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid := hh_private.widget_home(token);
begin
  if not exists(select from public.categories where id=category_id and household_id=h and not archived)
    then raise exception 'Category is unavailable'; end if;
  return (select coalesce(jsonb_agg(label order by uses desc,last_day desc,last_time desc,norm),'[]') from
    (select lower(trim(e.description)) as norm,
      (array_agg(trim(e.description) order by e.spent_on desc,e.created_at desc,e.id desc))[1] as label,
      count(*) as uses,max(e.spent_on) as last_day,
      (array_agg(e.created_at order by e.spent_on desc,e.created_at desc,e.id desc))[1] as last_time
     from public.expenses e join public.households hh on hh.id=e.household_id
     where e.household_id=h and e.category_id=$2 and trim(e.description)<>'' and
       e.spent_on between (now() at time zone hh.timezone)::date-179 and (now() at time zone hh.timezone)::date
     group by lower(trim(e.description)) order by uses desc,last_day desc,last_time desc,norm limit 3) r);
end $$;

create function public.widget_add_expense(token text,category_id uuid,amount numeric,description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid := hh_private.widget_home(token); result uuid;
begin
  if amount is null or amount<=0 or amount>9999999999.99 or amount<>round(amount,2)
     or length(trim(description))>500 then raise exception 'Enter a valid SGD amount and description'; end if;
  perform 1 from public.categories where id=category_id and household_id=h and not archived for share;
  if not found then raise exception 'Category is unavailable'; end if;
  insert into public.expenses(household_id,category_id,description,spent_on,amount_sgd,original_amount)
    select h,$2,trim(coalesce($4,'')),(now() at time zone timezone)::date,$3,$3 from public.households where id=h
    returning id into result;
  return result;
end $$;

revoke all on function hh_private.widget_home(text), public.get_widget_token(),public.rotate_widget_token(),
 public.widget_summary(text),public.widget_categories(text),public.widget_suggestions(text,uuid),
 public.widget_add_expense(text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.get_widget_token(), public.rotate_widget_token() to authenticated;
grant execute on function public.widget_summary(text),public.widget_categories(text),
 public.widget_suggestions(text,uuid),public.widget_add_expense(text,uuid,numeric,text) to anon;
commit;
