begin;

revoke insert on table public.patient_messages from authenticated;
grant insert (patient_id, sender_id, recipient_id, body)
  on table public.patient_messages to authenticated;

revoke insert on table public.patient_appointments from authenticated;
grant insert (
  patient_id,
  professional_id,
  requested_by,
  scheduled_at,
  duration_minutes,
  appointment_type,
  patient_note
) on table public.patient_appointments to authenticated;

commit;