begin;

create schema if not exists hh_private;
revoke all on schema hh_private from public;
grant usage on schema hh_private to authenticated;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  base_currency text not null default 'SGD' check (base_currency = 'SGD'),
  timezone text not null default 'Asia/Singapore',
  monthly_budget numeric(16,2) not null check (monthly_budget >= 0 and monthly_budget <> 'NaN'::numeric),
  invite_code text unique not null default upper(left(replace(gen_random_uuid()::text,'-',''),8)),
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  email text not null,
  joined_at timestamptz not null default now()
);
create index members_household on public.members(household_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null check (color ~ '^#[[:xdigit:]]{6}$'),
  icon text not null check (icon ~ '^[a-z][a-z0-9-]{0,63}$'),
  sort_order integer not null default 0,
  archived boolean not null default false,
  unique (household_id,id)
);

-- Create the links used in the budgeting contract before the Phase 3 editors.
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  start_date date not null, end_date date not null check (end_date >= start_date),
  budget numeric(16,2) check (budget >= 0 and budget <> 'NaN'::numeric),
  archived boolean not null default false,
  unique (household_id,id)
);
create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  category_id uuid not null,
  amount numeric(16,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  amount_type text not null check (amount_type in ('fixed','variable')),
  interval_months integer not null default 1 check (interval_months in (1,3,6,12)),
  due_day integer not null check (due_day between 1 and 31),
  start_month date not null check (extract(day from start_month) = 1),
  active boolean not null default true,
  last_posted_month date check (extract(day from last_posted_month) = 1),
  foreign key (household_id,category_id) references public.categories(household_id,id),
  unique (household_id,id)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  category_id uuid not null,
  description text not null default '' check (length(description) <= 500),
  spent_on date not null,
  amount_sgd numeric(16,2) not null check (amount_sgd > 0 and amount_sgd <> 'NaN'::numeric),
  original_currency text not null default 'SGD' check (original_currency ~ '^[A-Z]{3}$'),
  original_amount numeric(20,4) not null check (original_amount > 0 and original_amount <> 'NaN'::numeric),
  fx_rate_estimate numeric(24,12) check (fx_rate_estimate > 0 and fx_rate_estimate <> 'NaN'::numeric),
  sgd_confirmed boolean not null default true,
  trip_id uuid, recurring_item_id uuid, is_fixed boolean not null default false,
  check (original_currency = 'SGD' or fx_rate_estimate is not null),
  foreign key (household_id,category_id) references public.categories(household_id,id),
  foreign key (household_id,trip_id) references public.trips(household_id,id),
  foreign key (household_id,recurring_item_id) references public.recurring_items(household_id,id)
);
create index expenses_month on public.expenses(household_id,spent_on desc);
create index expenses_category on public.expenses(household_id,category_id,spent_on desc);
create index expenses_unconfirmed on public.expenses(household_id) where not sgd_confirmed;
create unique index expenses_recurring_month on public.expenses
 (recurring_item_id, date_trunc('month',spent_on::timestamp)) where recurring_item_id is not null;

create table public.fx_rates (
  date date not null, base text not null, rates jsonb not null check (jsonb_typeof(rates)='object'),
  primary key (date,base)
);

create function hh_private.my_household() returns uuid
language sql stable security definer set search_path = ''
as $$ select household_id from public.members where user_id = (select auth.uid()) $$;
revoke all on function hh_private.my_household() from public;
grant execute on function hh_private.my_household() to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.trips enable row level security;
alter table public.recurring_items enable row level security;
alter table public.expenses enable row level security;
alter table public.fx_rates enable row level security;
revoke all on public.households, public.members, public.categories, public.expenses,
 public.trips, public.recurring_items, public.fx_rates from public,anon,authenticated;
grant select on public.households,public.members,public.categories,public.expenses,
 public.trips,public.recurring_items to authenticated;
grant update (name,monthly_budget) on public.households to authenticated;
grant insert (household_id,name,color,icon,sort_order,archived),
 update (name,color,icon,sort_order,archived) on public.categories to authenticated;
grant insert (id,household_id,category_id,description,spent_on,amount_sgd,original_currency,
 original_amount,fx_rate_estimate,sgd_confirmed,trip_id),
 update (category_id,description,spent_on,amount_sgd,original_currency,original_amount,
 fx_rate_estimate,sgd_confirmed,trip_id), delete on public.expenses to authenticated;
grant select,insert,update on public.fx_rates to service_role;

