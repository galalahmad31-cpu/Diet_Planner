-- Store one editable public privacy policy document.
create table if not exists public.privacy_policy (
  id smallint primary key default 1 check (id = 1),
  content text not null default '',
  updated_at date not null default current_date
);

alter table public.privacy_policy enable row level security;

insert into public.privacy_policy (id, content, updated_at)
values (1, '', current_date)
on conflict (id) do nothing;

grant select on public.privacy_policy to anon, authenticated;
grant update on public.privacy_policy to authenticated;

drop policy if exists privacy_policy_public_read on public.privacy_policy;
create policy privacy_policy_public_read
on public.privacy_policy
for select
to anon, authenticated
using (id = 1);

drop policy if exists privacy_policy_admin_update on public.privacy_policy;
create policy privacy_policy_admin_update
on public.privacy_policy
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
