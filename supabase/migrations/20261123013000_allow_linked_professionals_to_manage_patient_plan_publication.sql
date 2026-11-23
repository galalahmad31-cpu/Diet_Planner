create or replace function public.publish_patient_nutrition_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
  v_is_owner boolean := false;
  v_is_linked_professional boolean := false;
  v_is_admin boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select np.patient_id
    into v_patient_id
  from public.nutrition_plans np
  where np.id = p_plan_id;

  if v_patient_id is null then
    raise exception 'Nutrition plan not found' using errcode = 'P0002';
  end if;

  v_is_owner := private.is_patient_workspace_owner(v_patient_id, v_uid);
  v_is_linked_professional := private.is_active_patient_professional(v_patient_id, v_uid);

  if not (v_is_owner or v_is_linked_professional) then
    raise exception 'Plan is not accessible to caller' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.profiles pr
    where pr.id = v_uid and pr.role = 'admin'
  ) into v_is_admin;

  if v_is_linked_professional and not v_is_admin
     and not public.has_active_subscription(v_uid) then
    raise exception 'Active professional subscription required' using errcode = '42501';
  end if;

  insert into public.patient_plan_publications (plan_id, published_by)
  values (p_plan_id, v_uid)
  on conflict (plan_id) do update
    set published_by = excluded.published_by,
        published_at = now(),
        revoked_at = null;
end;
$function$;

create or replace function public.revoke_patient_nutrition_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select np.patient_id
    into v_patient_id
  from public.nutrition_plans np
  where np.id = p_plan_id;

  if v_patient_id is null then
    raise exception 'Nutrition plan not found' using errcode = 'P0002';
  end if;

  if not (
    private.is_patient_workspace_owner(v_patient_id, v_uid)
    or private.is_active_patient_professional(v_patient_id, v_uid)
  ) then
    raise exception 'Plan is not accessible to caller' using errcode = '42501';
  end if;

  update public.patient_plan_publications pp
  set revoked_at = now()
  where pp.plan_id = p_plan_id
    and pp.revoked_at is null;

  if not found then
    raise exception 'Published plan not found or caller not authorized'
      using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.publish_patient_nutrition_plan(uuid) from public;
revoke all on function public.revoke_patient_nutrition_plan(uuid) from public;
grant execute on function public.publish_patient_nutrition_plan(uuid) to authenticated;
grant execute on function public.revoke_patient_nutrition_plan(uuid) to authenticated;