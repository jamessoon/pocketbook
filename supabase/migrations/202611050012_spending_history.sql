begin;
-- One snapshot covers the full twelve-month window. Scheduled amounts come from
-- the same occurrence calculation as Overview; posted occurrences are already
-- counted in the expense aggregates and must not be added a second time.
create function public.spending_history(p_start date,p_category uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with bounds as (
  select h.id as household_id,date_trunc('month',p_start)::date as first_month,
         (now() at time zone h.timezone)::date as today
  from public.households h where h.id=hh_private.my_household()
), months as (
  select b.*,m::date as month from bounds b cross join lateral generate_series(
    b.first_month::timestamp,b.first_month+interval '11 months',interval '1 month') m
), posted as (
  select date_trunc('month',e.spent_on)::date as month,e.category_id,
    coalesce(sum(e.amount_sgd) filter(where e.trip_id is null and not e.is_fixed),0) as daily,
    coalesce(sum(e.amount_sgd) filter(where e.trip_id is null and e.is_fixed),0) as fixed,
    coalesce(sum(e.amount_sgd) filter(where e.trip_id is not null),0) as trips
  from public.expenses e join bounds b on e.household_id=b.household_id
  where e.spent_on>=b.first_month and e.spent_on<b.first_month+interval '12 months'
    and (p_category is null or e.category_id=p_category)
  group by 1,e.category_id
), due as (
  select m.month,r.category_id,sum((f->>'amount')::numeric) as scheduled,
    case when p_category is not null then jsonb_agg(f order by f->>'due_on',r.id) else '[]'::jsonb end as occurrences
  from months m cross join lateral jsonb_array_elements(
    hh_private.month_summary_at(m.household_id,m.month,m.today)->'fixed_items') f
  join public.recurring_items r on r.id=(f->>'id')::uuid and r.household_id=m.household_id
  where not (f->>'posted')::boolean and (p_category is null or r.category_id=p_category)
  group by m.month,r.category_id
), combined as (
  select month,category_id,coalesce(p.daily,0) as daily,coalesce(p.fixed,0) as fixed,
    coalesce(p.trips,0) as trips,coalesce(d.scheduled,0) as scheduled,coalesce(d.occurrences,'[]'::jsonb) as occurrences
  from posted p full join due d using(month,category_id)
)
select coalesce(jsonb_agg(to_jsonb(c) order by c.month,c.category_id),'[]'::jsonb) from combined c
$$;
revoke all on function public.spending_history(date,uuid) from public,anon,authenticated;
grant execute on function public.spending_history(date,uuid) to authenticated;
commit;
