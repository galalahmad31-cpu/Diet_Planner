alter table public.professional_connection_requests
  drop constraint if exists professional_connection_requests_status_check;
alter table public.professional_connection_requests
  add constraint professional_connection_requests_status_check
  check (status = any (array['pending','accepted','declined','cancelled','ended']::text[]));

create or replace function public.end_professional_connection(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_professional_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'invalid_request_id' using errcode='22023'; end if;
  select r.professional_id,r.status into v_professional_id,v_status
  from public.professional_connection_requests r where r.id=p_request_id for update;
  if not found then raise exception 'connection_not_found' using errcode='P0002'; end if;
  if v_professional_id<>v_uid then raise exception 'not_connection_professional' using errcode='42501'; end if;
  if v_status<>'accepted' then raise exception 'connection_not_active' using errcode='55000'; end if;
  update public.professional_connection_requests
  set status='ended',decided_at=now(),updated_at=now()
  where id=p_request_id and professional_id=v_uid and status='accepted';
end;
$function$;
revoke all on function public.end_professional_connection(uuid) from public,anon;
grant execute on function public.end_professional_connection(uuid) to authenticated;

create or replace function public.request_professional_connection(p_professional_id uuid,p_patient_id uuid,p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_request_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_professional_id is null or p_patient_id is null or p_professional_id=v_uid then raise exception 'invalid_connection_request' using errcode='22023'; end if;
  if p_message is not null and char_length(btrim(p_message))>1000 then raise exception 'message_too_long' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and account_type='patient') then raise exception 'patient_account_required' using errcode='42501'; end if;
  if not exists(select 1 from public.patient_accounts where patient_id=p_patient_id and user_id=v_uid and status='active') then raise exception 'patient_file_not_linked_to_account' using errcode='42501'; end if;
  if not exists(select 1 from public.professional_directory_profiles where user_id=p_professional_id and listing_status='published' and is_verified=true) then raise exception 'professional_not_available' using errcode='22023'; end if;
  if exists(select 1 from public.patients where id=p_patient_id and user_id=p_professional_id) then raise exception 'already_primary_professional' using errcode='23505'; end if;
  insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message)
  values(p_patient_id,p_professional_id,v_uid,nullif(btrim(p_message),''))
  on conflict(patient_id,professional_id) do update
    set requested_by=excluded.requested_by,message=excluded.message,status='pending',decided_at=null,updated_at=now()
    where public.professional_connection_requests.status in ('declined','cancelled','ended')
  returning id into v_request_id;
  if v_request_id is not null then return v_request_id; end if;
  select id,status into v_request_id,v_status from public.professional_connection_requests
  where patient_id=p_patient_id and professional_id=p_professional_id;
  if v_status='pending' then return v_request_id;
  elsif v_status='accepted' then raise exception 'conversation_already_accepted' using errcode='23505'; end if;
  raise exception 'connection_request_not_available' using errcode='23505';
end;
$function$;
