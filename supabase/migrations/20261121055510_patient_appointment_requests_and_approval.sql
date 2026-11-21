begin;

create table if not exists public.patient_appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30
    check (duration_minutes between 15 and 180),
  appointment_type text not null default 'online'
    check (appointment_type = any (array['online'::text,'in_person'::text,'phone'::text])),
  status text not null default 'pending'
    check (status = any (array['pending'::text,'confirmed'::text,'declined'::text,'cancelled'::text,'completed'::text])),
  patient_note text
    check (patient_note is null or char_length(patient_note) <= 1000),
  professional_note text
    check (professional_note is null or char_length(professional_note) <= 1000),
  cancellation_note text
    check (cancellation_note is null or char_length(cancellation_note) <= 500),
  decided_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_appointments_future_slot check (scheduled_at > created_at)
);

create index if not exists patient_appointments_patient_schedule_idx
  on public.patient_appointments (patient_id, scheduled_at desc);
create index if not exists patient_appointments_professional_schedule_idx
  on public.patient_appointments (professional_id, scheduled_at)
  where status in ('pending','confirmed');

alter table public.patient_appointments enable row level security;
revoke all on table public.patient_appointments from anon, authenticated, public;
grant select, insert on table public.patient_appointments to authenticated;

drop policy if exists patient_appointments_select_participants on public.patient_appointments;
create policy patient_appointments_select_participants
  on public.patient_appointments
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patient_appointments.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
    or (
      professional_id = (select auth.uid())
      and exists (
        select 1
        from public.patient_care_team pct
        where pct.patient_id = patient_appointments.patient_id
          and pct.professional_id = (select auth.uid())
          and pct.status = 'active'
      )
    )
  );

drop policy if exists patient_appointments_insert_patient_request on public.patient_appointments;
create policy patient_appointments_insert_patient_request
  on public.patient_appointments
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and status = 'pending'
    and decided_at is null
    and cancelled_at is null
    and scheduled_at > now()
    and exists (
      select 1
      from public.patient_accounts pa
      join public.patient_care_team pct
        on pct.patient_id = pa.patient_id
      where pa.patient_id = patient_appointments.patient_id
        and pa.user_id = requested_by
        and pa.status = 'active'
        and pct.professional_id = patient_appointments.professional_id
        and pct.status = 'active'
    )
  );

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

  if p_decision not in ('confirm','decline','complete') then
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

create or replace function public.cancel_patient_appointment(
  p_appointment_id uuid,
  p_cancellation_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
  v_is_patient boolean := false;
  v_is_professional boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_appointment
  from public.patient_appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'Appointment not found';
  end if;

  select exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = v_appointment.patient_id
      and pa.user_id = v_user_id
      and pa.status = 'active'
  ) into v_is_patient;

  select exists (
    select 1 from public.patient_care_team pct
    where pct.patient_id = v_appointment.patient_id
      and pct.professional_id = v_user_id
      and pct.status = 'active'
  ) and v_appointment.professional_id = v_user_id into v_is_professional;

  if not v_is_patient and not v_is_professional then
    raise exception 'Not authorized for this appointment';
  end if;

  if v_appointment.status not in ('pending','confirmed') then
    raise exception 'Only pending or confirmed appointments can be cancelled';
  end if;

  update public.patient_appointments
  set status = 'cancelled',
      cancellation_note = nullif(btrim(p_cancellation_note),''),
      cancelled_at = now(),
      updated_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  return v_appointment;
end;
$$;

revoke all on function public.respond_patient_appointment(uuid,text,text) from public, anon;
revoke all on function public.cancel_patient_appointment(uuid,text) from public, anon;
grant execute on function public.respond_patient_appointment(uuid,text,text) to authenticated;
grant execute on function public.cancel_patient_appointment(uuid,text) to authenticated;

commit;