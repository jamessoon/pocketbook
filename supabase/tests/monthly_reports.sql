begin;
insert into auth.users(id,email) values ('95000000-0000-4000-8000-000000000001',null),('95000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
select set_config('test.a',public.create_household('Report A','Ann',100)::text,true);
select set_config('test.cat',id::text,true) from public.categories where name='House';
insert into public.report_recipients values(current_setting('test.a')::uuid,'family@example.test');
insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount,description)
 select current_setting('test.a')::uuid,current_setting('test.cat')::uuid,d,amount,amount,label from
 (values(date '2025-05-02',50,'First'),(date '2025-04-01',30,'Prior'),(date '2025-03-01',60,'Older')) t(d,amount,label);
insert into public.trips(household_id,name,start_date,end_date) values(current_setting('test.a')::uuid,'Holiday','2025-05-01','2025-05-07');
insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount,description,trip_id,sgd_confirmed)
 select household_id,current_setting('test.cat')::uuid,'2025-05-03',20,20,'Trip',id,false from public.trips;
reset role;
do $$ declare s jsonb; begin
 s:=hh_private.report_stats(current_setting('test.a')::uuid,'2025-05-01');
 if (s->>'total')::numeric<>50 or (s->>'previous')::numeric<>30 or (s->'categories'->0->>'prior_average')::numeric<>30
 or (s->'categories'->0->>'change_previous')::numeric<>20 or (s->'categories'->0->>'change_average')::numeric<>20
 or (s->'trips'->0->>'amount')::numeric<>20 or (s->>'days_over')::int<>1 or (s->>'unconfirmed')::int<>1
 or jsonb_array_length(s->'largest')<>2 then raise exception 'Report stats incorrect: %',s; end if;
end $$;
-- Compare normalized labels across months; aggregate duplicates and exclude blank descriptions.
insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount,description)
 select current_setting('test.a')::uuid,current_setting('test.cat')::uuid,'2025-05-06',n,n,label
 from (values(3,' FIRST '),(8,' pRIOr '),(6,' ')) t(n,label);
do $$ declare items jsonb; begin
 items:=hh_private.report_new_descriptions(current_setting('test.a')::uuid,'2025-05-01');
 if jsonb_array_length(items)<>2 or lower(items->0->>'description')<>'first' or
   (items->0->>'entries')::int<>2 or (items->0->>'amount')::numeric<>53 then raise exception 'New descriptions wrong: %',items; end if;
end $$;
set local role service_role;
do $$ declare work jsonb; begin
 begin perform public.claim_monthly_report(current_setting('test.a')::uuid,gen_random_uuid(),'wrong'); raise exception 'Bad scheduler credential accepted';
 exception when insufficient_privilege then null; end;
 work:=public.claim_monthly_report(current_setting('test.a')::uuid,gen_random_uuid(),null);
 if work->>'status'<>'claimed' then raise exception 'Lease missing'; end if;
 if public.claim_monthly_report(current_setting('test.a')::uuid,gen_random_uuid(),null)->>'status'<>'busy' then raise exception 'Concurrent lease'; end if;
 update public.reports set ai_text='Snapshot saved',lease=null,lease_until=null where id=(work->>'id')::uuid;
 if public.claim_monthly_report(current_setting('test.a')::uuid,gen_random_uuid(),null)->>'ai_text'<>'Snapshot saved' then raise exception 'Retry lost stored analysis'; end if;
 update public.reports set sent_at=now() where id=(work->>'id')::uuid;
 if public.claim_monthly_report(current_setting('test.a')::uuid,gen_random_uuid(),null)->>'status'<>'sent' then raise exception 'Sent report reclaimed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
select public.create_household('Report B','Ben',100);
do $$ begin
 if exists(select id from public.reports) or exists(select from public.report_recipients) then raise exception 'Other household exposed'; end if;
 begin insert into public.report_recipients values(current_setting('test.a')::uuid,'other@example.test');raise exception 'Cross-household recipient added';
 exception when insufficient_privilege then null; end;
 if has_function_privilege('authenticated','public.claim_monthly_report(uuid,uuid,text)','execute') or
 has_table_privilege('authenticated','public.report_deliveries','select') then raise exception 'Worker privileges exposed'; end if;
end $$;
rollback;
