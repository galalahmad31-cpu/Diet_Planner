begin;

-- Keep privileged function name resolution deterministic.
-- All application objects referenced by these functions are schema-qualified.
alter function public.get_patient_published_nutrition_plans(uuid) set search_path = '';
alter function public.publish_patient_nutrition_plan(uuid) set search_path = '';
alter function public.revoke_patient_nutrition_plan(uuid) set search_path = '';
alter function public.save_exchange_nutrition_plan(uuid, text, jsonb) set search_path = '';

-- get_book_delivery_link previously relied on the implicit public search path
-- for is_admin(). Qualify that call before hardening its search_path.
create or replace function public.get_book_delivery_link(p_book_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_free boolean;
  v_status text;
  v_url text;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select b.is_free, b.status
    into v_is_free, v_status
  from public.books b
  where b.id = p_book_id;

  if not found or v_status <> 'published' then
    raise exception 'book_not_available' using errcode = 'P0002';
  end if;

  if not v_is_free
     and not exists (
       select 1
       from public.book_orders o
       where o.book_id = p_book_id
         and o.user_id = v_user_id
         and o.status = 'approved'
     )
     and not public.is_admin() then
    raise exception 'purchase_not_approved' using errcode = '42501';
  end if;

  select l.delivery_url
    into v_url
  from public.book_delivery_links l
  where l.book_id = p_book_id;

  if v_url is null then
    raise exception 'delivery_link_not_configured' using errcode = 'P0002';
  end if;

  return v_url;
end;
$function$;

commit;
