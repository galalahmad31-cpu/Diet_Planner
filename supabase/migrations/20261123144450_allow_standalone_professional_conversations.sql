-- Allow directory conversations without creating or linking a health record.
-- Existing file-linked conversations keep their patient_id and authorization path.
alter table public.professional_connection_requests alter column patient_id drop not null;
create unique index if not exists professional_connection_requests_standalone_pair_key
  on public.professional_connection_requests(requested_by, professional_id)
  where patient_id is null;

alter table public.patient_messages alter column patient_id drop not null;

create or replace function private.can_read_patient_conversation_message(
  p_patient_id uuid, p_sender_id uuid, p_recipient_id uuid
)
returns boolean
language sql stable security definer
set search_path = '' set row_security = 'off'
as $$
  select auth.uid() in (p_sender_id,p_recipient_id)
    and case
      when p_patient_id is null then exists (
        select 1 from public.professional_connection_requests r
        where r.patient_id is null
          and r.requested_by in (p_sender_id,p_recipient_id)
          and r.professional_id in (p_sender_id,p_recipient_id)
          and r.requested_by <> r.professional_id
          and r.status='accepted'
      )
      else exists (
        select 1 from public.patients p
        join public.patient_accounts pa on pa.patient_id=p.id and pa.status='active'
        where p.id=p_patient_id
          and pa.user_id in (p_sender_id,p_recipient_id)
          and (
            (p.archived_at is null and (
              (p.user_id=p_sender_id and p.user_id<>pa.user_id)
              or p.user_id=p_recipient_id
              or (pa.user_id=p_sender_id and exists (
                select 1 from public.professional_connection_requests r
                where r.patient_id=p.id and r.requested_by=pa.user_id
                  and r.professional_id=p_recipient_id and r.status='accepted'
              ))
              or (pa.user_id=p_recipient_id and exists (
                select 1 from public.professional_connection_requests r
                where r.patient_id=p.id and r.requested_by=pa.user_id
                  and r.professional_id=p_sender_id and r.status='accepted'
              ))
            ))
            or (p.archived_at is not null and p.user_id in (p_sender_id,p_recipient_id)
              and exists (
                select 1 from public.professional_connection_requests r
                where r.patient_id=p.id and r.requested_by=pa.user_id
                  and r.professional_id=p.user_id and r.status='accepted'
              ))
          )
      )
    end;
$$;

create or replace function public.request_professional_connection(
  p_professional_id uuid, p_patient_id uuid default null, p_message text default null
)
returns uuid
language plpgsql security definer
set search_path = '' set row_security = 'off'
as $$
declare v_uid uuid:=auth.uid(); v_request_id uuid; v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_professional_id is null or p_professional_id=v_uid then
    raise exception 'invalid_connection_request' using errcode='22023';
  end if;
  if p_message is not null and char_length(btrim(p_message))>1000 then
    raise exception 'message_too_long' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles where id=v_uid and account_type='patient') then
    raise exception 'patient_account_required' using errcode='42501';
  end if;
  if not exists(select 1 from public.professional_directory_profiles
    where user_id=p_professional_id and listing_status='published' and is_verified=true) then
    raise exception 'professional_not_available' using errcode='22023';
  end if;

  if p_patient_id is not null then
    if not exists(select 1 from public.patient_accounts
      where patient_id=p_patient_id and user_id=v_uid and status='active') then
      raise exception 'patient_file_not_linked_to_account' using errcode='42501';
    end if;
    if exists(select 1 from public.patients
      where id=p_patient_id and (user_id=p_professional_id or archived_at is not null)) then
      raise exception 'already_primary_professional_or_archived_file' using errcode='23505';
    end if;
    insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message)
    values(p_patient_id,p_professional_id,v_uid,nullif(btrim(p_message),''))
    on conflict(patient_id,professional_id) do update
      set requested_by=excluded.requested_by,message=excluded.message,status='pending',
          decided_at=null,updated_at=now()
      where public.professional_connection_requests.status in ('declined','cancelled')
    returning id into v_request_id;
    if v_request_id is null then
      select id,status into v_request_id,v_status from public.professional_connection_requests
      where patient_id=p_patient_id and professional_id=p_professional_id;
    end if;
  else
    insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message)
    values(null,p_professional_id,v_uid,nullif(btrim(p_message),''))
    on conflict(requested_by,professional_id) where patient_id is null do update
      set message=excluded.message,status='pending',decided_at=null,updated_at=now()
      where public.professional_connection_requests.status in ('declined','cancelled')
    returning id into v_request_id;
    if v_request_id is null then
      select id,status into v_request_id,v_status from public.professional_connection_requests
      where patient_id is null and requested_by=v_uid and professional_id=p_professional_id;
    end if;
  end if;

  if v_request_id is not null and (v_status is null or v_status='pending') then return v_request_id; end if;
  if v_status='accepted' then raise exception 'conversation_already_accepted' using errcode='23505'; end if;
  raise exception 'connection_request_not_available' using errcode='23505';
