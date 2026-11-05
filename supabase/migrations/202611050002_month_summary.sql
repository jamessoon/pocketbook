begin;
-- Explicit clock for deterministic regression checks. The public wrapper below
-- supplies a membership-scoped household and its local calendar date.
create function hh_private.month_summary_at(p_household uuid,p_month date,p_today date)
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
revoke all on function hh_private.month_summary_at(uuid,date,date) from public,anon,authenticated;
grant execute on function hh_private.month_summary_at(uuid,date,date) to authenticated;

create function public.month_summary(p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select hh_private.month_summary_at(h.id,p_month,(now() at time zone h.timezone)::date)
 from public.households h where h.id=hh_private.my_household() and p_month is not null
$$;
revoke all on function public.month_summary(date) from public,anon,authenticated;
grant execute on function public.month_summary(date) to authenticated;
commit;
