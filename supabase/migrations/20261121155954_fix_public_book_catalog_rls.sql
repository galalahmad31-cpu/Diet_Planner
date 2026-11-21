-- Keep public catalog reads independent from the admin-only helper function.
-- The previous combined policy called is_admin() for anon requests, but anon
-- intentionally has no EXECUTE permission on that security-definer function.
drop policy if exists books_public_and_admin_read on public.books;
drop policy if exists books_public_read_published on public.books;
drop policy if exists books_admin_read_all on public.books;

create policy books_public_read_published on public.books
for select to anon, authenticated
using (status = 'published');

create policy books_admin_read_all on public.books
for select to authenticated
using ((select public.is_admin()));
