begin;
grant insert (household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,active),
 update (name,category_id,amount,amount_type,interval_months,due_day,start_month,active)
 on public.recurring_items to authenticated;
create policy create_own_recurring on public.recurring_items for insert to authenticated
 with check (household_id=(select hh_private.my_household()));
create policy update_own_recurring on public.recurring_items for update to authenticated
 using (household_id=(select hh_private.my_household()))
 with check (household_id=(select hh_private.my_household()));

-- A past start month sets the cadence, not a request to invent historical bills.
alter table public.recurring_items add column posting_from_month date;
update public.recurring_items r set posting_from_month=date_trunc('month',now() at time zone h.timezone)::date
 from public.households h where h.id=r.household_id;
alter table public.recurring_items alter column posting_from_month set not null;
create function hh_private.recurring_activation() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or (new.active and not old.active) or
     (new.start_month,new.interval_months) is distinct from (old.start_month,old.interval_months) then
    select date_trunc('month',now() at time zone h.timezone)::date into new.posting_from_month
      from public.households h where h.id=new.household_id;
  end if;
  return new;
end $$;
create trigger recurring_activation before insert or update of active,start_month,interval_months on public.recurring_items
 for each row execute function hh_private.recurring_activation();

create function hh_private.post_recurring_at(p_now timestamptz) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; m date; due date; first_month date; posted integer:=0; affected integer;
begin
  for item in select r.*,(p_now at time zone h.timezone)::date as local_day
    from public.recurring_items r join public.households h on h.id=r.household_id
    where r.active order by r.id for update of r
  loop
    first_month:=greatest(item.start_month,item.posting_from_month,
      (item.last_posted_month + interval '1 month')::date);
    for m in select generate_series(first_month::timestamp,date_trunc('month',item.local_day::timestamp),interval '1 month')::date
    loop
      if ((extract(year from m)::int-extract(year from item.start_month)::int)*12
        +extract(month from m)::int-extract(month from item.start_month)::int) % item.interval_months <> 0 then continue; end if;
      due:=least(m+item.due_day-1,(m+interval '1 month')::date-1);
      if due>item.local_day then continue; end if;
      insert into public.expenses(household_id,category_id,description,spent_on,amount_sgd,original_amount,
        recurring_item_id,is_fixed,sgd_confirmed) values(item.household_id,item.category_id,item.name,due,
        item.amount,item.amount,item.id,true,item.amount_type='fixed') on conflict do nothing;
      get diagnostics affected=row_count;
      posted:=posted+affected;
      update public.recurring_items set last_posted_month=m where id=item.id;
    end loop;
  end loop;
  return posted;
end $$;
create table hh_private.recurring_job_key (
  singleton boolean primary key check(singleton),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','')
);
alter table hh_private.recurring_job_key enable row level security;
revoke all on hh_private.recurring_job_key from public,anon,authenticated;
insert into hh_private.recurring_job_key(singleton) values(true);

create function public.post_due_recurring(job_secret text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select from hh_private.recurring_job_key where secret=job_secret) then
    raise exception 'Invalid scheduler credential' using errcode='42501';
  end if;
  return hh_private.post_recurring_at(now());
end $$;
revoke all on function hh_private.post_recurring_at(timestamptz),hh_private.recurring_activation(),
 public.post_due_recurring(text) from public,anon,authenticated,service_role;
grant execute on function public.post_due_recurring(text) to service_role;
commit;
