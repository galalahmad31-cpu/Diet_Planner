-- Keep one SELECT policy per role on each directory table while preserving
-- private owner/admin reads and subscription-gated public visibility.
begin;

drop policy if exists professional_directory_public_read on public.professional_directory_profiles;
drop policy if exists professional_directory_owner_read on public.professional_directory_profiles;
drop policy if exists professional_directory_admin_read on public.professional_directory_profiles;

create policy professional_directory_anon_read
on public.professional_directory_profiles
for select
to anon
using (
  listing_status = 'published'
  and is_verified
  and private.professional_has_active_subscription(user_id)
);

create policy professional_directory_authenticated_read
on public.professional_directory_profiles
for select
to authenticated
using (
  (
    listing_status = 'published'
    and is_verified
    and private.professional_has_active_subscription(user_id)
  )
  or user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists professional_directory_offers_owner_read on public.professional_directory_offers;
drop policy if exists professional_directory_offers_public_read on public.professional_directory_offers;

create policy professional_directory_offers_anon_read
on public.professional_directory_offers
for select
to anon
using (
  is_active = true
  and exists (
    select 1
    from public.professional_directory_profiles p
    where p.user_id = professional_directory_offers.professional_id
      and p.listing_status = 'published'
      and p.is_verified
      and private.professional_has_active_subscription(p.user_id)
  )
);

create policy professional_directory_offers_authenticated_read
on public.professional_directory_offers
for select
to authenticated
using (
  professional_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1
      from public.professional_directory_profiles p
      where p.user_id = professional_directory_offers.professional_id
        and p.listing_status = 'published'
        and p.is_verified
        and private.professional_has_active_subscription(p.user_id)
    )
  )
);

commit;