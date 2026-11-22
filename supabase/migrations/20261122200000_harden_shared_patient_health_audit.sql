-- Harden the shared patient health record audit trail.
-- Only shared clinical fields are audited; linked patient accounts can read their own history.

create or replace function private.capture_patient_health_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
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
  v_health_fields text[] := array[
    'gender', 'birth_date', 'age', 'height', 'diagnosis', 'complaints'
  ];
begin
  if v_actor is null then return new; end if;

  foreach v_key in array v_health_fields loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := array_append(v_changed, v_key);
      v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;

  if cardinality(v_changed) = 0 then return new; end if;

  if public.is_admin() then
    v_role := 'admin';
  elsif old.user_id = v_actor or exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = new.id and pa.user_id = v_actor and pa.status = 'active'
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

drop policy if exists patient_health_audit_read_participants
  on public.patient_health_audit;

create policy patient_health_audit_read_participants
on public.patient_health_audit
for select to authenticated
using (
  exists (
    select 1 from public.patients p
    where p.id = patient_health_audit.patient_id
      and (
        p.user_id = (select auth.uid())
        or (select public.is_admin())
        or exists (
          select 1 from public.patient_accounts pa
          where pa.patient_id = p.id
            and pa.user_id = (select auth.uid())
            and pa.status = 'active'
        )
        or exists (
          select 1 from public.patient_care_team pct
          where pct.patient_id = p.id
            and pct.professional_id = (select auth.uid())
            and pct.status = 'active'
        )
      )
  )
);

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
set search_path = 'pg_catalog', 'public'
set row_security = 'off'
as $function$
declare
 v_uid uuid := auth.uid();
 v_is_admin boolean;
 v_is_patient boolean;
 v_is_professional boolean;
 v_result jsonb;
begin
 if v_uid is null or p_patient_id is null then
  raise exception 'authentication_required' using errcode = '28000';
 end if;

 select public.is_admin() into v_is_admin;

 select
   exists (select 1 from public.patients p where p.id = p_patient_id and p.user_id = v_uid)
   or exists (
     select 1 from public.patient_accounts pa
     where pa.patient_id = p_patient_id and pa.user_id = v_uid and pa.status = 'active'
   )
 into v_is_patient;

 select exists (
   select 1 from public.patient_care_team pct
   where pct.patient_id = p_patient_id
     and pct.professional_id = v_uid
     and pct.status = 'active'
 ) into v_is_professional;

 if not (v_is_admin or v_is_patient or v_is_professional) then
  raise exception 'patient_workspace_access_denied' using errcode = '42501';
 end if;

 if v_is_professional and not v_is_patient and not v_is_admin
    and private.is_expired_care_professional(p_patient_id) then
  raise exception 'care_agreement_expired_read_only' using errcode = '42501';
 end if;

 if p_gender is not null and p_gender not in ('male', 'female') then
  raise exception 'invalid_gender_value';
 end if;
 if p_birth_date is not null and p_birth_date > current_date then
  raise exception 'birth_date_in_future';
 end if;
 if p_height is not null and (p_height < 30 or p_height > 260) then
  raise exception 'height_out_of_range';
 end if;
 if p_diagnosis is not null and length(p_diagnosis) > 4000 then
  raise exception 'diagnosis_too_long';
 end if;
 if p_complaints is not null and length(p_complaints) > 4000 then
  raise exception 'complaints_too_long';
 end if;

 update public.patients
 set gender = p_gender,
     birth_date = p_birth_date,
     age = case when p_birth_date is null then null
                else extract(year from age(current_date, p_birth_date)) end,
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

revoke all on function public.update_shared_patient_health_profile(
 uuid, text, date, numeric, text, text
) from public, anon;

grant execute on function public.update_shared_patient_health_profile(
 uuid, text, date, numeric, text, text
) to authenticated;
