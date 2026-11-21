-- Separate patient INSERT authorization from workspace visibility.
-- Inserts use the authoritative owner + subscription/quota gate.
-- Existing workspace isolation remains in SELECT/UPDATE/DELETE policies.

drop policy if exists patient_workspace_access_gate on public.patients;

create policy patient_workspace_select_gate
on public.patients
as restrictive
for select
to authenticated
using (private.can_access_patient_workspace(id));

create policy patient_workspace_update_gate
on public.patients
as restrictive
for update
to authenticated
using (private.can_access_patient_workspace(id))
with check (
  (select public.is_admin())
  or (
    user_id = (select auth.uid())
    and not exists (
      select 1
      from public.professional_connection_requests r
      where r.patient_id = patients.id
        and r.professional_id = (select auth.uid())
        and r.status in ('accepted', 'active')
    )
  )
  or private.can_access_patient_workspace(id)
);

create policy patient_workspace_delete_gate
on public.patients
as restrictive
for delete
to authenticated
using (private.can_access_patient_workspace(id));

create policy patient_workspace_insert_gate
on public.patients
as restrictive
for insert
to authenticated
with check (
  (select public.is_admin())
  or (
    user_id = (select auth.uid())
    and (select public.can_add_patient((select auth.uid())))
  )
);
