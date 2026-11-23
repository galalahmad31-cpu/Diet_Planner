create or replace function private.can_manage_patient_care(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select p_patient_id is not null
    and auth.uid() is not null
    and (
      private.is_patient_workspace_owner(p_patient_id, auth.uid())
      or private.is_active_patient_professional(p_patient_id, auth.uid())
    );
$function$;

revoke all on function private.can_manage_patient_care(uuid) from public;
grant execute on function private.can_manage_patient_care(uuid) to authenticated;

create or replace function public.create_nutrition_plan(p_patient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_linked_professional boolean := false;
  v_plan_count integer;
  v_max_number integer;
  v_next_number integer;
  v_plan_id uuid;
  v_plan_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_patient_id is null then
    raise exception 'patient_id is required' using errcode = '22023';
  end if;

  if not private.can_manage_patient_care(p_patient_id) then
    raise exception 'Patient care access denied' using errcode = '42501';
  end if;

  v_is_linked_professional :=
    private.is_active_patient_professional(p_patient_id, v_user_id);

  if not v_is_linked_professional
     and not exists (
       select 1 from public.profiles pr
       where pr.id = v_user_id and pr.role = 'admin'
     )
     and not public.has_active_subscription(v_user_id) then
    raise exception 'An active paid subscription is required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_patient_id::text || '|nutrition-plan-sequence', 0)
  );

  select count(*)::integer,
         coalesce(max(nullif(substring(np.plan_name from '^الخطة ([0-9]+)'), '')::integer), 0)
    into v_plan_count, v_max_number
  from public.nutrition_plans np
  where np.patient_id = p_patient_id;

  v_next_number := greatest(v_plan_count, v_max_number) + 1;
  v_plan_name := 'الخطة ' || v_next_number || ' - ' || to_char(current_date, 'DD/MM/YYYY');

  insert into public.nutrition_plans(patient_id, plan_name, start_date)
  values (p_patient_id, v_plan_name, current_date)
  returning id into v_plan_id;

  return v_plan_id;
end;
$function$;

create or replace function public.cancel_patient_appointment(
  p_appointment_id uuid,
  p_cancellation_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
  v_is_patient boolean := false;
  v_is_professional boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_cancellation_note is not null and char_length(p_cancellation_note) > 500 then
    raise exception 'cancellation_note_too_long' using errcode = '22023';
  end if;

  select * into v_appointment
  from public.patient_appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  v_is_patient := private.is_active_patient_account(v_appointment.patient_id, v_user_id);
  v_is_professional :=
    v_appointment.professional_id = v_user_id
    and private.is_active_patient_professional(v_appointment.patient_id, v_user_id);

  if not v_is_patient and not v_is_professional then
    raise exception 'not_authorized_for_appointment' using errcode = '42501';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'appointment_not_cancellable' using errcode = '22023';
  end if;

  update public.patient_appointments
  set status = 'cancelled',
      cancellation_note = nullif(btrim(p_cancellation_note), ''),
      cancelled_at = now(),
      updated_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  return v_appointment;
end;
$function$;

revoke all on function public.create_nutrition_plan(uuid) from public;
grant execute on function public.create_nutrition_plan(uuid) to authenticated;
revoke all on function public.cancel_patient_appointment(uuid, text) from public;
grant execute on function public.cancel_patient_appointment(uuid, text) to authenticated;