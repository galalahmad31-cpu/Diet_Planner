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

  return new;
end;
$function$;

drop table if exists private.profile_access_audit;
