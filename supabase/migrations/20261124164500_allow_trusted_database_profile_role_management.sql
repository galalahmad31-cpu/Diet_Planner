create table if not exists private.profile_access_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  changed_by uuid,
  db_session_user name not null,
  old_role text,
  new_role text,
  old_account_type text,
  new_account_type text,
  changed_at timestamptz not null default now()
);

create index if not exists profile_access_audit_profile_changed_at_idx
  on private.profile_access_audit (profile_id, changed_at desc);

revoke all on table private.profile_access_audit from public, anon, authenticated;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  trusted_database_session boolean :=
    session_user in ('postgres', 'supabase_admin');
  authenticated_admin boolean :=
    auth.uid() is not null and public.is_admin();
begin
  if new.role is distinct from old.role
     and not trusted_database_session
     and not authenticated_admin then
    raise exception 'Changing profile role is not allowed';
  end if;

  if new.account_type is distinct from old.account_type
     and not trusted_database_session
     and not authenticated_admin
     and not (
       old.account_type = 'pending'
       and new.account_type in ('professional', 'patient')
       and current_setting('app.account_type_selection', true) = 'on'
       and auth.uid() = old.id
     ) then
    raise exception 'Changing account type is not allowed';
  end if;

  if new.role is distinct from old.role
     or new.account_type is distinct from old.account_type then
    insert into private.profile_access_audit (
      profile_id,
      changed_by,
      db_session_user,
      old_role,
      new_role,
      old_account_type,
      new_account_type
    ) values (
      old.id,
      auth.uid(),
      session_user,
      old.role,
      new.role,
      old.account_type,
      new.account_type
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_profile_role() from public, anon, authenticated;
