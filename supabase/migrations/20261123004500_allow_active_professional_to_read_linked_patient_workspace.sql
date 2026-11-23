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
      select 1
      from public.profiles pr
      where pr.id = p_user_id
        and pr.account_type = 'professional'
    )
    and (
      exists (
        select 1
        from public.professional_connection_requests r
        where r.patient_id = p_patient_id
          and r.professional_id = p_user_id
          and r.status in ('accepted', 'active')
      )
      or exists (
        select 1
        from public.patient_care_team ct
        where ct.patient_id = p_patient_id
          and ct.professional_id = p_user_id
          and ct.status = 'active'
      )
    );
$function$;

revoke all on function private.is_active_patient_professional(uuid, uuid) from public;
grant execute on function private.is_active_patient_professional(uuid, uuid) to authenticated;

create or replace function private.can_access_patient_workspace(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private'
set row_security = off
as $function$
  select p_patient_id is not null
    and auth.uid() is not null
    and (
      private.is_patient_workspace_owner(p_patient_id, auth.uid())
      or private.is_active_patient_account(p_patient_id, auth.uid())
      or private.is_active_patient_professional(p_patient_id, auth.uid())
    );
$function$;

drop policy if exists patient_workspace_select_gate on public.patients;
create policy patient_workspace_select_gate
on public.patients
for select
to authenticated
using (
  private.is_patient_workspace_owner(id, auth.uid())
  or private.is_active_patient_account(id, auth.uid())
  or private.is_active_patient_professional(id, auth.uid())
);

drop policy if exists patients_select_owner_or_linked_patient on public.patients;
create policy patients_select_owner_or_linked_patient
on public.patients
for select
to authenticated
using (
  private.is_patient_workspace_owner(id, auth.uid())
  or private.is_active_patient_account(id, auth.uid())
  or private.is_active_patient_professional(id, auth.uid())
);