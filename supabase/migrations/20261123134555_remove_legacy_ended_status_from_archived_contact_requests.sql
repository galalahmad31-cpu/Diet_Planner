-- Remove the legacy ended status from archived contact restoration requests.
create or replace function public.request_archived_patient_contact(p_patient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_professional_id uuid;
  v_archived_at timestamptz;
  v_request_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_patient_id is null then raise exception 'patient_id_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id=v_uid and account_type='patient') then
    raise exception 'patient_account_required' using errcode='42501';
  end if;
  select p.user_id,p.archived_at into v_professional_id,v_archived_at
  from public.patients p
  join public.patient_accounts pa on pa.patient_id=p.id and pa.user_id=v_uid and pa.status='active'
  where p.id=p_patient_id for update of p;
  if not found or v_professional_id is null then
    raise exception 'patient_file_not_linked_to_account' using errcode='42501';
  end if;
  if v_archived_at is null then raise exception 'patient_file_not_archived' using errcode='55000'; end if;
  if v_professional_id=v_uid then raise exception 'invalid_professional_contact' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where id=v_professional_id and account_type='professional') then
    raise exception 'professional_account_unavailable' using errcode='55000';
  end if;
  insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message,status,decided_at,updated_at)
  values(p_patient_id,v_professional_id,v_uid,'طلب استعادة التواصل مع الملف المؤرشف','pending',null,now())
  on conflict(patient_id,professional_id) do update
    set requested_by=excluded.requested_by,message=excluded.message,status='pending',decided_at=null,updated_at=now()
    where public.professional_connection_requests.status in ('declined','cancelled')
  returning id into v_request_id;
  if v_request_id is not null then return v_request_id; end if;
  select r.id,r.status into v_request_id,v_status
  from public.professional_connection_requests r
  where r.patient_id=p_patient_id and r.professional_id=v_professional_id;
  if v_status='pending' then return v_request_id; end if;
  if v_status='accepted' then raise exception 'archived_contact_already_accepted' using errcode='23505'; end if;
  raise exception 'archived_contact_request_unavailable' using errcode='23505';
end;
$function$;
revoke all on function public.request_archived_patient_contact(uuid) from public,anon;
grant execute on function public.request_archived_patient_contact(uuid) to authenticated;
