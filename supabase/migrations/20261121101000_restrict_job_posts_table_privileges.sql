alter table public.job_posts
  revoke all privileges on table public.job_posts from public, anon, authenticated;
grant select on table public.job_posts to anon, authenticated;
grant insert, update, delete on table public.job_posts to authenticated;
