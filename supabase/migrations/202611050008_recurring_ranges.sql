begin;
alter table public.recurring_items add column ends_on date;
alter table public.recurring_items add constraint valid_recurring_range check
 (ends_on is null or ends_on >= least(start_month+due_day-1,(start_month+interval '1 month')::date-1));
grant insert (id,ends_on), update (ends_on) on public.recurring_items to authenticated;

create or replace function hh_private.recurring_activation() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and new.ends_on is not null then
    new.posting_from_month:=new.start_month;
  elsif tg_op='INSERT' or (new.active and not old.active) or
     (new.start_month,new.interval_months) is distinct from (old.start_month,old.interval_months) then
    select date_trunc('month',now() at time zone h.timezone)::date into new.posting_from_month
      from public.households h where h.id=new.household_id;
  end if;
  return new;
end $$;
create or replace function hh_private.post_recurring_at(p_now timestamptz) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; m date; due date; first_month date; posted integer:=0; affected integer;
begin
  for item in select r.*,(p_now at time zone h.timezone)::date as local_day
    from public.recurring_items r join public.households h on h.id=r.household_id
    where r.active order by r.id for update of r
  loop
    first_month:=greatest(item.start_month,item.posting_from_month,
      (item.last_posted_month + interval '1 month')::date);
    for m in select generate_series(first_month::timestamp,date_trunc('month',least(item.local_day,coalesce(item.ends_on,item.local_day))::timestamp),interval '1 month')::date
    loop
      if ((extract(year from m)::int-extract(year from item.start_month)::int)*12
        +extract(month from m)::int-extract(month from item.start_month)::int) % item.interval_months <> 0 then continue; end if;
      due:=least(m+item.due_day-1,(m+interval '1 month')::date-1);
      if due>item.local_day or due>item.ends_on then continue; end if;
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
create or replace function hh_private.month_summary_at(p_household uuid,p_month date,p_today date)
returns jsonb language sql stable security invoker set search_path = '' as $$
with bounds as (
  select date_trunc('month',p_month)::date as first_day,
   (date_trunc('month',p_month) + interval '1 month')::date as next_month
), period as (
  select *, least(greatest(p_today,first_day),next_month-1) as anchor from bounds
), due as (
  select r.*,least(first_day+r.due_day-1,next_month-1) as due_on
  from public.recurring_items r cross join period
  where r.household_id=p_household and r.active and r.start_month <= first_day
    and (r.ends_on is null or least(first_day+r.due_day-1,next_month-1)<=r.ends_on)
    and ((extract(year from first_day)::int-extract(year from r.start_month)::int)*12
       +extract(month from first_day)::int-extract(month from r.start_month)::int) % r.interval_months = 0
), fixed as (
  select d.id,d.name,d.due_on,coalesce(e.amount_sgd,d.amount) as amount,
    e.id is not null as posted,coalesce(e.sgd_confirmed,false) as confirmed
  from due d cross join period p left join public.expenses e
   on e.recurring_item_id=d.id and e.household_id=d.household_id and e.is_fixed and e.trip_id is null
    and e.spent_on>=p.first_day and e.spent_on<p.next_month
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
