begin;
alter table public.recurring_items add column deleted_at timestamptz,
  add check (deleted_at is null or not active);
alter policy update_own_recurring on public.recurring_items
  using (household_id=(select hh_private.my_household()) and deleted_at is null)
  with check (household_id=(select hh_private.my_household()) and deleted_at is null);

-- Keep the series identity and description for posted expenses and confirmations.
create function public.delete_recurring_bill(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid := hh_private.my_household();
begin
  update public.recurring_items set active=false,deleted_at=coalesce(deleted_at,now())
    where id=p_id and household_id=h;
  if not found then raise exception 'Bill is unavailable.'; end if;
end $$;
revoke all on function public.delete_recurring_bill(uuid) from public,anon,authenticated;
grant execute on function public.delete_recurring_bill(uuid) to authenticated;
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
  union all
  select r.id,r.name,coalesce(e.occurrence_on,e.spent_on) as due_on,e.amount_sgd,true,e.sgd_confirmed
    from public.expenses e join public.recurring_items r on r.id=e.recurring_item_id and r.household_id=e.household_id
    cross join period p where r.household_id=p_household and r.deleted_at is not null
    and e.is_fixed and e.trip_id is null and e.spent_on>=p.first_day and e.spent_on<p.next_month
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
