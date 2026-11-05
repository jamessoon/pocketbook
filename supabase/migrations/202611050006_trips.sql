begin;
grant insert (household_id,name,start_date,end_date,budget,archived),
 update (name,start_date,end_date,budget,archived) on public.trips to authenticated;
create policy create_own_trips on public.trips for insert to authenticated
 with check (household_id=(select hh_private.my_household()));
create policy edit_own_trips on public.trips for update to authenticated
 using (household_id=(select hh_private.my_household()))
 with check (household_id=(select hh_private.my_household()));
create index expenses_by_trip on public.expenses(household_id,trip_id,spent_on) where trip_id is not null;
create function hh_private.validate_trip_assignment() returns trigger language plpgsql set search_path='' as $$
begin
  if new.trip_id is not null and (tg_op='INSERT' or new.trip_id is distinct from old.trip_id) then
    if new.is_fixed then raise exception 'Recurring expenses cannot be assigned to trips'; end if;
    if exists(select from public.trips where id=new.trip_id and household_id=new.household_id and archived)
      then raise exception 'This trip is archived. Select an active trip.'; end if;
  end if;
  return new;
end $$;
revoke all on function hh_private.validate_trip_assignment() from public,anon,authenticated;
create trigger validate_trip_assignment before insert or update of trip_id on public.expenses
 for each row execute function hh_private.validate_trip_assignment();
commit;
