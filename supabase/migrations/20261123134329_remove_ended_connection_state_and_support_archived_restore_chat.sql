-- Keep accepted restoration conversations visible to the professional while the file remains archived.
create or replace function public.list_professional_connection_requests()
returns table(request_id uuid, patient_id uuid, patient_user_id uuid, patient_name text, message text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' set row_security = off
as $function$
  select r.id, r.patient_id, pa.user_id, p.name::text, r.message, r.status, r.created_at
  from public.professional_connection_requests r
  join public.patients p on p.id = r.patient_id
  join public.patient_accounts pa on pa.patient_id = r.patient_id and pa.user_id = r.requested_by and pa.status = 'active'
  where r.professional_id = auth.uid()
    and (p.archived_at is null or (p.archived_at is not null and r.professional_id = p.user_id and r.status in ('pending','accepted')))
  order by r.created_at desc limit 200;
$function$;

alter table public.professional_connection_requests
  drop constraint if exists professional_connection_requests_status_check;
alter table public.professional_connection_requests
  add constraint professional_connection_requests_status_check
  check (status = any (array['pending','accepted','declined','cancelled']::text[]));

create or replace function public.request_professional_connection(p_professional_id uuid, p_patient_id uuid, p_message text default null)
returns uuid
language plpgsql security definer set search_path = '' set row_security = off
as $function$
declare v_uid uuid := auth.uid(); v_request_id uuid; v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_professional_id is null or p_patient_id is null or p_professional_id = v_uid then
    raise exception 'invalid_connection_request' using errcode='22023';
  end if;
  if p_message is not null and char_length(btrim(p_message)) > 1000 then
    raise exception 'message_too_long' using errcode='22023';
  end if;
  if not exists (select 1 from public.profiles where id=v_uid and account_type='patient') then
    raise exception 'patient_account_required' using errcode='42501';
  end if;
  if not exists (select 1 from public.patient_accounts where patient_id=p_patient_id and user_id=v_uid and status='active') then
    raise exception 'patient_file_not_linked_to_account' using errcode='42501';
  end if;
  if not exists (select 1 from public.professional_directory_profiles where user_id=p_professional_id and listing_status='published' and is_verified=true) then
    raise exception 'professional_not_available' using errcode='22023';
  end if;
  if exists (select 1 from public.patients where id=p_patient_id and (user_id=p_professional_id or archived_at is not null)) then
    raise exception 'already_primary_professional_or_archived_file' using errcode='23505';
  end if;
  insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message)
  values (p_patient_id,p_professional_id,v_uid,nullif(btrim(p_message),''))
  on conflict (patient_id,professional_id) do update
    set requested_by=excluded.requested_by, message=excluded.message, status='pending', decided_at=null, updated_at=now()
    where public.professional_connection_requests.status in ('declined','cancelled')
  returning id into v_request_id;
  if v_request_id is not null then return v_request_id; end if;
  select id,status into v_request_id,v_status from public.professional_connection_requests
  where patient_id=p_patient_id and professional_id=p_professional_id;
  if v_status='pending' then return v_request_id;
  elsif v_status='accepted' then raise exception 'conversation_already_accepted' using errcode='23505';
  end if;
  raise exception 'connection_request_not_available' using errcode='23505';
end;
$function$;
revoke all on function public.request_professional_connection(uuid,uuid,text) from public, anon;
grant execute on function public.request_professional_connection(uuid,uuid,text) to authenticated;
revoke all on function public.list_professional_connection_requests() from public, anon;
grant execute on function public.list_professional_connection_requests() to authenticated;
