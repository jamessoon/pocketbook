begin;
insert into auth.users(id,email) values ('51000000-0000-4000-8000-000000000001',null),('51000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select set_config('test.h',public.create_household('Trip home','Ann',1000)::text,true);
insert into public.trips(household_id,name,start_date,end_date,budget) values(current_setting('test.h')::uuid,'Holiday',current_date,current_date,100);
select set_config('test.t',id::text,true) from public.trips where name='Holiday';
insert into public.expenses(household_id,category_id,trip_id,amount_sgd,original_amount,spent_on)
 select household_id,id,current_setting('test.t')::uuid,5,5,(now() at time zone 'Asia/Singapore')::date from public.categories where name='Shopping';
do $$ begin
  if (public.month_summary((now() at time zone 'Asia/Singapore')::date)->>'day_to_day_spent')::numeric <> 0 then raise exception 'Trip counted in budget'; end if;
  update public.trips set archived=true where id=current_setting('test.t')::uuid;
  begin
    insert into public.expenses(household_id,category_id,trip_id,amount_sgd,original_amount,spent_on)
      select household_id,id,current_setting('test.t')::uuid,3,3,current_date from public.categories where name='Shopping';
    raise exception 'Archived trip accepted';
  exception when raise_exception then if sqlerrm not like 'This trip is archived%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
select public.create_household('Other trip home','Ben',1000);
do $$ begin
  update public.trips set name='Intruder' where id=current_setting('test.t')::uuid;
  if found then raise exception 'Cross-household trip edited'; end if;
  begin
    insert into public.trips(household_id,name,start_date,end_date) values(current_setting('test.h')::uuid,'Intruder',current_date,current_date);
    raise exception 'Cross-household trip created';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
