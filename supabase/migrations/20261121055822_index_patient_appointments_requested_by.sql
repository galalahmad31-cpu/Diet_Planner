create index if not exists patient_appointments_requested_by_idx
  on public.patient_appointments (requested_by, created_at desc);