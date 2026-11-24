drop policy if exists weight_logs_insert_patient_own on public.weight_logs;
drop policy if exists weight_logs_update_patient_own on public.weight_logs;
drop policy if exists weight_logs_delete_patient_own on public.weight_logs;

drop policy if exists patient_lab_results_insert_patient_own on public.patient_lab_results;
drop policy if exists patient_lab_results_update_patient_own on public.patient_lab_results;
drop policy if exists patient_lab_results_delete_patient_own on public.patient_lab_results;

drop policy if exists weight_logs_insert_owner on public.weight_logs;
drop policy if exists weight_logs_update_owner on public.weight_logs;
drop policy if exists weight_logs_delete_owner on public.weight_logs;

create policy weight_logs_insert_owner
on public.weight_logs
for insert
to authenticated
with check (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and has_active_subscription((select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

create policy weight_logs_update_owner
on public.weight_logs
for update
to authenticated
using (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and has_active_subscription((select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
)
with check (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and has_active_subscription((select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

create policy weight_logs_delete_owner
on public.weight_logs
for delete
to authenticated
using (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and has_active_subscription((select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

drop policy if exists patient_lab_results_insert_owner on public.patient_lab_results;
drop policy if exists patient_lab_results_update_owner on public.patient_lab_results;
drop policy if exists patient_lab_results_delete_owner on public.patient_lab_results;

create policy patient_lab_results_insert_owner
on public.patient_lab_results
for insert
to authenticated
with check (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

create policy patient_lab_results_update_owner
on public.patient_lab_results
for update
to authenticated
using (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
)
with check (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

create policy patient_lab_results_delete_owner
on public.patient_lab_results
for delete
to authenticated
using (
  (
    private.is_patient_workspace_owner(patient_id, (select auth.uid()))
    and not private.is_patient_followup_expired(patient_id)
  )
  or
  (
    private.is_active_patient_account(patient_id, (select auth.uid()))
    and created_by = (select auth.uid())
  )
);

create index if not exists patient_lab_results_created_by_idx
on public.patient_lab_results (created_by);