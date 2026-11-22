begin;

create or replace function public.cancel_patient_appointment(
  p_appointment_id uuid,
  p_cancellation_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
  v_is_patient boolean := false;
  v_is_professional boolean := false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_cancellation_note is not null and char_length(p_cancellation_note) > 500 then
    raise exception 'cancellation_note_too_long';
  end if;

  select * into v_appointment
  from public.patient_appointments
  where id = p_appointment_id
  for update;
  if not found then raise exception 'appointment_not_found'; end if;

  select exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = v_appointment.patient_id
      and pa.user_id = v_user_id and pa.status = 'active'
  ) into v_is_patient;

  select v_appointment.professional_id = v_user_id and (
    private.is_active_patient_care_team_member(v_appointment.patient_id, v_user_id)
    or exists (
      select 1 from public.patients p
      where p.id = v_appointment.patient_id and p.user_id = v_user_id
        and not exists (
          select 1 from public.professional_connection_requests r
          where r.patient_id = p.id and r.professional_id = v_user_id
            and r.status in ('accepted','active')
        )
    )
  ) into v_is_professional;

  if not v_is_patient and not v_is_professional then
    raise exception 'not_authorized_for_appointment';
  end if;
  if v_appointment.status not in ('pending','confirmed') then
    raise exception 'appointment_not_cancellable';
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
$function$;

create or replace function public.respond_patient_appointment(
  p_appointment_id uuid,
  p_decision text,
  p_professional_note text default null
)
returns public.patient_appointments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_appointment public.patient_appointments%rowtype;
  v_is_active_care_professional boolean := false;
  v_is_record_owner boolean := false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_decision is null or p_decision not in ('confirm','decline','complete') then
    raise exception 'invalid_appointment_decision';
  end if;
  if p_professional_note is not null and char_length(p_professional_note) > 1000 then
    raise exception 'professional_note_too_long';
  end if;

  select * into v_appointment
  from public.patient_appointments
  where id = p_appointment_id
  for update;
  if not found then raise exception 'appointment_not_found'; end if;

  if v_appointment.professional_id <> v_user_id then
    raise exception 'not_authorized_for_appointment';
  end if;

  v_is_active_care_professional :=
    private.is_active_patient_care_team_member(v_appointment.patient_id, v_user_id);

  select exists (
    select 1 from public.patients p
    where p.id = v_appointment.patient_id and p.user_id = v_user_id
      and not exists (
        select 1 from public.professional_connection_requests r
        where r.patient_id = p.id and r.professional_id = v_user_id
          and r.status in ('accepted','active')
      )
  ) into v_is_record_owner;

  if p_decision in ('confirm','decline') then
    if not v_is_active_care_professional then
      raise exception 'active_care_relationship_required';
    end if;
    if v_appointment.status <> 'pending' then
      raise exception 'only_pending_appointments_can_be_decided';
    end if;
  elsif not (v_is_active_care_professional or v_is_record_owner) then
    raise exception 'not_authorized_for_appointment';
  elsif v_appointment.status <> 'confirmed' then
    raise exception 'only_confirmed_appointments_can_be_completed';
  end if;

  if p_decision = 'confirm' then
    if v_appointment.scheduled_at <= now() then
      raise exception 'past_appointments_cannot_be_confirmed';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_appointment.professional_id::text, 0));
    if exists (
      select 1 from public.patient_appointments other
      where other.professional_id = v_appointment.professional_id
        and other.id <> v_appointment.id
        and other.status = 'confirmed'
        and other.scheduled_at < v_appointment.scheduled_at
          + make_interval(mins => v_appointment.duration_minutes)
        and other.scheduled_at + make_interval(mins => other.duration_minutes)
          > v_appointment.scheduled_at
    ) then raise exception 'appointment_time_conflict'; end if;
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
$function$;

create or replace function private.emit_patient_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_recipient_id uuid;
  v_event_type text;
  v_title text;
  v_body text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' then
    v_event_type := 'appointment_confirmed';
    v_title := 'تم تأكيد موعدك';
    v_body := 'تم تأكيد موعد المتابعة. يمكنك مراجعة تفاصيله في بوابة المريض.';
  elsif new.status = 'declined' then
    v_event_type := 'appointment_declined';
    v_title := 'لم تتم الموافقة على الموعد';
    v_body := 'لم تتم الموافقة على طلب الموعد. يمكنك التواصل مع المختص لتحديد موعد آخر.';
  elsif new.status = 'cancelled' then
    v_event_type := 'appointment_cancelled';
    v_title := 'تم إلغاء الموعد';
    v_body := 'تم إلغاء موعد المتابعة. راجع تفاصيل الموعد لمعرفة الحالة.';
  else
    return new;
  end if;

  if v_actor_id = new.professional_id then
    select pa.user_id into v_recipient_id
    from public.patient_accounts pa
    where pa.patient_id = new.patient_id and pa.status = 'active'
    order by pa.linked_at desc
    limit 1;
  else
    v_recipient_id := new.professional_id;
  end if;

  if v_recipient_id is not null and v_recipient_id is distinct from v_actor_id then
    insert into public.notifications(recipient_id, actor_id, event_type, title, body)
    values (v_recipient_id, v_actor_id, v_event_type, v_title, v_body);
  end if;
  return new;
end;
$function$;

revoke all on function private.emit_patient_appointment_notification() from public, anon, authenticated;
drop trigger if exists trg_patient_appointment_notification on public.patient_appointments;
create trigger trg_patient_appointment_notification
after insert or update of status on public.patient_appointments
for each row execute function private.emit_patient_appointment_notification();

revoke all on function public.cancel_patient_appointment(uuid,text) from public, anon;
grant execute on function public.cancel_patient_appointment(uuid,text) to authenticated;
revoke all on function public.respond_patient_appointment(uuid,text,text) from public, anon;
grant execute on function public.respond_patient_appointment(uuid,text,text) to authenticated;

commit;