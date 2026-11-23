-- Keep archived records out of active professional invitations and conversations.
create or replace function public.set_patient_archive_status(
  p_patient_id uuid,
  p_archived boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
set row_security = 'off'
as $function$
declare
  v_uid uuid := auth.uid();
  v_archived_at timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_patient_id is null or p_archived is null then
    raise exception 'patient_id_and_archive_status_required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles pr
    where pr.id = v_uid and pr.account_type = 'professional'
  ) then
    raise exception 'professional_account_required' using errcode = '42501';
  end if;

  perform 1
  from public.patients p
  where p.id = p_patient_id and p.user_id = v_uid
  for update;
  if not found then
    raise exception 'patient_record_not_owned_or_not_found' using errcode = '42501';
  end if;

  update public.patients
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = p_patient_id and user_id = v_uid
  returning archived_at into v_archived_at;

  if p_archived then
    update public.patient_invitations
    set revoked_at = now()
    where patient_id = p_patient_id
      and accepted_at is null
      and revoked_at is null;
  end if;

  return v_archived_at;
end;
$function$;

create or replace function public.accept_patient_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = 'off'
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
  v_owner_id uuid;
  v_type text;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select account_type into v_type
  from public.profiles
  where id = v_uid;

  if v_type is distinct from 'patient' then
    raise exception 'patient_account_required' using errcode = '42501';
  end if;

  select i.patient_id, p.user_id
    into v_patient_id, v_owner_id
  from public.patient_invitations i
  join public.patients p on p.id = i.patient_id
  where i.token = p_token
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and p.archived_at is null
    and p.user_id is not null
    and p.user_id <> v_uid
    and exists (
      select 1 from public.profiles pr
      where pr.id = p.user_id and pr.account_type = 'professional'
    )
  for update of i;

  if v_patient_id is null or v_owner_id is null then
    raise exception 'invitation_invalid_expired_or_used' using errcode = '22023';
  end if;

  insert into public.patient_accounts(patient_id, user_id, status, linked_at)
  values (v_patient_id, v_uid, 'active', now())
  on conflict (patient_id) do update
    set user_id = excluded.user_id,
        status = 'active',
        linked_at = now()
  where public.patient_accounts.status = 'revoked';

  if not found then
    if exists (
      select 1 from public.patient_accounts
      where patient_id = v_patient_id
        and user_id = v_uid
        and status = 'active'
    ) then
      update public.patient_invitations
      set accepted_at = now()
      where token = p_token;
      return v_patient_id;
    end if;
    raise exception 'patient_record_already_linked' using errcode = '23505';
  end if;

  update public.patient_invitations
  set accepted_at = now()
  where token = p_token;

  return v_patient_id;
end;
$function$;

create or replace function public.list_professional_connection_requests()
returns table(
  request_id uuid,
  patient_id uuid,
  patient_user_id uuid,
  patient_name text,
  message text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select r.id, r.patient_id, pa.user_id, p.name::text, r.message, r.status, r.created_at
  from public.professional_connection_requests r
  join public.patients p on p.id = r.patient_id and p.archived_at is null
  join public.patient_accounts pa on pa.patient_id = r.patient_id
    and pa.user_id = r.requested_by and pa.status = 'active'
  where r.professional_id = auth.uid()
  order by r.created_at desc
  limit 200;
$function$;

create or replace function private.can_read_patient_conversation_message(
  p_patient_id uuid,
  p_sender_id uuid,
  p_recipient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select auth.uid() in (p_sender_id, p_recipient_id)
    and exists (
      select 1
      from public.patients p
      join public.patient_accounts pa
        on pa.patient_id = p.id
       and pa.status = 'active'
      where p.id = p_patient_id
        and p.archived_at is null
        and pa.user_id in (p_sender_id, p_recipient_id)
        and (
          (p.user_id = p_sender_id and p.user_id <> pa.user_id and p_sender_id = p.user_id)
          or
          (p.user_id = p_recipient_id and p_recipient_id = p.user_id)
          or
          (pa.user_id = p_sender_id and exists (
            select 1 from public.professional_connection_requests r
            where r.patient_id = p.id
              and r.requested_by = pa.user_id
              and r.professional_id = p_recipient_id
              and r.status = 'accepted'
          ))
          or
          (pa.user_id = p_recipient_id and exists (
            select 1 from public.professional_connection_requests r
            where r.patient_id = p.id
              and r.requested_by = pa.user_id
              and r.professional_id = p_sender_id
              and r.status = 'accepted'
          ))
        )
    );
$function$;
