-- The account-pair model replaces file-specific archive contact requests.
drop function if exists public.request_archived_patient_contact(uuid);

drop index if exists public.professional_connection_requests_patient_status_idx;
create index professional_connection_requests_requester_status_idx
  on public.professional_connection_requests(requested_by,status,updated_at desc);
