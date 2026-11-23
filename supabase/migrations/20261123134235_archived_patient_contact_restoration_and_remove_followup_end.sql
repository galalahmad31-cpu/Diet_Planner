-- Remove the obsolete follow-up termination RPC and add an explicit archived-file contact restoration request.
drop function if exists public.end_professional_connection(uuid);

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
  if not exists (select 1 from public.profiles where id = v_uid and account_type = 'patient') then
    raise exception 'patient_account_required' using errcode = '42501';
  end if;

  select p.user_id, p.archived_at into v_professional_id, v_archived_at
  from public.patients p
  join public.patient_accounts pa on pa.patient_id = p.id and pa.user_id = v_uid and pa.status = 'active'
  where p.id = p_patient_id
  for update of p;

  if not found or v_professional_id is null then
    raise exception 'patient_file_not_linked_to_account' using errcode = '42501';
  end if;
  if v_archived_at is null then raise exception 'patient_file_not_archived' using errcode = '55000'; end if;
  if v_professional_id = v_uid then raise exception 'invalid_professional_contact' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = v_professional_id and account_type = 'professional') then
    raise exception 'professional_account_unavailable' using errcode = '55000';
  end if;

  insert into public.professional_connection_requests
    (patient_id, professional_id, requested_by, message, status, decided_at, updated_at)
  values
    (p_patient_id, v_professional_id, v_uid, 'طلب استعادة التواصل مع الملف المؤرشف', 'pending', null, now())
  on conflict (patient_id, professional_id) do update
    set requested_by = excluded.requested_by,
        message = excluded.message,
        status = 'pending',
        decided_at = null,
        updated_at = now()
    where public.professional_connection_requests.status in ('declined', 'cancelled', 'ended')
  returning id into v_request_id;

  if v_request_id is not null then return v_request_id; end if;
  select r.id, r.status into v_request_id, v_status
  from public.professional_connection_requests r
  where r.patient_id = p_patient_id and r.professional_id = v_professional_id;

  if v_status = 'pending' then return v_request_id; end if;
  if v_status = 'accepted' then raise exception 'archived_contact_already_accepted' using errcode = '23505'; end if;
  raise exception 'archived_contact_request_unavailable' using errcode = '23505';
end;
$function$;

revoke all on function public.request_archived_patient_contact(uuid) from public, anon;
grant execute on function public.request_archived_patient_contact(uuid) to authenticated;

create or replace function public.list_professional_connection_requests()
returns table(request_id uuid, patient_id uuid, patient_user_id uuid, patient_name text, message text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' set row_security = off
as $function$
  select r.id, r.patient_id, pa.user_id, p.name::text, r.message, r.status, r.created_at
  from public.professional_connection_requests r
  join public.patients p on p.id = r.patient_id
  join public.patient_accounts pa on pa.patient_id = r.patient_id and pa.user_id = r.requested_by and pa.status = 'active'
  where r.professional_id = auth.uid()
    and (p.archived_at is null or (p.archived_at is not null and r.professional_id = p.user_id and r.status = 'pending'))
  order by r.created_at desc limit 200;
$function$;

create or replace function public.list_my_professional_connection_requests(p_patient_id uuid)
returns table(request_id uuid, professional_id uuid, professional_name text, professional_title text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' set row_security = off
as $function$
  select r.id, r.professional_id,
         coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.profession), ''), 'المختص'),
         coalesce(nullif(btrim(pr.profession), ''), 'مختص'),
         r.status, r.created_at
  from public.professional_connection_requests r
  join public.profiles pr on pr.id = r.professional_id
  where r.patient_id = p_patient_id and r.requested_by = auth.uid()
    and exists (select 1 from public.patient_accounts pa
                where pa.patient_id = r.patient_id and pa.user_id = auth.uid() and pa.status = 'active')
  order by r.created_at desc limit 100;
$function$;

create or replace function private.can_read_patient_conversation_message(p_patient_id uuid, p_sender_id uuid, p_recipient_id uuid)
returns boolean
language sql stable security definer set search_path = '' set row_security = 'off'
as $function$
  select auth.uid() in (p_sender_id, p_recipient_id)
    and exists (
      select 1
      from public.patients p
      join public.patient_accounts pa on pa.patient_id = p.id and pa.status = 'active'
      where p.id = p_patient_id
        and pa.user_id in (p_sender_id, p_recipient_id)
        and (
          (p.archived_at is null and (
            (p.user_id = p_sender_id and p.user_id <> pa.user_id)
            or (p.user_id = p_recipient_id)
            or (pa.user_id = p_sender_id and exists (
              select 1 from public.professional_connection_requests r
              where r.patient_id = p.id and r.requested_by = pa.user_id
                and r.professional_id = p_recipient_id and r.status = 'accepted'))
            or (pa.user_id = p_recipient_id and exists (
              select 1 from public.professional_connection_requests r
              where r.patient_id = p.id and r.requested_by = pa.user_id
                and r.professional_id = p_sender_id and r.status = 'accepted'))
          ))
          or (p.archived_at is not null and p.user_id in (p_sender_id, p_recipient_id)
            and exists (
              select 1 from public.professional_connection_requests r
              where r.patient_id = p.id and r.requested_by = pa.user_id
                and r.professional_id = p.user_id and r.status = 'accepted'))
        )
    );
$function$;

revoke all on function public.list_professional_connection_requests() from public, anon;
grant execute on function public.list_professional_connection_requests() to authenticated;
revoke all on function public.list_my_professional_connection_requests(uuid) from public, anon;
grant execute on function public.list_my_professional_connection_requests(uuid) to authenticated;
