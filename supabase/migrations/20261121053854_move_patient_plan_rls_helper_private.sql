begin;

create or replace function private.is_linked_patient_for_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.nutrition_plans np
    join public.patient_accounts pa on pa.patient_id = np.patient_id
    where np.id = p_plan_id
      and pa.user_id = auth.uid()
      and pa.status = 'active'
  );
$$;

revoke all on function private.is_linked_patient_for_plan(uuid) from public, anon;
grant execute on function private.is_linked_patient_for_plan(uuid) to authenticated;

drop policy if exists patient_plan_publications_select_linked_patient_or_owner
  on public.patient_plan_publications;

create policy patient_plan_publications_select_linked_patient_or_owner
  on public.patient_plan_publications for select to authenticated
  using (
    revoked_at is null and (
      published_by = (select auth.uid())
      or (select private.is_linked_patient_for_plan(plan_id))
    )
  );

revoke all on function public.is_linked_patient_for_plan(uuid) from public, anon, authenticated;
drop function public.is_linked_patient_for_plan(uuid);

commit;
