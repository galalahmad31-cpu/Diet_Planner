-- Reuse patient_appointments for professional-created, mutually agreed appointments.
-- Standalone records remain owned by the professional; linked records require an active care-team relationship.
create policy patient_appointments_select_professional_owned
on public.patient_appointments
for select to authenticated
using (
  professional_id = (select auth.uid())
  and (
    exists (
      select 1 from public.patients p
      where p.id = patient_appointments.patient_id
        and p.user_id = (select auth.uid())
        and not exists (
          select 1 from public.professional_connection_requests r
          where r.patient_id = p.id and r.professional_id = (select auth.uid())
            and r.status in ('accepted','active')
        )
    )
    or private.is_active_patient_care_team_member(patient_id, (select auth.uid()))
  )
);

create or replace function public.create_professional_patient_appointment(
  p_patient_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 30,
  p_appointment_type text default 'online',
  p_professional_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_patient_id is null then raise exception 'patient_required'; end if;
  if p_scheduled_at is null or p_scheduled_at <= now() then raise exception 'appointment_must_be_in_future'; end if;
  if p_duration_minutes is null or p_duration_minutes not between 15 and 180 then raise exception 'invalid_duration'; end if;
  if p_appointment_type is null or p_appointment_type not in ('online','in_person','phone') then raise exception 'invalid_appointment_type'; end if;
  if p_professional_note is not null and char_length(p_professional_note) > 1000 then raise exception 'professional_note_too_long'; end if;

  if not (
    public.is_admin()
    or private.is_active_patient_care_team_member(p_patient_id, v_uid)
    or exists (
      select 1 from public.patients p
      where p.id = p_patient_id and p.user_id = v_uid
        and not exists (
          select 1 from public.professional_connection_requests r
          where r.patient_id = p.id and r.professional_id = v_uid
            and r.status in ('accepted','active')
        )
    )
  ) then raise exception 'not_authorized_for_patient'; end if;

  if not public.is_admin() and not private.professional_has_active_subscription(v_uid) then
    raise exception 'active_professional_subscription_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if exists (
    select 1 from public.patient_appointments a
    where a.professional_id = v_uid and a.status = 'confirmed'
      and a.scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and a.scheduled_at + make_interval(mins => a.duration_minutes) > p_scheduled_at
  ) then raise exception 'appointment_time_conflict'; end if;

  insert into public.patient_appointments (
    patient_id, professional_id, requested_by, scheduled_at,
    duration_minutes, appointment_type, status, professional_note, decided_at
  ) values (
    p_patient_id, v_uid, v_uid, p_scheduled_at,
    p_duration_minutes, p_appointment_type, 'confirmed',
    nullif(btrim(p_professional_note), ''), now()
  ) returning * into v_appointment;

  return v_appointment;
end;
$function$;

revoke all on function public.create_professional_patient_appointment(uuid,timestamptz,integer,text,text) from public, anon;
grant execute on function public.create_professional_patient_appointment(uuid,timestamptz,integer,text,text) to authenticated;
