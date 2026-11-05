-- Run as postgres (Supabase SQL Editor or psql). Fixtures are rolled back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','hh-a@example.test'),
 ('10000000-0000-4000-8000-000000000002','hh-b@example.test'),
 ('10000000-0000-4000-8000-000000000003','hh-guest@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.house_a',public.create_household('Test A','A',900)::text,true);
select set_config('test.cat_a',id::text,true) from public.categories where name='Grocery';
select set_config('test.invite_a',invite_code,true) from public.households;
-- Use the actual Quick Add column set, including its stable UUID for retries.
insert into public.expenses(id,household_id,category_id,description,spent_on,original_amount,
    original_currency,amount_sgd,fx_rate_estimate,sgd_confirmed)
 values('40000000-0000-4000-8000-000000000001',current_setting('test.house_a')::uuid,
    current_setting('test.cat_a')::uuid,'First entry',current_date,10,'SGD',10,null,true);
select set_config('test.entry_a',id::text,true) from public.expenses;
do $$
begin
  begin
    insert into public.expenses(id,household_id,category_id,description,spent_on,original_amount,
        original_currency,amount_sgd,fx_rate_estimate,sgd_confirmed)
      values('40000000-0000-4000-8000-000000000001',current_setting('test.house_a')::uuid,
        current_setting('test.cat_a')::uuid,'First entry',current_date,10,'SGD',10,null,true);
    raise exception 'Quick Add retry duplicated the expense';
  exception when unique_violation then null; end;
  if (select count(*) from public.expenses where id=current_setting('test.entry_a')::uuid)<>1
   then raise exception 'Quick Add retry could not recover the original expense'; end if;
end $$;

-- Trip management comes later, but the foreign key is already part of expenses.
reset role;
insert into public.trips(id,household_id,name,start_date,end_date)
 values('30000000-0000-4000-8000-000000000001',current_setting('test.house_a')::uuid,'A trip',current_date,current_date);
set local role authenticated;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('test.house_b',public.create_household('Test B','B',1100)::text,true);
select set_config('test.cat_b',id::text,true) from public.categories where name='Grocery';
do $$
declare n int; a uuid := current_setting('test.house_a')::uuid; b uuid := current_setting('test.house_b')::uuid;
        cat_a uuid := current_setting('test.cat_a')::uuid; cat_b uuid := current_setting('test.cat_b')::uuid;
begin
  if exists(select from public.households where id=a)
    or exists(select from public.members where household_id=a)
    or exists(select from public.categories where id=cat_a)
    or exists(select from public.trips where household_id=a)
    or exists(select from public.expenses where household_id=a)
    then raise exception 'Foreign household data was visible'; end if;
  if (select count(*) from public.categories) <> 14 then raise exception 'Unexpected category seeds'; end if;
  if hh_private.month_summary_at(a,current_date,current_date) is not null
    then raise exception 'Foreign household reporting access'; end if;
  update public.expenses set description='unallowed' where household_id=a;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'Cross-household update succeeded'; end if;
  delete from public.expenses where household_id=a;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'Cross-household delete succeeded'; end if;
  begin
    insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount)
      values(a,cat_a,current_date,1,1);
    raise exception 'Cross-household insert succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount)
      values(b,cat_a,current_date,1,1);
    raise exception 'Foreign category reference succeeded';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.expenses(household_id,category_id,trip_id,spent_on,amount_sgd,original_amount)
      values(b,cat_b,'30000000-0000-4000-8000-000000000001',current_date,1,1);
    raise exception 'Foreign trip reference succeeded';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.expenses(household_id,category_id,created_by,spent_on,amount_sgd,original_amount)
      values(b,cat_b,'10000000-0000-4000-8000-000000000001',current_date,1,1);
    raise exception 'Forged audit actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_household('Orphan','B again',0);
    raise exception 'Second household created';
  exception when unique_violation then null; end;
  begin
    insert into public.members(user_id,household_id,display_name,email)
      values('10000000-0000-4000-8000-000000000003',b,'Impersonated','fake@example.test');
    raise exception 'RPC membership bypass succeeded';
  exception when insufficient_privilege then null; end;
end $$;

-- Same-household editing and deleting must succeed, with the editor recorded.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.check_household_id(current_setting('test.invite_a'));
select public.link_household_device(null,'Family member');
update public.expenses set description='Shared edit' where id=current_setting('test.entry_a')::uuid;
do $$
begin
  if not exists(select from public.expenses where id=current_setting('test.entry_a')::uuid
      and updated_by=auth.uid() and created_by='10000000-0000-4000-8000-000000000001'
      and description='Shared edit') then raise exception 'Shared edit or auditing failed'; end if;
  delete from public.expenses where id=current_setting('test.entry_a')::uuid;
  if not found then raise exception 'Shared deletion failed'; end if;
end $$;
reset role;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000004',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$
declare answer jsonb;
begin
  if current_setting('test.invite_a') !~ '^[0-9]{6}$' then raise exception 'Expected six digits'; end if;
  for i in 1..5 loop
    answer := public.check_household_id('bad');
    if not answer ? 'error' then raise exception 'Bad ID accepted'; end if;
  end loop;
  answer := public.check_household_id(current_setting('test.invite_a'));
  if answer->>'error' not like 'Too many attempts%' then raise exception 'Attempt limit failed'; end if;
end $$;
reset role;
delete from hh_private.device_attempts where device='10000000-0000-4000-8000-000000000004';
set local role authenticated;
select public.check_household_id(current_setting('test.invite_a'));
select public.link_household_device('10000000-0000-4000-8000-000000000001',null);
insert into public.expenses(household_id,category_id,spent_on,amount_sgd,original_amount)
 values(current_setting('test.house_a')::uuid,current_setting('test.cat_a')::uuid,current_date,3,3);
do $$ begin
  if not exists(select from public.expenses where amount_sgd=3 and created_by='10000000-0000-4000-8000-000000000001')
    then raise exception 'Second device lost member attribution'; end if;
end $$;
reset role;
do $$
begin
  if exists(select from public.households where name='Orphan')
    then raise exception 'Failed household creation leaked a record'; end if;
  if has_function_privilege('anon','public.month_summary(date)','EXECUTE')
   or has_function_privilege('anon','public.create_household(text,text,numeric)','EXECUTE')
   or has_table_privilege('anon','public.expenses','SELECT')
    then raise exception 'Anonymous client grants are too broad'; end if;
end $$;
rollback;
