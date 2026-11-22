-- Allow an authenticated patient account to update only its own patient-record display name.
-- Keep this separate from the shared clinical-health RPC and record the change in the existing audit trail.

create or replace function public.update_my_patient_record_name(
  p_patient_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_result jsonb;
begin
  if v_uid is null or p_patient_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_patient_name';
  end if;

  if not exists (
    select 1
    from public.patient_accounts pa
    where pa.patient_id = p_patient_id
      and pa.user_id = v_uid
      and pa.status = 'active'
  ) then
    raise exception 'patient_record_access_denied' using errcode = '42501';
  end if;

  update public.patients
  set name = v_name
  where id = p_patient_id
  returning jsonb_build_object('id', id, 'name', name)
  into v_result;

  if v_result is null then
    raise exception 'patient_not_found';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.update_my_patient_record_name(uuid, text) from public, anon;
grant execute on function public.update_my_patient_record_name(uuid, text) to authenticated;

-- Include the patient-record name in the same existing change history.
create or replace function private.capture_patient_health_audit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed text[] := array[]::text[];
  v_key text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_tracked_fields text[] := array[
    'name', 'gender', 'birth_date', 'age', 'height', 'diagnosis', 'complaints'
  ];
begin
  if v_actor is null then return new; end if;

  foreach v_key in array v_tracked_fields loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := array_append(v_changed, v_key);
      v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;

  if cardinality(v_changed) = 0 then return new; end if;

  if public.is_admin() then
    v_role := 'admin';
  elsif exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = new.id
      and pa.user_id = v_actor
      and pa.status = 'active'
  ) then
    v_role := 'patient';
  else
    v_role := 'professional';
  end if;

  insert into public.patient_health_audit (
    patient_id, actor_id, actor_role, operation,
    changed_fields, before_values, after_values
  ) values (
    new.id, v_actor, v_role, 'UPDATE',
    v_changed, v_before, v_after
  );

  return new;
end;
$function$;
