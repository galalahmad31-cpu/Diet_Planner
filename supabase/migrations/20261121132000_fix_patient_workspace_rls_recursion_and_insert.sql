-- Resolve the circular RLS dependency between nutrition_plans and
-- patient_plan_publications without weakening the patient workspace gate.

create or replace function private.is_linked_patient_for_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.nutrition_plans np
    join public.patient_accounts pa on pa.patient_id = np.patient_id
    where np.id = p_plan_id
      and pa.user_id = auth.uid()
      and pa.status = 'active'
  );
$function$;

create or replace function private.can_access_plan_publication(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
  select p_plan_id is not null and exists (
    select 1
    from public.nutrition_plans np
    where np.id = p_plan_id
      and private.can_access_patient_workspace(np.patient_id)
  );
$function$;

revoke all on function private.is_linked_patient_for_plan(uuid) from public, anon;
revoke all on function private.can_access_plan_publication(uuid) from public, anon;
grant execute on function private.is_linked_patient_for_plan(uuid) to authenticated;
grant execute on function private.can_access_plan_publication(uuid) to authenticated;

drop policy if exists patient_workspace_access_gate on public.patient_plan_publications;
create policy patient_workspace_access_gate
on public.patient_plan_publications
as restrictive
for all
to authenticated
using (private.can_access_plan_publication(plan_id))
with check (private.can_access_plan_publication(plan_id));

drop policy if exists nutrition_plans_select_admin_or_owner on public.nutrition_plans;
create policy nutrition_plans_select_admin_or_owner
on public.nutrition_plans
as permissive
for select
to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.patients p
    where p.id = nutrition_plans.patient_id
      and p.user_id = (select auth.uid())
  )
  or private.is_linked_patient_for_plan(id)
);

drop policy if exists subscription_required_for_workspace_reads on public.nutrition_plans;
create policy subscription_required_for_workspace_reads
on public.nutrition_plans
as restrictive
for select
to authenticated
using (
  (select public.is_admin())
  or (select public.has_active_subscription((select auth.uid())))
  or private.is_linked_patient_for_plan(id)
);

-- can_add_patient() already validates the active paid subscription and quota.
-- subscription_id is nullable, so it must not independently block valid inserts.
drop policy if exists patients_insert_admin_or_paid_doctor on public.patients;
create policy patients_insert_admin_or_paid_doctor
on public.patients
as permissive
for insert
to authenticated
with check (
  (select public.is_admin())
  or (
    user_id = (select auth.uid())
    and (select public.can_add_patient((select auth.uid())))
  )
);
