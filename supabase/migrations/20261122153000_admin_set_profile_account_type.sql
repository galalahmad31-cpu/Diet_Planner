create or replace function public.admin_set_profile_account_type(target_user_id uuid, new_account_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only authenticated administrators can change account types';
  end if;

  if target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if new_account_type is null or new_account_type not in ('professional', 'patient', 'pending') then
    raise exception 'Invalid account type';
  end if;

  update public.profiles
  set account_type = new_account_type
  where id = target_user_id;

  if not found then
    raise exception 'User profile not found';
  end if;
end;
$function$;

revoke all on function public.admin_set_profile_account_type(uuid, text) from public;
grant execute on function public.admin_set_profile_account_type(uuid, text) to authenticated;
