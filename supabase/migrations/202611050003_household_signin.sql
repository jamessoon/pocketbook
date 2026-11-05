begin;

-- Existing memberships remain valid. Additional devices point to the member
-- whose name was chosen, so reports and expense attribution stay per person.
alter table public.members add column profile_user_id uuid references public.members(user_id);
alter table public.members alter column email drop not null;

create function hh_private.new_household_code() returns text
language plpgsql volatile security definer set search_path='' as $$
declare candidate text;
begin
  perform pg_advisory_xact_lock(176512390);
  for attempt in 1..1000 loop
    candidate := lpad(((('x' || left(replace(gen_random_uuid()::text,'-',''),8))::bit(32)::bigint % 1000000))::text,6,'0');
    if not exists(select from public.households where invite_code=candidate) then return candidate; end if;
  end loop;
  raise exception 'Could not allocate a household ID. Try again.';
end $$;
revoke all on function hh_private.new_household_code() from public,anon,authenticated;
alter table public.households alter column invite_code set default hh_private.new_household_code();
update public.households set invite_code=hh_private.new_household_code() where invite_code !~ '^[0-9]{6}$';
alter table public.households add check (invite_code ~ '^[0-9]{6}$');
drop function public.join_household(text,text);

create table hh_private.device_attempts (
  device uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null, attempts integer not null,
  pending_household uuid references public.households(id) on delete cascade,
  valid_until timestamptz
);
revoke all on hh_private.device_attempts from public,anon,authenticated;
create function public.check_household_id(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare device_id uuid := auth.uid(); hits int; target uuid;
begin
  if device_id is null or hh_private.my_household() is not null then raise exception 'Device already linked or signed out'; end if;
  insert into hh_private.device_attempts as d(device,started_at,attempts)
    values(device_id,now(),1) on conflict(device) do update set
      attempts=case when d.started_at < now()-interval '15 minutes' then 1 else least(d.attempts+1,6) end,
      started_at=case when d.started_at < now()-interval '15 minutes' then now() else d.started_at end,
      pending_household=null,valid_until=null returning attempts into hits;
  -- Return errors as data so failed attempts commit.
  if hits>5 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes.'); end if;
  select id into target from public.households where invite_code=p_code and p_code ~ '^[0-9]{6}$';
  if target is null then return jsonb_build_object('error','Check the household ID and try again.'); end if;
  update hh_private.device_attempts set pending_household=target,valid_until=now()+interval '10 minutes' where device=device_id;
  return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name) order by joined_at),'[]')
    from public.members where household_id=target and profile_user_id is null));
end $$;

create function public.link_household_device(p_member uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; chosen text;
begin
  delete from hh_private.device_attempts where device=auth.uid() and valid_until>now() returning pending_household into target;
  if target is null then raise exception 'Enter the household ID again.'; end if;
  if p_member is null then
    perform hh_private.enrol(target,p_name);
  else
    select display_name into strict chosen from public.members
      where household_id=target and user_id=p_member and profile_user_id is null;
    insert into public.members(user_id,household_id,display_name,profile_user_id,email)
      values(auth.uid(),target,chosen,p_member,null);
  end if;
  return target;
end $$;
revoke all on function public.check_household_id(text),public.link_household_device(uuid,text) from public,anon,authenticated;
grant execute on function public.check_household_id(text),public.link_household_device(uuid,text) to authenticated;

create or replace function hh_private.stamp_expense() returns trigger language plpgsql set search_path='' as $$
declare person uuid;
begin
  select coalesce(profile_user_id,user_id) into person from public.members where user_id=auth.uid();
  if tg_op='INSERT' then new.created_by:=person; new.created_at:=now(); end if;
  new.updated_by:=person;
  new.updated_at:=now();
  return new;
end $$;
commit;
