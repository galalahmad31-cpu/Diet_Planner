begin;

drop policy if exists "Users can view own profile and admins can view all profiles"
  on public.profiles;

create policy "Users can view own profile and admins can view all profiles"
  on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select is_admin())
    or exists (
      select 1
      from public.patient_accounts pa
      join public.patient_care_team pct
        on pct.patient_id = pa.patient_id
      where pa.user_id = (select auth.uid())
        and pa.status = 'active'
        and pct.professional_id = profiles.id
        and pct.status = 'active'
    )
  );

commit;