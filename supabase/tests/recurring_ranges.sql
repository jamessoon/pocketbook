begin;
insert into auth.users(id,email) values ('81000000-0000-4000-8000-000000000001',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select set_config('test.h',public.create_household('Ranges','Owner',1000)::text,true);
insert into public.recurring_items(id,household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,ends_on)
 select gen_random_uuid(),household_id,'Exact end',id,10,'fixed',1,31,'2025-01-01','2025-02-28' from public.categories where name='House';
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,due_day,start_month,ends_on)
 select household_id,'Before next due',id,20,'fixed',31,'2025-01-01','2025-02-27' from public.categories where name='House';
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if hh_private.post_recurring_at('2025-01-30T10:00Z')<>0 then raise exception 'Posted before From'; end if;
  if hh_private.post_recurring_at('2025-04-01T10:00Z')<>3 then raise exception 'Wrong posting count'; end if;
  if not exists(select from public.expenses where description='Exact end' and spent_on='2025-02-28') then raise exception 'To date excluded'; end if;
  if exists(select from public.expenses where description='Before next due' and spent_on>'2025-02-27') then raise exception 'Posted after To'; end if;
  if hh_private.post_recurring_at('2025-05-01T10:00Z')<>0 then raise exception 'Posted beyond range'; end if;
  if (hh_private.month_summary_at(current_setting('test.h')::uuid,'2025-03-01','2025-03-01')->>'fixed_costs')::numeric<>0 then raise exception 'Expired schedule reserved'; end if;
end $$;
rollback;
