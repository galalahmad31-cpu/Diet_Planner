drop trigger if exists protect_profile_role_trigger on public.profiles;
create trigger protect_profile_role_trigger
before update of role, account_type
on public.profiles
for each row
execute function public.protect_profile_role();