begin;

drop policy if exists patient_plan_publications_select_linked_patient_or_owner
  on public.patient_plan_publications;

create policy patient_plan_publications_select_linked_patient_or_owner
  on public.patient_plan_publications
  for select to authenticated
  using (
    published_by = (select auth.uid())
    or (
      revoked_at is null
      and (select private.is_linked_patient_for_plan(plan_id))
    )
  );

commit;
