begin;
insert into auth.users(id,email) values('93000000-0000-4000-8000-000000000001',null),('93000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select set_config('test.a',public.create_household('Delete test','Ann',1000)::text,true);
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,ends_on)
 select household_id,'Lessons',id,10,'variable',0,1,'2025-03-01','2025-04-30' from public.categories where name='House';
select set_config('test.bill',id::text,true) from public.recurring_items;
reset role;
select set_config('request.jwt.claim.sub','',true);
select hh_private.post_recurring_at('2025-03-09T00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select public.create_household('Other home','Ben',1000);
do $$ begin
  begin perform public.delete_recurring_bill(current_setting('test.bill')::uuid); raise exception 'Cross-household delete succeeded';
  exception when raise_exception then if sqlerrm<>'Bill is unavailable.' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select public.delete_recurring_bill(current_setting('test.bill')::uuid);
select public.delete_recurring_bill(current_setting('test.bill')::uuid);
do $$ begin
  update public.recurring_items set active=true where id=current_setting('test.bill')::uuid;
  if found then raise exception 'Deleted bill reactivated'; end if;
  if (select count(*) from public.expenses where not sgd_confirmed)<>2 then raise exception 'Posted history lost'; end if;
end $$;
reset role;
do $$ begin
  if hh_private.post_recurring_at('2025-04-30T00:00Z')<>0 then raise exception 'Deleted schedule posted'; end if;
  if (hh_private.month_summary_at(current_setting('test.a')::uuid,'2025-03-01','2025-03-10')->>'fixed_costs')::numeric<>20 or
     (hh_private.month_summary_at(current_setting('test.a')::uuid,'2025-04-01','2025-04-10')->>'fixed_costs')::numeric<>0
     then raise exception 'Wrong historical spending or future reserve'; end if;
end $$;
rollback;
