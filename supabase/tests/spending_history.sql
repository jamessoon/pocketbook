begin;
insert into auth.users(id,email) values('94000000-0000-4000-8000-000000000001',null),('94000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
select set_config('test.h',public.create_household('History A','Ann',1000)::text,true);
select set_config('test.cat',id::text,true) from public.categories where name='House';
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,ends_on)
 values(current_setting('test.h')::uuid,'Rent',current_setting('test.cat')::uuid,10,'fixed',0,1,'2025-03-01','2025-03-22');
insert into public.trips(household_id,name,start_date,end_date) values(current_setting('test.h')::uuid,'Holiday','2025-03-01','2025-03-04');
insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount)
 values(current_setting('test.h')::uuid,current_setting('test.cat')::uuid,'2025-03-01',5,5);
insert into public.expenses(household_id,category_id,trip_id,spent_on,amount_sgd,original_amount)
 select household_id,current_setting('test.cat')::uuid,id,'2025-03-03',30,30 from public.trips;
reset role;
select hh_private.post_recurring_at('2025-03-09T00:00Z');
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.spending_history('2025-01-01',current_setting('test.cat')::uuid)->0;
  if r is null or r->>'month'<>'2025-03-01' or (r->>'daily')::numeric<>5 or
     (r->>'fixed')::numeric<>20 or (r->>'scheduled')::numeric<>20 or
     (r->>'trips')::numeric<>30 or jsonb_array_length(r->'occurrences')<>2 then raise exception 'Wrong history: %',r; end if;
  if jsonb_array_length(public.spending_history('2024-01-01'))<>0 then raise exception 'Wrong year'; end if;
end $$;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
select public.create_household('History B','Ben',1000);
do $$ begin
  if public.spending_history('2025-01-01')<>'[]'::jsonb or
    public.spending_history('2025-01-01',current_setting('test.cat')::uuid)<>'[]'::jsonb
    then raise exception 'Other household history exposed'; end if;
end $$;
rollback;
