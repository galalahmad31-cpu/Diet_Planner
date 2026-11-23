drop policy if exists care_agreement_not_expired_delete on public.nutrition_plans;
drop policy if exists care_agreement_not_expired_insert on public.nutrition_plans;
drop policy if exists care_agreement_not_expired_update on public.nutrition_plans;
drop policy if exists nutrition_plans_delete_admin_or_owner on public.nutrition_plans;
drop policy if exists nutrition_plans_insert_admin_or_paid_doctor on public.nutrition_plans;
drop policy if exists nutrition_plans_select_admin_or_owner on public.nutrition_plans;
drop policy if exists nutrition_plans_update_admin_or_paid_doctor on public.nutrition_plans;
drop policy if exists subscription_required_for_workspace_reads on public.nutrition_plans;
drop policy if exists patient_workspace_access_gate on public.nutrition_plans;

create policy nutrition_plans_select_patient_workspace
on public.nutrition_plans
for select to authenticated
using (private.can_access_patient_workspace(patient_id));

create policy nutrition_plans_insert_care_manager
on public.nutrition_plans
for insert to authenticated
with check (private.can_manage_patient_care(patient_id));

create policy nutrition_plans_update_care_manager
on public.nutrition_plans
for update to authenticated
using (private.can_manage_patient_care(patient_id))
with check (private.can_manage_patient_care(patient_id));

create policy nutrition_plans_delete_care_manager
on public.nutrition_plans
for delete to authenticated
using (private.can_manage_patient_care(patient_id));