create or replace function private.delete_my_professional_directory_profile()
returns void language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := auth.uid();
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 delete from public.professional_directory_profiles p
 where p.user_id=v_uid and p.listing_status in ('draft','rejected')
 and not exists(select 1 from public.professional_connection_requests r where r.professional_id=v_uid)
 and not exists(select 1 from public.patient_care_team c where c.professional_id=v_uid);
 if not found then
  if exists(select 1 from public.professional_directory_profiles p where p.user_id=v_uid and p.listing_status not in ('draft','rejected')) then raise exception 'profile_must_be_withdrawn_before_delete';
  elsif exists(select 1 from public.professional_connection_requests r where r.professional_id=v_uid) then raise exception 'profile_has_connection_history';
  elsif exists(select 1 from public.patient_care_team c where c.professional_id=v_uid) then raise exception 'profile_has_patient_relationships';
  else raise exception 'profile_not_found'; end if;
 end if;
end;
$function$;
revoke all on function private.delete_my_professional_directory_profile() from public,anon,authenticated;
grant execute on function private.delete_my_professional_directory_profile() to authenticated;
create or replace function public.delete_my_professional_directory_profile()
returns void language sql security invoker set search_path = '' as $function$
 select private.delete_my_professional_directory_profile();
$function$;
revoke all on function public.delete_my_professional_directory_profile() from public,anon,authenticated;
grant execute on function public.delete_my_professional_directory_profile() to authenticated;
