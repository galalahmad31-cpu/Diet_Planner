create or replace function public.update_shared_patient_health_profile(
  p_patient_id uuid,
  p_gender text default null,
  p_birth_date date default null,
  p_height numeric default null,
  p_diagnosis text default null,
  p_complaints text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_patient boolean := false;
  v_is_owner boolean := false;
  v_is_linked_professional boolean := false;
  v_result jsonb;
begin
  if v_uid is null or p_patient_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = p_patient_id
      and pa.user_id = v_uid
      and pa.status = 'active'
  ) into v_is_patient;

  select exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and private.is_patient_workspace_owner(p.id, v_uid)
  ) into v_is_owner;

  v_is_linked_professional :=
    private.is_active_patient_professional(p_patient_id, v_uid);

  if not (v_is_patient or v_is_owner or v_is_linked_professional) then
    raise exception 'patient_workspace_access_denied' using errcode = '42501';
  end if;

  if not v_is_patient and not v_is_linked_professional
     and private.is_expired_care_professional(p_patient_id) then
    raise exception 'care_agreement_expired_read_only' using errcode = '42501';
  end if;

  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender_value'; end if;
  if p_birth_date is not null and p_birth_date > current_date then raise exception 'birth_date_in_future'; end if;
  if p_height is not null and (p_height < 30 or p_height > 260) then raise exception 'height_out_of_range'; end if;
  if p_diagnosis is not null and length(p_diagnosis) > 4000 then raise exception 'diagnosis_too_long'; end if;
  if p_complaints is not null and length(p_complaints) > 4000 then raise exception 'complaints_too_long'; end if;

  update public.patients
  set gender = p_gender,
      birth_date = p_birth_date,
      age = case when p_birth_date is null then null else extract(year from age(current_date, p_birth_date)) end,
      height = p_height,
      diagnosis = nullif(trim(p_diagnosis), ''),
      complaints = nullif(trim(p_complaints), '')
  where id = p_patient_id
  returning jsonb_build_object(
    'id', id, 'name', name, 'gender', gender, 'birth_date', birth_date,
    'age', age, 'height', height, 'diagnosis', diagnosis, 'complaints', complaints
  ) into v_result;

  if v_result is null then raise exception 'patient_not_found'; end if;
  return v_result;
end;
$function$;

revoke all on function public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text) from public;
grant execute on function public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text) to authenticated;