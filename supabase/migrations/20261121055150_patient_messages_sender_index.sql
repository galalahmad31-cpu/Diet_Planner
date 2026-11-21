create index if not exists patient_messages_sender_created_idx
  on public.patient_messages (sender_id, created_at desc);