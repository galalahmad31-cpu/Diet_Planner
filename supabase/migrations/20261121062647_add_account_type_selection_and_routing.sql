alter table public.profiles
  add column if not exists account_type text not null default 'professional';

alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('professional', 'patient', 'pending'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare requested_type text;
begin
  requested_type := new.raw_user_meta_data ->> 'account_type';
  insert into public.profiles (id, email, full_name, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when requested_type in ('professional', 'patient') then requested_type else 'pending' end
  );
  return new;
end;
$function$;

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Changing profile role is not allowed';
  end if;
  if new.account_type is distinct from old.account_type
     and not public.is_admin()
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

create or replace function public.complete_account_type_selection(p_account_type text)
returns text language plpgsql security definer set search_path = ''
as $function$
declare
  current_type text;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_account_type not in ('professional', 'patient') then raise exception 'Invalid account type'; end if;

  select account_type into current_type
  from public.profiles where id = current_user_id for update;

  if not found then raise exception 'Profile not found'; end if;
  if current_type = p_account_type then return current_type; end if;
  if current_type <> 'pending' then raise exception 'Account type has already been selected'; end if;

  perform set_config('app.account_type_selection', 'on', true);
  update public.profiles set account_type = p_account_type where id = current_user_id;
  return p_account_type;
end;
$function$;

revoke all on function public.complete_account_type_selection(text) from public;
grant execute on function public.complete_account_type_selection(text) to authenticated;