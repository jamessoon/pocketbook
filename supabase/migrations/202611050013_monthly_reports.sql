begin;
create table public.report_recipients(
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check(length(email)<=254 and email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  primary key(household_id,email)
);
alter table public.report_recipients enable row level security;
revoke all on public.report_recipients from public,anon,authenticated;
grant select,insert,delete on public.report_recipients to authenticated;
create policy own_recipients on public.report_recipients for all to authenticated
 using(household_id=(select hh_private.my_household())) with check(household_id=(select hh_private.my_household()));
insert into public.report_recipients select distinct household_id,lower(trim(email)) from public.members
 where profile_user_id is null and length(email)<=254 and trim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' on conflict do nothing;

create table public.reports(
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 month date not null, stats jsonb not null, ai_text text, sent_at timestamptz,
 lease uuid, lease_until timestamptz, unique(household_id,month)
);
alter table public.reports enable row level security;
revoke all on public.reports from public,anon,authenticated;
grant select(id,household_id,month,stats,ai_text,sent_at) on public.reports to authenticated;
create policy own_reports on public.reports for select to authenticated using(household_id=(select hh_private.my_household()));
create table public.report_deliveries(
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
 email text not null, payload jsonb not null, first_attempt timestamptz not null default now(), provider_id text,
 unique(report_id,email)
);
alter table public.report_deliveries enable row level security;
revoke all on public.report_deliveries from public,anon,authenticated;
grant select,insert,update on public.report_deliveries,public.reports to service_role;
grant select on public.report_recipients to service_role;
create table hh_private.report_job_key(singleton boolean primary key check(singleton),
 secret text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''));
alter table hh_private.report_job_key enable row level security;
revoke all on hh_private.report_job_key from public,anon,authenticated;
insert into hh_private.report_job_key(singleton) values(true);

create function hh_private.report_stats(h uuid,m date) returns jsonb language sql stable set search_path='' as $$
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
 'largest',coalesce((select jsonb_agg(to_jsonb(largest) order by amount desc,spent_on desc) from largest),'[]'),
 'unconfirmed',count(*) filter(where not sgd_confirmed),
 'days_over',(select count(*) from days where (summary->>'left_today')::numeric<0))
from month_entries
$$;

create function public.claim_monthly_report(p_household uuid,p_lease uuid,p_job_secret text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m date; r public.reports%rowtype;
begin
 if p_job_secret is not null and not exists(select from hh_private.report_job_key where secret=p_job_secret)
 then raise exception 'Invalid scheduler credential' using errcode='42501'; end if;
 select (date_trunc('month',now() at time zone timezone)-interval '1 month')::date into strict m from public.households where id=p_household;
 perform pg_advisory_xact_lock(hashtextextended(p_household::text||m::text,0));
 select * into r from public.reports where household_id=p_household and month=m for update;
 if not found then
   insert into public.reports(household_id,month,stats) values(p_household,m,hh_private.report_stats(p_household,m)) returning * into r;
 end if;
 if r.sent_at is not null then return jsonb_build_object('status','sent','id',r.id); end if;
 if r.lease_until>now() then return jsonb_build_object('status','busy','id',r.id); end if;
 update public.reports set lease=p_lease,lease_until=now()+interval '10 minutes' where id=r.id;
 return jsonb_build_object('status','claimed','id',r.id,'month',m,'stats',r.stats,'ai_text',r.ai_text);
end $$;
revoke all on function hh_private.report_stats(uuid,date), public.claim_monthly_report(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_monthly_report(uuid,uuid,text) to service_role;
commit;
