begin;
insert into auth.users(id,email) values('98000000-0000-4000-8000-000000000001',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('test.h',public.create_household('Weekly home','Ann',1000)::text,true);
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,ends_on)
 select household_id,label,id,5,'fixed',0,30,'2025-01-01','2025-02-27' from public.categories
 cross join unnest(array['one','future','including']) label where name='House';
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,ends_on)
 select household_id,'Yearly',id,50,'fixed',12,29,'2024-02-01','2025-02-28' from public.categories where name='House';
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if hh_private.post_recurring_at('2025-02-21T00:05Z')<>13 then raise exception 'Weekly/yearly catchup failed'; end if;
  if hh_private.post_recurring_at('2025-02-21T01:05Z')<>0 then raise exception 'Duplicate weekly posting'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
do $$ declare e record;
begin
  for e in select * from public.expenses where occurrence_on='2025-02-13' loop
    perform public.delete_recurring_entry(e.id,e.updated_at,e.description);
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if hh_private.post_recurring_at('2025-03-01T00:05Z')<>2 then raise exception 'Cutoff or yearly posting failed'; end if;
  if exists(select from public.expenses where description='including' and occurrence_on>='2025-02-13')
    or exists(select from public.expenses where description='future' and occurrence_on>'2025-02-13')
    or exists(select from public.expenses where description='one' and occurrence_on='2025-02-13')
    or (select count(*) from public.expenses where occurrence_on='2025-02-06')<>3
    or not exists(select from public.expenses where description='Yearly' and spent_on='2025-02-28')
    then raise exception 'Date-specific scopes or leap day failed'; end if;
  if (hh_private.month_summary_at(current_setting('test.h')::uuid,'2025-02-01','2025-02-28')->>'fixed_costs')::numeric<>80
    then raise exception 'Wrong February reserves'; end if;
end $$;
rollback;
