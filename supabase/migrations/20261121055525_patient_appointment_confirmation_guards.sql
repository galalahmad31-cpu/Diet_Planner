create or replace function public.respond_patient_appointment(
  p_appointment_id uuid,
  p_decision text,
  p_professional_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_decision is null or p_decision not in ('confirm','decline','complete') then
    raise exception 'Invalid appointment decision';
  end if;

  select * into v_appointment
  from public.patient_appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'Appointment not found';
  end if;

  if v_appointment.professional_id <> v_user_id
    or not exists (
      select 1 from public.patient_care_team pct
      where pct.patient_id = v_appointment.patient_id
        and pct.professional_id = v_user_id
        and pct.status = 'active'
    ) then
    raise exception 'Not authorized for this appointment';
  end if;

  if p_decision in ('confirm','decline') and v_appointment.status <> 'pending' then
    raise exception 'Only pending appointments can be confirmed or declined';
  end if;

  if p_decision = 'complete' and v_appointment.status <> 'confirmed' then
    raise exception 'Only confirmed appointments can be completed';
  end if;

  if p_decision = 'confirm' then
    if v_appointment.scheduled_at <= now() then
      raise exception 'Past appointments cannot be confirmed';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_appointment.professional_id::text, 0));

    if exists (
      select 1
      from public.patient_appointments other
      where other.professional_id = v_appointment.professional_id
        and other.id <> v_appointment.id
        and other.status = 'confirmed'
        and other.scheduled_at < v_appointment.scheduled_at
          + make_interval(mins => v_appointment.duration_minutes)
        and other.scheduled_at
          + make_interval(mins => other.duration_minutes) > v_appointment.scheduled_at
    ) then
      raise exception 'This time overlaps another confirmed appointment';
    end if;
  end if;

  update public.patient_appointments
  set status = case p_decision
        when 'confirm' then 'confirmed'
        when 'decline' then 'declined'
        else 'completed'
      end,
      professional_note = coalesce(nullif(btrim(p_professional_note),''), professional_note),
      decided_at = case when p_decision in ('confirm','decline') then now() else decided_at end,
      updated_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  return v_appointment;
end;
$$;

revoke all on function public.respond_patient_appointment(uuid,text,text) from public, anon;
grant execute on function public.respond_patient_appointment(uuid,text,text) to authenticated;