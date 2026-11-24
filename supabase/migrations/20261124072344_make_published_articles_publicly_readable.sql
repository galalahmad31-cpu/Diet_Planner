-- Public access is read-only; editorial writes remain restricted to administrators.
drop policy if exists articles_authenticated_subscriber_read_published on public.articles;
drop policy if exists articles_public_read_published on public.articles;
drop policy if exists articles_admin_select_all on public.articles;

create policy articles_public_read_published
on public.articles
for select
to anon, authenticated
using (visibility = 'public');

create policy articles_admin_select_all
on public.articles
for select
to authenticated
using (public.is_admin());
