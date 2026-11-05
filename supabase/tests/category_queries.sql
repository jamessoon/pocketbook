-- Functional RPC integration checks. Run as postgres in a disposable database.
begin;
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000001','choices@example.test');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.create_household('Category tests','Test member',1000);
do $$
declare
  h uuid := hh_private.my_household();
  cat uuid := (select id from public.categories where name='Pet');
  local_today date := (now() at time zone 'Asia/Singapore')::date;
  labels text[]; ids uuid[]; reordered uuid[]; summary jsonb;
begin
  insert into public.expenses(household_id,category_id,spent_on,description,amount_sgd,original_amount)
    select h,cat,local_today-offset_days,label,1,1 from (values
      (5,' food '),(4,'Food'),(3,'Travel'),(2,'travel'),(1,'Grooming'),
      (179,'Old but included'),(180,'Too old'),(-1,'Future'),(0,' ')
    ) sample(offset_days,label);
  select array(select description from public.category_suggestions(cat)) into labels;
  if labels<>array['travel','Food','Grooming'] then raise exception 'Unexpected suggestions: %',labels; end if;
  if (select category_id from public.category_usage() limit 1)<>cat
    then raise exception 'Category usage missed most frequent category'; end if;
  update public.categories set archived=true where id=cat;
  if exists(select from public.category_usage() where category_id=cat)
    then raise exception 'Archived category returned to picker'; end if;
  if (select count(*) from public.expenses where category_id=cat)<>9
    then raise exception 'Archive lost category history'; end if;
  select array_agg(id order by sort_order desc) into ids from public.categories where not archived;
  perform public.reorder_categories(ids);
  select array_agg(id order by sort_order) into reordered from public.categories where not archived;
  if reordered<>ids then raise exception 'Reorder failed'; end if;
  begin
    perform public.reorder_categories(ids[2:array_length(ids,1)]);
    raise exception 'Partial reorder was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Category list changed. Refresh and retry.' then raise; end if;
  end;
  select public.month_summary(local_today) into summary;
  if (summary->>'today')::date is distinct from local_today or (summary->>'monthly_budget')::numeric is distinct from 1000
    then raise exception 'Public summary lost timezone or household'; end if;
end $$;
rollback;
