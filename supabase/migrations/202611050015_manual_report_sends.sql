begin;
-- Keep the automatic once-a-month receipt separate from explicit sends.
alter table public.reports add column last_manual_sent_at timestamptz,
 add column automatic_snapshot boolean not null default true;
grant select(last_manual_sent_at) on public.reports to authenticated;

create table public.manual_report_requests(
 id uuid primary key, report_id uuid not null references public.reports(id) on delete cascade,
 stats jsonb not null, recipients text[] not null, completed_at timestamptz
);
create table public.manual_report_deliveries(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.manual_report_requests(id) on delete cascade,
 email text not null,payload jsonb not null,first_attempt timestamptz not null default now(),provider_id text,
 unique(request_id,email)
);
alter table public.manual_report_requests enable row level security;
alter table public.manual_report_deliveries enable row level security;
revoke all on public.manual_report_requests,public.manual_report_deliveries from public,anon,authenticated;
grant select,insert,update on public.manual_report_requests,public.manual_report_deliveries to service_role;

create function public.prepare_manual_report(p_household uuid,p_month date,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_month date; r public.reports%rowtype; job public.manual_report_requests%rowtype; snapshot jsonb;
begin
 select date_trunc('month',now() at time zone timezone)::date into strict current_month from public.households where id=p_household;
 if p_request is null or p_month is null or p_month<>date_trunc('month',p_month)::date
    or p_month>current_month or p_month<date '1900-01-01' then raise exception 'Choose a current or past report month'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household::text||p_month::text,0));
 select * into r from public.reports where household_id=p_household and month=p_month for update;
 select * into job from public.manual_report_requests where id=p_request;
 if found then
   if job.report_id is distinct from r.id then raise exception 'Send request does not match this household and month'; end if;
 else
   snapshot:=case when r.automatic_snapshot then r.stats else hh_private.report_stats(p_household,p_month) end;
   if r.id is null then
     insert into public.reports(household_id,month,stats,automatic_snapshot) values(p_household,p_month,snapshot,false) returning * into r;
   elsif not r.automatic_snapshot then
     update public.reports set stats=snapshot where id=r.id;
   end if;
   insert into public.manual_report_requests(id,report_id,stats,recipients)
     select p_request,r.id,snapshot,array(select email from public.report_recipients where household_id=p_household order by email)
     returning * into job;
 end if;
 return jsonb_build_object('status',case when job.completed_at is null then 'claimed'
   when cardinality(job.recipients)=0 then 'saved' else 'already_sent' end,
   'id',job.report_id,'stats',job.stats,'recipients',job.recipients);
end $$;
create function public.finish_manual_report(p_request uuid,p_delivered boolean) returns void
language plpgsql security definer set search_path='' as $$
declare report uuid;
begin
 update public.manual_report_requests set completed_at=now() where id=p_request and completed_at is null returning report_id into report;
 if p_delivered and report is not null then update public.reports set last_manual_sent_at=now() where id=report; end if;
end $$;
revoke all on function public.prepare_manual_report(uuid,date,uuid),public.finish_manual_report(uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_manual_report(uuid,date,uuid),public.finish_manual_report(uuid,boolean) to service_role;
create or replace function public.claim_monthly_report(p_household uuid,p_lease uuid,p_job_secret text default null)
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
 elsif not r.automatic_snapshot then
   update public.reports set stats=hh_private.report_stats(p_household,m),automatic_snapshot=true where id=r.id returning * into r;
 end if;
 if r.sent_at is not null then return jsonb_build_object('status','sent','id',r.id); end if;
 if r.lease_until>now() then return jsonb_build_object('status','busy','id',r.id); end if;
 update public.reports set lease=p_lease,lease_until=now()+interval '10 minutes' where id=r.id;
 return jsonb_build_object('status','claimed','id',r.id,'month',m,'stats',r.stats,'ai_text',r.ai_text);
end $$;
commit;
