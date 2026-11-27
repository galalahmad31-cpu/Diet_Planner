begin;

alter table public.profiles
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz;

create or replace function public.sync_profile_auth_status_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email_confirmed_at = new.email_confirmed_at,
         last_sign_in_at = new.last_sign_in_at
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_auth_status_after_auth_change on auth.users;
create trigger sync_profile_auth_status_after_auth_change
after insert or update of email_confirmed_at, last_sign_in_at
on auth.users
for each row
execute function public.sync_profile_auth_status_from_auth();

update public.profiles p
   set email_confirmed_at = u.email_confirmed_at,
       last_sign_in_at = u.last_sign_in_at
  from auth.users u
 where u.id = p.id
   and (
     p.email_confirmed_at is distinct from u.email_confirmed_at
     or p.last_sign_in_at is distinct from u.last_sign_in_at
   );

revoke select on table public.profiles from public, anon, authenticated;
grant select (id, full_name, email, phone, profession, created_at, role, account_type)
  on table public.profiles to authenticated;

create or replace function public.admin_get_profile_auth_status(p_user_ids uuid[])
returns table (
  user_id uuid,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only authenticated administrators can read profile auth status'
      using errcode = '42501';
  end if;

  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;

  return query
    select p.id, p.email_confirmed_at, p.last_sign_in_at
      from public.profiles p
     where p.id = any(p_user_ids);
end;
$$;

revoke all on function public.admin_get_profile_auth_status(uuid[]) from public, anon;
grant execute on function public.admin_get_profile_auth_status(uuid[]) to authenticated;
revoke all on function public.sync_profile_auth_status_from_auth() from public, anon, authenticated;

commit;