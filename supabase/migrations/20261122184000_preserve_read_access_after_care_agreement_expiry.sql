create or replace function private.is_active_patient_care_team_member(p_patient_id uuid,p_professional_id uuid)
returns boolean language sql stable security definer
set search_path='pg_catalog','public' set row_security='off'
as $function$
 select exists(select 1 from public.patient_care_team pct where pct.patient_id=p_patient_id and pct.professional_id=p_professional_id and pct.status='active');
$function$;

create or replace function private.can_access_patient_workspace(p_patient_id uuid)
returns boolean language sql stable security definer
set search_path='pg_catalog','public' set row_security='off'
as $function$
 select p_patient_id is not null and auth.uid() is not null and (
   public.is_admin()
   or exists(select 1 from public.patient_accounts pa where pa.patient_id=p_patient_id and pa.user_id=auth.uid() and pa.status='active')
   or private.is_active_patient_care_team_member(p_patient_id,auth.uid())
   or exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=auth.uid()
     and not exists(select 1 from public.professional_connection_requests r where r.patient_id=p.id and r.professional_id=auth.uid() and r.status in ('accepted','active')))
 );
$function$;

grant execute on function private.is_expired_care_professional(uuid) to authenticated;
revoke all on function private.is_expired_care_professional(uuid) from anon;