begin;

alter table public.notifications drop constraint if exists notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
check (event_type = any (array[
  'connection_request_received',
  'connection_request_accepted',
  'connection_request_declined',
  'patient_agreement_confirmed',
  'professional_agreement_confirmed',
  'payment_sent',
  'followup_activated',
  'followup_ended',
  'message_received',
  'nutrition_plan_published',
  'appointment_confirmed',
  'appointment_declined',
  'appointment_cancelled'
]::text[]));

create or replace function private.emit_patient_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_type text;
  v_title text;
  v_body text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' then
    v_event_type := 'appointment_confirmed';
    v_title := 'تم تأكيد موعدك';
    v_body := 'وافق المختص على موعدك. يمكنك مراجعة تفاصيل الموعد في بوابة المريض.';
  elsif new.status = 'declined' then
    v_event_type := 'appointment_declined';
    v_title := 'لم تتم الموافقة على الموعد';
    v_body := 'لم يوافق المختص على طلب الموعد. يمكنك التواصل معه لتحديد موعد آخر.';
  elsif new.status = 'cancelled' and v_actor_id = new.professional_id then
    v_event_type := 'appointment_cancelled';
    v_title := 'تم إلغاء الموعد';
    v_body := 'قام المختص بإلغاء موعد المتابعة. راجع تفاصيل الموعد لمعرفة الحالة.';
  else
    -- A patient does not need a notification for an action they initiated.
    return new;
  end if;

  if new.requested_by is not null
     and v_actor_id is distinct from new.requested_by then
    insert into public.notifications(recipient_id, actor_id, event_type, title, body)
    values (new.requested_by, v_actor_id, v_event_type, v_title, v_body);
  end if;

  return new;
end;
$$;

revoke all on function private.emit_patient_appointment_notification() from public, anon, authenticated;

drop trigger if exists trg_patient_appointment_notification on public.patient_appointments;
create trigger trg_patient_appointment_notification
after update of status on public.patient_appointments
for each row
execute function private.emit_patient_appointment_notification();

commit;