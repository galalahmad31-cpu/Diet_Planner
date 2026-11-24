create policy weight_logs_insert_patient_own
on public.weight_logs
for insert
to authenticated
with check (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy weight_logs_update_patient_own
on public.weight_logs
for update
to authenticated
using (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
)
with check (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy weight_logs_delete_patient_own
on public.weight_logs
for delete
to authenticated
using (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy patient_lab_results_insert_patient_own
on public.patient_lab_results
for insert
to authenticated
with check (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy patient_lab_results_update_patient_own
on public.patient_lab_results
for update
to authenticated
using (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
)
with check (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy patient_lab_results_delete_patient_own
on public.patient_lab_results
for delete
to authenticated
using (
  private.is_active_patient_account(patient_id, (select auth.uid()))
  and created_by = (select auth.uid())
);