create policy own_household on public.households for all to authenticated
 using (id = (select hh_private.my_household())) with check (id = (select hh_private.my_household()));
create policy own_members on public.members for select to authenticated
 using (household_id = (select hh_private.my_household()));
create policy own_categories on public.categories for all to authenticated
 using (household_id = (select hh_private.my_household())) with check (household_id = (select hh_private.my_household()));
create policy own_expenses on public.expenses for all to authenticated
 using (household_id = (select hh_private.my_household())) with check (household_id = (select hh_private.my_household()));
create policy own_trips on public.trips for select to authenticated
 using (household_id = (select hh_private.my_household()));
create policy own_recurring on public.recurring_items for select to authenticated
 using (household_id = (select hh_private.my_household()));

create function hh_private.stamp_expense() returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger expense_audit before insert or update on public.expenses
 for each row execute function hh_private.stamp_expense();

create function hh_private.enrol(p_household uuid,p_name text) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.members(user_id,household_id,display_name,email)
  select u.id,p_household,trim(p_name),u.email from auth.users u where u.id=auth.uid();
  if not found then raise exception 'Sign in again to continue'; end if;
end
$$;
revoke all on function hh_private.enrol(uuid,text) from public,anon,authenticated;

create function public.create_household(p_name text,p_display_name text,p_monthly_budget numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.households(name,monthly_budget) values(trim(p_name),p_monthly_budget) returning id into h;
  perform hh_private.enrol(h,p_display_name);
  insert into public.categories(household_id,sort_order,name,icon,color)
  select h,ord,name,icon,color from (values
   (1,'Shopping','shopping-bag','#8059AD'),(2,'Communication','phone','#376BB3'),
   (3,'Food & drink','tools-kitchen-2','#B75B25'),(4,'Education','book','#5260AD'),
   (5,'Entertainment','movie','#92549F'),(6,'Grocery','basket','#3C8052'),
   (7,'Occasional (gift)','gift','#AF5472'),(8,'House','home','#957029'),
   (9,'Pet','cat','#AA6E16'),(10,'Sport','ball-volleyball','#258078'),
   (11,'Transport','taxi','#267C91'),(12,'Travel','plane','#367EAD'),
   (13,'Health','heartbeat','#B04F50'),(14,'Family','users-group','#865B8C')
  ) as starter(ord,name,icon,color);
  return h;
end $$;

create function public.join_household(p_invite_code text,p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into h from public.households where invite_code=upper(trim(p_invite_code));
  if h is null then raise exception 'Invalid household invite code'; end if;
  perform hh_private.enrol(h,p_display_name);
  return h;
end $$;

create function public.reorder_categories(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare active_ids uuid[];
begin
  select array_agg(id order by id) into active_ids from public.categories where not archived;
  if (select array_agg(x order by x) from unnest(p_ids) as u(x)) is distinct from active_ids
    then raise exception 'Category list changed. Refresh and retry.'; end if;
  update public.categories c set sort_order = pos
   from unnest(p_ids) with ordinality as u(id,pos) where c.id=u.id;
end $$;

create function public.category_usage() returns table(category_id uuid, uses bigint)
language sql stable security invoker set search_path = '' as $$
  select c.id,count(e.id) from public.categories c left join public.expenses e on e.category_id=c.id
  where not c.archived group by c.id order by count(e.id) desc,c.sort_order,c.name,c.id
$$;
create function public.category_suggestions(p_category_id uuid) returns table(description text)
language sql stable security invoker set search_path = '' as $$
  with recent as (
    select trim(e.description) as label,lower(trim(e.description)) as norm,e.spent_on,e.created_at,e.id
    from public.expenses e join public.households h on h.id=e.household_id
    where e.category_id=p_category_id and trim(e.description)<>''
    and e.spent_on between (now() at time zone h.timezone)::date-179 and (now() at time zone h.timezone)::date
  ), ranked as (
    select *,count(*) over(partition by norm) as uses,
      row_number() over(partition by norm order by spent_on desc,created_at desc,id desc) as latest
    from recent
  )
  select label from ranked where latest=1 order by uses desc,spent_on desc,created_at desc,norm limit 3
$$;

revoke all on function public.create_household(text,text,numeric),public.join_household(text,text),
 public.reorder_categories(uuid[]),public.category_usage(),public.category_suggestions(uuid)
 from public,anon,authenticated;
grant execute on function public.create_household(text,text,numeric),public.join_household(text,text),
 public.reorder_categories(uuid[]),public.category_usage(),public.category_suggestions(uuid) to authenticated;
commit;
