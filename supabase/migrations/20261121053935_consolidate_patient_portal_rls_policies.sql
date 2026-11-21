begin;

drop policy if exists patients_select_linked_patient on public.patients;
drop policy if exists patients_select_admin_or_owner on public.patients;
create policy patients_select_admin_or_owner on public.patients
  for select to authenticated
  using (
    (select public.is_admin())
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patients.id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists nutrition_plans_select_published_patient on public.nutrition_plans;
drop policy if exists nutrition_plans_select_admin_or_owner on public.nutrition_plans;
create policy nutrition_plans_select_admin_or_owner on public.nutrition_plans
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.patients p
      where p.id = nutrition_plans.patient_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.patient_plan_publications pp
      join public.patient_accounts pa on pa.patient_id = nutrition_plans.patient_id
      where pp.plan_id = nutrition_plans.id
        and pp.revoked_at is null
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists plan_days_select_published_patient on public.plan_days;
drop policy if exists plan_days_select_admin_or_owner on public.plan_days;
create policy plan_days_select_admin_or_owner on public.plan_days
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.nutrition_plans np
      join public.patients p on p.id = np.patient_id
      where np.id = plan_days.plan_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.nutrition_plans np
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where np.id = plan_days.plan_id
        and pp.revoked_at is null
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists plan_meals_select_published_patient on public.plan_meals;
drop policy if exists plan_meals_select_admin_or_owner on public.plan_meals;
create policy plan_meals_select_admin_or_owner on public.plan_meals
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.plan_days pd
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patients p on p.id = np.patient_id
      where pd.id = plan_meals.day_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.plan_days pd
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pd.id = plan_meals.day_id
        and pp.revoked_at is null
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists plan_items_select_published_patient on public.plan_items;
drop policy if exists plan_items_select_admin_or_owner on public.plan_items;
create policy plan_items_select_admin_or_owner on public.plan_items
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patients p on p.id = np.patient_id
      where pm.id = plan_items.meal_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pm.id = plan_items.meal_id
        and pp.revoked_at is null
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists weight_logs_select_linked_patient on public.weight_logs;
drop policy if exists weight_logs_select_admin_or_owner on public.weight_logs;
create policy weight_logs_select_admin_or_owner on public.weight_logs
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.patients p
      where p.id = weight_logs.patient_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = weight_logs.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists weight_logs_insert_linked_patient on public.weight_logs;
drop policy if exists "Users can create own weight logs" on public.weight_logs;
create policy "Users can create own weight logs" on public.weight_logs
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (
      (select public.has_active_subscription((select auth.uid())))
      and exists (
        select 1 from public.patients p
        where p.id = weight_logs.patient_id
          and p.user_id = (select auth.uid())
      )
    )
    or exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = weight_logs.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

commit;
