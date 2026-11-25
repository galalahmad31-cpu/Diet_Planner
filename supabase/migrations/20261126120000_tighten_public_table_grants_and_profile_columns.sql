begin;

-- JOB POSTS
-- Public pages read published rows; admin UI needs full CRUD (RLS remains the gate).
revoke all privileges on table public.job_posts from public, anon, authenticated;
grant select on table public.job_posts to anon, authenticated;
grant insert, update, delete on table public.job_posts to authenticated;

-- APP FEEDBACK
-- Public listing is intentionally served through the narrow, curated projection
-- app_feedback_public. Direct anonymous access to the source table is unnecessary.
drop policy if exists "Public can read feedback" on public.app_feedback;
revoke all privileges on table public.app_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.app_feedback to authenticated;
revoke all privileges on table public.app_feedback_public from public, anon, authenticated;
grant select on table public.app_feedback_public to anon, authenticated;

-- PROFILES
-- Keep read access governed by RLS. Remove direct row creation/deletion and
-- table-wide UPDATE; the profile editor writes only these three editable fields.
revoke all privileges on table public.profiles from public, anon, authenticated;
revoke update (id, full_name, email, phone, profession, created_at, role, account_type)
  on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, profession, phone) on table public.profiles to authenticated;

-- BOOK ORDERS
-- Customers create and read their own orders; administrators review/update.
revoke all privileges on table public.book_orders from public, anon, authenticated;
grant select, insert, update on table public.book_orders to authenticated;

-- BOOKS
-- Published catalogue is public-read; only admins can write (enforced by RLS).
revoke all privileges on table public.books from public, anon, authenticated;
grant select on table public.books to anon, authenticated;
grant insert, update, delete on table public.books to authenticated;

-- BOOK DELIVERY LINKS
-- Admin panel only; customer delivery is mediated by the existing RPC.
revoke all privileges on table public.book_delivery_links from public, anon, authenticated;
grant select, insert, update, delete on table public.book_delivery_links to authenticated;

-- BOOK STORE SETTINGS
-- Public payment instructions are readable; only admins can update.
revoke all privileges on table public.book_store_settings from public, anon, authenticated;
grant select on table public.book_store_settings to anon, authenticated;
grant update on table public.book_store_settings to authenticated;

-- CONTACT SETTINGS
-- Public contact channels are readable; only admins can update.
revoke all privileges on table public.contact_settings from public, anon, authenticated;
grant select on table public.contact_settings to anon, authenticated;
grant update on table public.contact_settings to authenticated;

-- PRIVACY POLICY
-- The published policy is public-read; only admins can edit it.
revoke all privileges on table public.privacy_policy from public, anon, authenticated;
grant select on table public.privacy_policy to anon, authenticated;
grant update on table public.privacy_policy to authenticated;

commit;
