alter table public.notifications
  drop constraint if exists notifications_event_type_check;

alter table public.notifications
  add constraint notifications_event_type_check
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
    'appointment_requested',
    'appointment_confirmed',
    'appointment_declined',
    'appointment_cancelled',
    'care_agreement_proposed'
  ]::text[]));
