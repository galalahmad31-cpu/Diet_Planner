drop policy if exists profiles_update_own_profile on public.profiles;

create policy profiles_update_own_profile
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  and (select public.has_active_subscription((select auth.uid())))
)
with check (
  id = (select auth.uid())
  and (select public.has_active_subscription((select auth.uid())))
);