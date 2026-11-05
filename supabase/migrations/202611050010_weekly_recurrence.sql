begin;
-- Zero denotes a weekly cadence; positive values remain intervals in months.
alter table public.recurring_items drop constraint recurring_items_interval_months_check,
  add check (interval_months in (0,1,3,6,12)), add column last_weekly_on date,
  add column skipped_dates date[] not null default '{}', add column stop_from_date date;
alter table public.expenses add column occurrence_on date;
drop index public.expenses_recurring_month;
create unique index expenses_recurring_month on public.expenses
  (recurring_item_id,date_trunc('month',spent_on::timestamp)) where recurring_item_id is not null and occurrence_on is null;
create unique index expenses_weekly_occurrence on public.expenses(recurring_item_id,occurrence_on)
  where occurrence_on is not null;
create function hh_private.weekly_dates(start_month date,day_number integer,lower_bound date,upper_bound date)
returns setof date language sql immutable set search_path='' as $$
  with anchor as (select least(start_month+day_number-1,(start_month+interval '1 month')::date-1) as d)
  select d+7*n from anchor cross join lateral generate_series(
    (greatest(lower_bound-d,0)+6)/7,(upper_bound-d)/7) n where d+7*n<=upper_bound
$$;
revoke all on function hh_private.weekly_dates(date,integer,date,date) from public,anon,authenticated;
grant execute on function hh_private.weekly_dates(date,integer,date,date) to authenticated;
-- For weekly bills a resumed schedule starts on the day it resumes, so it
-- cannot backfill earlier weeks from the same month while it was paused.
create or replace function hh_private.recurring_activation() returns trigger language plpgsql set search_path='' as $$
declare local_day date;
begin
  if tg_op='INSERT' and new.ends_on is not null then
    new.posting_from_month:=new.start_month;
  elsif tg_op='INSERT' or (new.active and not old.active) or
    (new.start_month,new.interval_months) is distinct from (old.start_month,old.interval_months) then
    select (now() at time zone h.timezone)::date into local_day from public.households h where h.id=new.household_id;
    new.posting_from_month:=case when new.interval_months=0 then local_day else date_trunc('month',local_day)::date end;
  end if;
  return new;
end $$;
create function hh_private.protect_posted_cadence() returns trigger language plpgsql set search_path='' as $$
begin
  if (old.interval_months=0)<>(new.interval_months=0) and
    (old.last_weekly_on is not null or old.last_posted_month is not null or old.stop_from_month is not null
      or old.stop_from_date is not null or cardinality(old.skipped_months)+cardinality(old.skipped_dates)>0)
    then raise exception 'Create a new series to switch between weekly and monthly schedules after posting'; end if;
  return new;
end $$;
revoke all on function hh_private.protect_posted_cadence() from public,anon,authenticated;
create trigger protect_posted_cadence before update of interval_months on public.recurring_items
 for each row execute function hh_private.protect_posted_cadence();
create or replace function public.delete_recurring_entry(p_entry uuid,p_version timestamptz,p_scope text)
returns integer language plpgsql security definer set search_path='' as $$
declare weekly boolean; h uuid:=hh_private.my_household(); series uuid; e public.expenses%rowtype; m date; cutoff date; n integer;
begin
  if h is null or p_scope is null or p_scope not in ('one','future','including') then raise exception 'Invalid deletion request'; end if;
  select recurring_item_id into series from public.expenses where household_id=h and id=p_entry and is_fixed;
  -- Match the posting worker's lock order: series first, then expenses.
  select interval_months=0 into weekly from public.recurring_items where household_id=h and id=series for update;
  if not found then raise exception 'Recurring entry is unavailable'; end if;
  select * into e from public.expenses where household_id=h and id=p_entry and recurring_item_id=series
    and updated_at=p_version for update;
  if not found then raise exception 'Entry changed. Reopen it and try again.'; end if;
  m:=date_trunc('month',e.spent_on)::date;
  if weekly then
    if e.occurrence_on is null then raise exception 'Missing weekly occurrence date'; end if;
    if p_scope='one' then
      update public.recurring_items set skipped_dates=array_append(skipped_dates,e.occurrence_on)
        where id=series and not (e.occurrence_on=any(skipped_dates));
      delete from public.expenses where id=e.id and household_id=h;
    else
      cutoff:=e.occurrence_on+case when p_scope='future' then 1 else 0 end;
      update public.recurring_items set stop_from_date=least(stop_from_date,cutoff) where id=series;
      delete from public.expenses where household_id=h and recurring_item_id=series and occurrence_on>=cutoff;
    end if;
  elsif p_scope='one' then
    update public.recurring_items set skipped_months=array_append(skipped_months,m)
      where id=series and not (m=any(skipped_months));
    delete from public.expenses where id=p_entry and household_id=h;
  else
    cutoff:=case when p_scope='future' then (m+interval '1 month')::date else m end;
    update public.recurring_items set stop_from_month=least(stop_from_month,cutoff) where id=series;
    delete from public.expenses where household_id=h and recurring_item_id=series and spent_on>=cutoff;
  end if;
  get diagnostics n=row_count;
  return n;
