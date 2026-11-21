create or replace function private.can_manage_plan_meal(p_meal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
  select p_meal_id is not null and (
    public.is_admin()
    or (
      public.has_active_subscription(auth.uid())
      and exists (
        select 1
        from public.plan_meals pm
        join public.plan_days pd on pd.id = pm.day_id
        join public.nutrition_plans np on np.id = pd.plan_id
        join public.patients p on p.id = np.patient_id
        where pm.id = p_meal_id
          and p.user_id = auth.uid()
      )
    )
  );
$function$;

revoke all on function private.can_manage_plan_meal(uuid) from public, anon;
grant execute on function private.can_manage_plan_meal(uuid) to authenticated;

drop policy if exists plan_items_insert_admin_or_paid_doctor on public.plan_items;
create policy plan_items_insert_admin_or_paid_doctor on public.plan_items
as permissive for insert to authenticated
with check (private.can_manage_plan_meal(meal_id));

drop policy if exists plan_items_update_admin_or_paid_doctor on public.plan_items;
create policy plan_items_update_admin_or_paid_doctor on public.plan_items
as permissive for update to authenticated
using (private.can_manage_plan_meal(meal_id))
with check (private.can_manage_plan_meal(meal_id));

drop policy if exists plan_items_delete_admin_or_owner on public.plan_items;
create policy plan_items_delete_admin_or_owner on public.plan_items
as permissive for delete to authenticated
using (private.can_manage_plan_meal(meal_id));
