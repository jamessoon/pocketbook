begin;
insert into auth.users(id,email) values ('41000000-0000-4000-8000-000000000001',null),('41000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
select set_config('test.a',public.create_household('Widget A','Ann',1000)::text,true);
select set_config('test.token',public.get_widget_token(),true);
select set_config('test.cat',(select id::text from public.categories where name='Pet'),true);
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000002',true);
select public.create_household('Widget B','Ben',2000);
select set_config('test.other',(select id::text from public.categories where name='Pet'),true);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare t text:=current_setting('test.token'); cat uuid:=current_setting('test.cat')::uuid; s jsonb;
begin
  if has_function_privilege('anon','public.get_widget_token()','execute') or
     has_schema_privilege('anon','hh_private','usage') then raise exception 'Widget secret exposed'; end if;
  begin perform public.widget_categories('bad'); raise exception 'Invalid token accepted';
    exception when insufficient_privilege then null; end;
  begin perform public.widget_add_expense(t,current_setting('test.other')::uuid,1,'bad');
    raise exception 'Wrong category accepted'; exception when raise_exception then
    if sqlerrm<>'Category is unavailable' then raise; end if; end;
  perform public.widget_add_expense(t,cat,10.25,'Pet supplies');
  s:=public.widget_summary(t);
  if (s->>'spent')::numeric<>10.25 or s->'recent'->0->>'label'<>'Pet supplies'
    or jsonb_array_length(public.widget_categories(t))<>8 or public.widget_categories(t)->0->>'id'<>cat::text
    or public.widget_suggestions(t,cat)->>0<>'Pet supplies' then raise exception 'Wrong widget response'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
do $$ begin
  if not exists(select from public.expenses where created_by is null and updated_by is null and trip_id is null
    and not is_fixed and sgd_confirmed and original_currency='SGD' and original_amount=10.25
    and spent_on=(now() at time zone 'Asia/Singapore')::date) then raise exception 'Wrong attribution'; end if;
  if public.rotate_widget_token()=current_setting('test.token') then raise exception 'Rotation failed'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.widget_summary(current_setting('test.token')); raise exception 'Revoked token accepted';
    exception when insufficient_privilege then null; end;
end $$;
rollback;
