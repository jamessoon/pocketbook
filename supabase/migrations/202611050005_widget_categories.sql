create or replace function public.widget_categories(token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid := hh_private.widget_home(token);
begin
  return (select coalesce(jsonb_agg(to_jsonb(r) order by sort_order,name,id),'[]') from
    (select c.id,c.name,c.icon,c.color,c.sort_order from public.categories c
     where c.household_id=h and not c.archived
     order by c.sort_order,c.name,c.id) r);
end $$;
