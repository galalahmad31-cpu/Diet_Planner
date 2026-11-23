-- Remove the patient health change-history feature completely.
-- The audit table currently has zero rows and no inbound foreign-key dependencies.
drop trigger if exists patient_health_audit_capture on public.patients;
drop function if exists private.capture_patient_health_audit();
drop table if exists public.patient_health_audit;
