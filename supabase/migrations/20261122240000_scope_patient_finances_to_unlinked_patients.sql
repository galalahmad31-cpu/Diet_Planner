-- Keep legacy manual finance records exclusively for patients without an accepted/active care relationship.
-- Existing rows are preserved; this policy only scopes authenticated access.
drop policy if exists patient_finances_unlinked_only on public.patient_finances;

create policy patient_finances_unlinked_only
on public.patient_finances
as restrictive
for all
to authenticated
using (
  public.is_admin()
  or (
    not exists (
      select 1
      from public.professional_connection_requests r
      where r.patient_id = patient_finances.patient_id
        and r.status in ('accepted', 'active')
    )
    and not exists (
      select 1
      from public.patient_care_team pct
      where pct.patient_id = patient_finances.patient_id
        and pct.status = 'active'
    )
  )
)
with check (
  public.is_admin()
  or (
    not exists (
      select 1
      from public.professional_connection_requests r
      where r.patient_id = patient_finances.patient_id
        and r.status in ('accepted', 'active')
    )
    and not exists (
      select 1
      from public.patient_care_team pct
      where pct.patient_id = patient_finances.patient_id
        and pct.status = 'active'
    )
  )
);
