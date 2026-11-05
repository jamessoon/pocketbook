begin;
insert into auth.users(id,email) values ('96000000-0000-4000-8000-000000000001',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
select set_config('test.house',public.create_household('Manual reports','Ann',100)::text,true);
insert into public.report_recipients values(current_setting('test.house')::uuid,'test@example.test');
do $$ begin
 if has_function_privilege('authenticated','public.prepare_manual_report(uuid,date,uuid)','execute')
 or has_table_privilege('authenticated','public.manual_report_deliveries','select') then raise exception 'Manual worker access leaked'; end if;
end $$;
set local role service_role;
do $$ declare h uuid:=current_setting('test.house')::uuid; m date:=(date_trunc('month',now() at time zone 'Asia/Singapore')-interval '1 month')::date;
 k1 uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); a jsonb;b jsonb;
begin
 a:=public.prepare_manual_report(h,(m-interval '1 year')::date,k1); -- older selected month
 if (a->'stats'->>'month')::date<>(m-interval '1 year')::date or a->>'status'<>'claimed' then raise exception 'Wrong manual month'; end if;
 perform public.finish_manual_report(k1,true);
 if public.prepare_manual_report(h,(m-interval '1 year')::date,k1)->>'status'<>'already_sent' then raise exception 'Manual retry duplicated'; end if;
 b:=public.prepare_manual_report(h,(m-interval '1 year')::date,k2);
 if b->>'status'<>'claimed' or a->>'id'<>b->>'id' then raise exception 'Second press skipped'; end if;
 perform public.finish_manual_report(k2,true);
 a:=public.prepare_manual_report(h,m,gen_random_uuid());
 if a->>'status'<>'claimed' then raise exception 'First manual send failed'; end if;
 b:=public.claim_monthly_report(h,gen_random_uuid());
 if b->>'status'<>'claimed' or a->>'id'<>b->>'id' then raise exception 'Manual suppressed automatic send'; end if;
 update public.reports set sent_at=now(),lease=null,lease_until=null where id=(b->>'id')::uuid;
 if public.claim_monthly_report(h,gen_random_uuid())->>'status'<>'sent' then raise exception 'Automatic send duplicated'; end if;
 if public.prepare_manual_report(h,m,gen_random_uuid())->>'status'<>'claimed' then raise exception 'Automatic suppressed new manual send'; end if;
end $$;
rollback;