end;
$$;

create or replace function public.respond_professional_connection_request(p_request_id uuid,p_decision text)
returns void language plpgsql security definer
set search_path = '' set row_security = 'off'
as $$
declare v_uid uuid:=auth.uid(); v_status text; v_patient_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'invalid_decision' using errcode='22023'; end if;
  select status,patient_id into v_status,v_patient_id
  from public.professional_connection_requests
  where id=p_request_id and professional_id=v_uid for update;
  if not found then raise exception 'request_not_found' using errcode='P0002'; end if;
  if v_status<>'pending' then raise exception 'request_not_pending' using errcode='55000'; end if;
  if p_decision='accepted' and not exists(select 1 from public.professional_directory_profiles
    where user_id=v_uid and listing_status='published' and is_verified=true) then
    raise exception 'professional_listing_not_active' using errcode='42501';
  end if;
  if p_decision='accepted' and v_patient_id is not null then
    insert into public.patient_care_team(patient_id,professional_id,relationship_role,status,started_at,ended_at)
    select v_patient_id,v_uid,
      case when exists(select 1 from public.patient_care_team
        where patient_id=v_patient_id and status='active' and relationship_role='primary')
        then 'collaborator' else 'primary' end,
      'active',now(),null
    on conflict(patient_id,professional_id) do update
      set relationship_role=excluded.relationship_role,status='active',started_at=now(),ended_at=null;
  end if;
  update public.professional_connection_requests
  set status=p_decision,decided_at=now(),updated_at=now()
  where id=p_request_id and professional_id=v_uid;
end;
$$;

create or replace function public.list_professional_connection_requests()
returns table(request_id uuid,patient_id uuid,patient_user_id uuid,patient_name text,message text,status text,created_at timestamptz)
language sql stable security definer
set search_path = '' set row_security = 'off'
as $$
  select r.id,r.patient_id,r.requested_by,
    coalesce(p.name::text,pr.full_name::text,'مريض'),r.message,r.status,r.created_at
  from public.professional_connection_requests r
  left join public.patients p on p.id=r.patient_id
  left join public.profiles pr on pr.id=r.requested_by
  where r.professional_id=auth.uid()
    and (r.patient_id is null or exists(select 1 from public.patient_accounts pa
      where pa.patient_id=r.patient_id and pa.user_id=r.requested_by and pa.status='active'))
  order by r.created_at desc limit 200;
$$;

create or replace function public.list_my_professional_connection_requests(p_patient_id uuid default null)
returns table(request_id uuid,professional_id uuid,professional_name text,professional_title text,status text,created_at timestamptz)
language sql stable security definer
set search_path = '' set row_security = 'off'
as $$
  select r.id,r.professional_id,d.display_name,d.professional_title,r.status,r.created_at
  from public.professional_connection_requests r
  join public.professional_directory_profiles d on d.user_id=r.professional_id
  where r.requested_by=auth.uid()
    and ((p_patient_id is null and r.patient_id is null)
      or (p_patient_id is not null and r.patient_id=p_patient_id
        and exists(select 1 from public.patient_accounts pa
          where pa.patient_id=r.patient_id and pa.user_id=auth.uid() and pa.status='active')))
  order by r.created_at desc limit 100;
$$;

create or replace function public.mark_patient_messages_read(p_patient_id uuid,p_other_user_id uuid)
returns integer language plpgsql security definer
set search_path = '' set row_security = 'off'
as $$
declare v_uid uuid:=auth.uid(); v_updated integer:=0;
begin
  if v_uid is null or p_other_user_id is null or p_other_user_id=v_uid then
    raise exception 'invalid_conversation_participants' using errcode='22023';
  end if;
  if not private.can_read_patient_conversation_message(p_patient_id,v_uid,p_other_user_id) then
    raise exception 'not_authorized_for_conversation' using errcode='42501';
  end if;
  update public.patient_messages set read_at=now()
  where patient_id is not distinct from p_patient_id
    and recipient_id=v_uid and sender_id=p_other_user_id and read_at is null;
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;

revoke all on function public.request_professional_connection(uuid,uuid,text) from public,anon;
revoke all on function public.respond_professional_connection_request(uuid,text) from public,anon;
revoke all on function public.list_professional_connection_requests() from public,anon;
revoke all on function public.list_my_professional_connection_requests(uuid) from public,anon;
revoke all on function public.mark_patient_messages_read(uuid,uuid) from public,anon;
grant execute on function public.request_professional_connection(uuid,uuid,text) to authenticated;
grant execute on function public.respond_professional_connection_request(uuid,text) to authenticated;
grant execute on function public.list_professional_connection_requests() to authenticated;
grant execute on function public.list_my_professional_connection_requests(uuid) to authenticated;
grant execute on function public.mark_patient_messages_read(uuid,uuid) to authenticated;
