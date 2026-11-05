begin;
-- Include trip descriptions, matching the scope of the largest-expense list.
create function hh_private.report_new_descriptions(h uuid,m date) returns jsonb
language sql stable set search_path='' as $$
with grouped as (
  select lower(trim(description)) as norm,
    (array_agg(trim(description) order by spent_on desc,created_at desc,id))[1] as description,
    sum(amount_sgd) as amount,count(*) as entries
  from public.expenses where household_id=h and spent_on>=m and spent_on<(m+interval '1 month')::date
    and trim(description)<>'' group by lower(trim(description))
), previous as (
  select distinct lower(trim(description)) as norm from public.expenses where household_id=h
    and spent_on>=(m-interval '1 month')::date and spent_on<m and trim(description)<>''
), ranked as (
  select g.description,g.amount,g.entries,g.norm from grouped g where not exists(select from previous p where p.norm=g.norm)
    order by g.amount desc,g.norm limit 5
)
select coalesce(jsonb_agg(to_jsonb(r)-'norm' order by r.amount desc,r.norm),'[]') from ranked r
$$;
revoke all on function hh_private.report_new_descriptions(uuid,date) from public,anon,authenticated;
create or replace function hh_private.report_stats(h uuid,m date) returns jsonb language sql stable set search_path='' as $$
with bounds as (select (m+interval '1 month')::date as stop),
history as (
 select e.* from public.expenses e where e.household_id=h and e.spent_on>=m-interval '3 months'
 and e.spent_on<(select stop from bounds)
), month_entries as (select * from history where spent_on>=m),
cats as (
 select c.id,c.name,c.icon,
 coalesce(sum(e.amount_sgd) filter(where e.spent_on>=m),0) as amount,
 coalesce(sum(e.amount_sgd) filter(where e.spent_on>=m-interval '1 month' and e.spent_on<m),0) as previous,
 round(coalesce(sum(e.amount_sgd) filter(where e.spent_on<m),0)/3,2) as prior_average
 from public.categories c join history e on e.category_id=c.id and e.trip_id is null
 where c.household_id=h group by c.id
), trips as (
 select t.name,sum(e.amount_sgd) as amount from month_entries e join public.trips t on t.id=e.trip_id group by t.id
), largest as (
 select coalesce(nullif(e.description,''),c.name) as description,c.icon,e.amount_sgd as amount,e.spent_on,e.trip_id is not null as trip
 from month_entries e join public.categories c on c.id=e.category_id order by e.amount_sgd desc,e.spent_on desc,e.id limit 5
), days as (
 select hh_private.month_summary_at(h,m,d::date) as summary from generate_series(m::timestamp,
    ((select stop from bounds)-1)::timestamp,interval '1 day') d
)
select jsonb_build_object('month',m,'budget',(select monthly_budget from public.households where id=h),
 'total',coalesce(sum(amount_sgd) filter(where trip_id is null),0),
 'fixed',coalesce(sum(amount_sgd) filter(where trip_id is null and is_fixed),0),
 'daily',coalesce(sum(amount_sgd) filter(where trip_id is null and not is_fixed),0),
 'previous',coalesce((select sum(previous) from cats),0),
 'categories',coalesce((select jsonb_agg(to_jsonb(cats)||jsonb_build_object('change_previous',amount-previous,'change_average',amount-prior_average) order by amount desc,id) from cats),'[]'),
 'trips',coalesce((select jsonb_agg(to_jsonb(trips) order by amount desc,name) from trips),'[]'),
 'new_descriptions',hh_private.report_new_descriptions(h,m),
 'largest',coalesce((select jsonb_agg(to_jsonb(largest) order by amount desc,spent_on desc) from largest),'[]'),
 'unconfirmed',count(*) filter(where not sgd_confirmed),
 'days_over',(select count(*) from days where (summary->>'left_today')::numeric<0))
from month_entries
$$;

-- Enrich saved reports without replacing their original totals or delivery state.
update public.reports set stats=stats||jsonb_build_object('new_descriptions',hh_private.report_new_descriptions(household_id,month))
 where not stats ? 'new_descriptions';
commit;
