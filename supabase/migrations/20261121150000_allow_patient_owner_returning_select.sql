-- Allow an authenticated owner to read their own patient row.
-- Required by PostgREST INSERT ... RETURNING, which evaluates SELECT RLS.

drop policy if exists patient_workspace_select_gate on public.patients;
create policy patient_workspace_select_gate
on public.patients
as restrictive
for select
to authenticated
using (
  (select public.is_admin())
  or user_id = (select auth.uid())
  or private.can_access_patient_workspace(id)
);

-- This subscription gate is specific to nutrition plans and was duplicated
-- on patients. Patient insert quotas and ownership are enforced separately.
drop policy if exists subscription_required_for_workspace_reads on public.patients;
