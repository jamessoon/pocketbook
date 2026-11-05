begin;
insert into auth.users(id,email) values ('91000000-0000-4000-8000-000000000001',null),('91000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('test.home',public.create_household('Series home','Ann',2000)::text,true);
insert into public.recurring_items(household_id,name,category_id,amount,amount_type,due_day,start_month,ends_on)
 select household_id,bill,id,10,'fixed',5,'2025-01-01','2025-12-31' from public.categories
 cross join unnest(array['one','future','including']) bill where name='House';
reset role;
select set_config('request.jwt.claim.sub','',true);
select hh_private.post_recurring_at('2025-03-06T00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$ declare target record; n integer;
begin
  for target in select id,description,updated_at from public.expenses where spent_on='2025-02-05' loop
    begin perform public.delete_recurring_entry(target.id,target.updated_at-interval '1 second',target.description);
      raise exception 'Stale version accepted'; exception when raise_exception then
      if sqlerrm not like 'Entry changed%' then raise; end if; end;
    n:=public.delete_recurring_entry(target.id,target.updated_at,target.description);
    if n<>(case when target.description='including' then 2 else 1 end) then raise exception 'Wrong deletion count'; end if;
  end loop;
end $$;
select set_config('test.target',id::text,true) from public.expenses where description='future' and spent_on='2025-02-05';
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select public.create_household('Other home','Ben',1000);
do $$ begin
  begin perform public.delete_recurring_entry(current_setting('test.target')::uuid,now(),'including');
    raise exception 'Cross-household deletion allowed'; exception when raise_exception then
    if sqlerrm<>'Recurring entry is unavailable' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select hh_private.post_recurring_at('2025-04-06T00:00Z');
do $$ declare h uuid:=current_setting('test.home')::uuid;
begin
  if (select count(*) from public.expenses where spent_on='2025-01-05')<>3
     or (select count(*) from public.expenses where spent_on='2025-02-05')<>1
     or (select count(*) from public.expenses where description='one' and spent_on>='2025-03-01')<>2
     or exists(select from public.expenses where description<>'one' and spent_on>='2025-03-01')
    then raise exception 'Past entries or future posting incorrect'; end if;
  if (hh_private.month_summary_at(h,'2025-02-01','2025-02-01')->>'fixed_costs')::numeric<>10 or
     (hh_private.month_summary_at(h,'2025-04-01','2025-04-01')->>'fixed_costs')::numeric<>10
    then raise exception 'Deleted occurrence still reserved'; end if;
end $$;
rollback;