end $$;
create or replace function hh_private.post_recurring_at(p_now timestamptz) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; m date; due date; first_month date; posted integer:=0; affected integer;
begin
  for item in select r.*,(p_now at time zone h.timezone)::date as local_day
    from public.recurring_items r join public.households h on h.id=r.household_id
    where r.active and r.interval_months>0 order by r.id for update of r
  loop
    first_month:=greatest(item.start_month,item.posting_from_month,
      (item.last_posted_month + interval '1 month')::date);
    for m in select generate_series(first_month::timestamp,date_trunc('month',least(item.local_day,coalesce(item.ends_on,item.local_day),coalesce(item.stop_from_month-1,item.local_day))::timestamp),interval '1 month')::date
    loop
      if ((extract(year from m)::int-extract(year from item.start_month)::int)*12
        +extract(month from m)::int-extract(month from item.start_month)::int) % item.interval_months <> 0 then continue; end if;
      due:=least(m+item.due_day-1,(m+interval '1 month')::date-1);
      if m=any(item.skipped_months) or due>item.local_day or due>item.ends_on then continue; end if;
      insert into public.expenses(household_id,category_id,description,spent_on,amount_sgd,original_amount,
        recurring_item_id,is_fixed,sgd_confirmed) values(item.household_id,item.category_id,item.name,due,
        item.amount,item.amount,item.id,true,item.amount_type='fixed') on conflict do nothing;
      get diagnostics affected=row_count;
      posted:=posted+affected;
      update public.recurring_items set last_posted_month=m where id=item.id;
    end loop;
  end loop;
  for item in select r.*,(p_now at time zone h.timezone)::date as local_day
    from public.recurring_items r join public.households h on h.id=r.household_id
    where r.active and r.interval_months=0 order by r.id for update of r
  loop
    for due in select * from hh_private.weekly_dates(item.start_month,item.due_day,
      greatest(item.posting_from_month,item.last_weekly_on+1),least(item.local_day,item.ends_on,item.stop_from_date-1))
    loop
      if not (due=any(item.skipped_dates)) then
        insert into public.expenses(household_id,category_id,description,spent_on,amount_sgd,original_amount,
          recurring_item_id,occurrence_on,is_fixed,sgd_confirmed) values(item.household_id,item.category_id,item.name,due,
          item.amount,item.amount,item.id,due,true,item.amount_type='fixed') on conflict do nothing;
        get diagnostics affected=row_count;
        posted:=posted+affected;
      end if;
      update public.recurring_items set last_weekly_on=due where id=item.id;
    end loop;
  end loop;
  return posted;
end $$;
create or replace function hh_private.month_summary_at(p_household uuid,p_month date,p_today date)
returns jsonb language sql stable security invoker set search_path = '' as $$
with bounds as (
  select date_trunc('month',p_month)::date as first_day,
   (date_trunc('month',p_month) + interval '1 month')::date as next_month
), period as (
  select *, least(greatest(p_today,first_day),next_month-1) as anchor from bounds
), due as (
  select r.id,r.name,r.amount,false as weekly,least(first_day+r.due_day-1,next_month-1) as due_on
  from public.recurring_items r cross join period
  where r.household_id=p_household and r.active and r.interval_months>0 and r.start_month <= first_day
    and not (first_day=any(r.skipped_months)) and (r.stop_from_month is null or first_day<r.stop_from_month)
    and (r.ends_on is null or least(first_day+r.due_day-1,next_month-1)<=r.ends_on)
    and ((extract(year from first_day)::int-extract(year from r.start_month)::int)*12
       +extract(month from first_day)::int-extract(month from r.start_month)::int) % nullif(r.interval_months,0) = 0
  union all
  select r.id,r.name,r.amount,true,w.due_on from public.recurring_items r cross join period
  cross join lateral hh_private.weekly_dates(r.start_month,r.due_day,first_day,least(next_month-1,r.ends_on,r.stop_from_date-1)) w(due_on)
  where r.household_id=p_household and r.active and r.interval_months=0 and not(w.due_on=any(r.skipped_dates))
), fixed as (
  select d.id,d.name,d.due_on,coalesce(e.amount_sgd,d.amount) as amount,
    e.id is not null as posted,coalesce(e.sgd_confirmed,false) as confirmed
  from due d cross join period p left join public.expenses e
   on e.recurring_item_id=d.id and e.household_id=p_household and e.is_fixed and e.trip_id is null
    and ((d.weekly and e.occurrence_on=d.due_on) or (not d.weekly and e.occurrence_on is null and e.spent_on>=p.first_day and e.spent_on<p.next_month))
), reserved as (
  select coalesce(sum(amount),0) as fixed_costs,
    coalesce(jsonb_agg(to_jsonb(fixed) order by due_on,name,id),'[]'::jsonb) as fixed_items from fixed
), spending as (
  select coalesce(sum(amount_sgd),0) as day_to_day_spent,
   coalesce(sum(amount_sgd) filter (where spent_on<p.anchor),0) as spent_before,
   coalesce(sum(amount_sgd) filter (where spent_on=p.anchor),0) as spent_today
  from public.expenses e cross join period p where e.household_id=p_household
   and not e.is_fixed and e.trip_id is null and e.spent_on>=p.first_day and e.spent_on<p.next_month
), budget as (
  select h.monthly_budget,p.first_day as month,p_today as today,p.next_month-p.anchor as days_left,
   r.fixed_costs,r.fixed_items,s.day_to_day_spent,s.spent_today,
   h.monthly_budget-r.fixed_costs-s.day_to_day_spent as remaining,
   greatest(h.monthly_budget-r.fixed_costs-s.spent_before,0)/(p.next_month-p.anchor) as daily_budget
  from public.households h cross join period p cross join reserved r cross join spending s
  where h.id=p_household
)
select to_jsonb(b)||jsonb_build_object('left_today',daily_budget-spent_today) from budget b
$$;
commit;
