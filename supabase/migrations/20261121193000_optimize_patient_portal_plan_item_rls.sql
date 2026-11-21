-- Replace row-by-row multi-join plan_items SELECT RLS checks with indexed
-- SECURITY DEFINER predicates. Keep the existing write authorization policies.
create or replace function private.can_access_plan_meal_workspace(p_meal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
  select p_meal_id is not null and exists (
    select 1
    from public.plan_meals pm
    join public.plan_days pd on pd.id = pm.day_id
    join public.nutrition_plans np on np.id = pd.plan_id
    where pm.id = p_meal_id
      and private.can_access_patient_workspace(np.patient_id)
  );
$function$;

create or replace function private.can_read_plan_meal(p_meal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
  select p_meal_id is not null and exists (
    select 1
    from public.plan_meals pm
    join public.plan_days pd on pd.id = pm.day_id
    join public.nutrition_plans np on np.id = pd.plan_id
    join public.patients p on p.id = np.patient_id
    where pm.id = p_meal_id
      and (
        public.is_admin()
        or (
          private.can_access_patient_workspace(np.patient_id)
          and (
            (
              p.user_id = auth.uid()
              and public.has_active_subscription(auth.uid())
            )
            or exists (
              select 1
              from public.patient_plan_publications pp
              join public.patient_accounts pa on pa.patient_id = np.patient_id
              where pp.plan_id = np.id
                and pp.revoked_at is null
                and pa.user_id = auth.uid()
                and pa.status = 'active'
            )
          )
        )
      )
  );
$function$;

revoke all on function private.can_access_plan_meal_workspace(uuid) from public, anon;
revoke all on function private.can_read_plan_meal(uuid) from public, anon;
grant execute on function private.can_access_plan_meal_workspace(uuid) to authenticated;
grant execute on function private.can_read_plan_meal(uuid) to authenticated;

drop policy if exists patient_workspace_access_gate on public.plan_items;
drop policy if exists subscription_required_for_workspace_reads on public.plan_items;
drop policy if exists plan_items_select_admin_or_owner on public.plan_items;

create policy plan_items_select_authorized
on public.plan_items
as permissive
for select
to authenticated
using (private.can_read_plan_meal(meal_id));

create policy plan_items_workspace_insert_gate
on public.plan_items
as restrictive
for insert
to authenticated
with check (private.can_access_plan_meal_workspace(meal_id));

create policy plan_items_workspace_update_gate
on public.plan_items
as restrictive
for update
to authenticated
using (private.can_access_plan_meal_workspace(meal_id))
with check (private.can_access_plan_meal_workspace(meal_id));

create policy plan_items_workspace_delete_gate
on public.plan_items
as restrictive
for delete
to authenticated
using (private.can_access_plan_meal_workspace(meal_id));
