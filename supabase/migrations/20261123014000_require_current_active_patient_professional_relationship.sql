create or replace function private.is_active_patient_professional(
  p_patient_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select p_patient_id is not null
    and p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1 from public.profiles pr
      where pr.id = p_user_id and pr.account_type = 'professional'
    )
    and (
      exists (
        select 1 from public.professional_connection_requests r
        where r.patient_id = p_patient_id
          and r.professional_id = p_user_id
          and r.status = 'active'
          and (r.agreement_end_date is null or r.agreement_end_date >= current_date)
      )
      or exists (
        select 1 from public.patient_care_team ct
        where ct.patient_id = p_patient_id
          and ct.professional_id = p_user_id
          and ct.status = 'active'
      )
    );
$function$;

revoke all on function private.is_active_patient_professional(uuid, uuid) from public;
grant execute on function private.is_active_patient_professional(uuid, uuid) to authenticated;