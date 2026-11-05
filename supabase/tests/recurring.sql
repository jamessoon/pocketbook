begin;
insert into auth.users(id,email) values ('61000000-0000-4000-8000-000000000001',null),('61000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select set_config('test.h',public.create_household('Recurring A','Ann',1000)::text,true);
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month)
 select household_id,'Quarterly bill',id,60,'fixed',3,31,date '2026-01-01' from public.categories where name='House';
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,due_day,start_month)
 select household_id,'Utilities',id,40,'variable',31,date '2026-04-01' from public.categories where name='House';
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select public.create_household('Recurring B','Ben',1000);
do $$ begin
  update public.recurring_items set name='Other home' where household_id=current_setting('test.h')::uuid;
  if found then raise exception 'Cross-household bill edited'; end if;
  if has_function_privilege('authenticated','public.post_due_recurring(text)','execute') then raise exception 'User can invoke worker'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.recurring_items set posting_from_month='2026-04-01' where household_id=current_setting('test.h')::uuid;
do $$ begin
  if hh_private.post_recurring_at('2026-04-29 15:59Z')<>0 then raise exception 'Posted too early'; end if;
  if hh_private.post_recurring_at('2026-04-29 16:05Z')<>2 then raise exception 'Month-end posting failed'; end if;
  if hh_private.post_recurring_at('2026-04-29 17:00Z')<>0 then raise exception 'Retry duplicated bill'; end if;
  if not exists(select from public.expenses where description='Utilities' and is_fixed and not sgd_confirmed and spent_on='2026-04-30'
    and amount_sgd=40 and trip_id is null) then raise exception 'Variable estimate failed'; end if;
  if not exists(select from public.expenses where description='Quarterly bill' and is_fixed and sgd_confirmed and spent_on='2026-04-30')
    then raise exception 'Fixed bill failed'; end if;
  update public.expenses set amount_sgd=45,sgd_confirmed=true where description='Utilities';
  if (hh_private.month_summary_at(current_setting('test.h')::uuid,'2026-04-01','2026-04-30')->>'fixed_costs')::numeric<>105 then raise exception 'Confirmed amount missing'; end if;
  if hh_private.post_recurring_at('2026-07-31 00:00Z')<>4 then raise exception 'Missed-run catchup or quarterly cadence failed'; end if;
  update public.recurring_items set active=false;
  if hh_private.post_recurring_at('2026-10-31 00:00Z')<>0 then raise exception 'Paused bill posted'; end if;
end $$;
set local role service_role;
do $$ begin
  begin perform public.post_due_recurring('wrong'); raise exception 'Invalid key accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
