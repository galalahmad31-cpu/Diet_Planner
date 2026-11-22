-- Redeem an existing professional invitation against the patient's self-owned portal record.
-- This preserves the patient's single patient_accounts identity and reuses the existing care-request workflow.

create or replace function public.redeem_patient_professional_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
  v_invited_patient_id uuid;
  v_professional_id uuid;
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select pa.patient_id
    into v_patient_id
  from public.patient_accounts pa
  where pa.user_id = v_uid
    and pa.status = 'active'
  for update;

  if v_patient_id is null then
    raise exception 'active_patient_account_required' using errcode = '42501';
  end if;

  select i.patient_id, p.user_id
    into v_invited_patient_id, v_professional_id
  from public.patient_invitations i
  join public.patients p on p.id = i.patient_id
  where i.token = p_token
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and p.user_id is not null
    and p.user_id <> v_uid
  for update of i;

  if v_invited_patient_id is null or v_professional_id is null then
    raise exception 'invitation_invalid_expired_or_used' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.patient_care_team pct
    where pct.patient_id = v_patient_id
      and pct.professional_id = v_professional_id
      and pct.status = 'active'
  ) then
    raise exception 'already_in_care_team' using errcode = '23505';
  end if;

  insert into public.professional_connection_requests (
    patient_id, professional_id, requested_by, message, status, decided_at, updated_at
  )
  values (v_patient_id, v_professional_id, v_uid, 'طلب متابعة عبر كود دعوة المختص', 'pending', null, now())
  on conflict (patient_id, professional_id) do update
  set requested_by = excluded.requested_by,
      message = excluded.message,
      status = 'pending',
      decided_at = null,
      agreement_service_title = null,
      agreement_service_description = null,
      agreement_amount = null,
      agreement_currency = 'EGP',
      agreement_duration_days = null,
      agreement_start_date = null,
      agreement_end_date = null,
      agreement_terms = null,
      agreement_version = 1,
      patient_agreement_at = null,
      professional_agreement_at = null,
      payment_sent_at = null,
      payment_received_at = null,
      ended_at = null,
      updated_at = now()
  where public.professional_connection_requests.status in ('declined', 'cancelled')
  returning id into v_request_id;

  if v_request_id is null then
    raise exception 'connection_request_already_open_or_processed' using errcode = '23505';
  end if;

  update public.patient_invitations
  set accepted_at = now()
  where token = p_token
    and accepted_at is null
    and revoked_at is null;

  if not found then
    raise exception 'invitation_already_used' using errcode = '22023';
  end if;

  return v_request_id;
end;
$function$;

revoke all on function public.redeem_patient_professional_invitation(uuid) from public, anon;
grant execute on function public.redeem_patient_professional_invitation(uuid) to authenticated;

-- Include invited professionals who have not published a directory profile.
create or replace function public.list_my_professional_connection_requests()
returns table(
  request_id uuid,
  professional_id uuid,
  professional_name text,
  professional_title text,
  status text,
  created_at timestamptz,
  agreement_service_title text,
  agreement_service_description text,
  agreement_amount numeric,
  agreement_currency text,
  agreement_duration_days integer,
  agreement_start_date date,
  agreement_end_date date,
  agreement_terms text,
  patient_agreement_at timestamptz,
  professional_agreement_at timestamptz,
  payment_sent_at timestamptz,
  payment_received_at timestamptz,
  ended_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select pa.patient_id into v_patient_id
  from public.patient_accounts pa
  where pa.user_id = v_uid and pa.status = 'active';

  if v_patient_id is null then
    raise exception 'patient_account_not_linked' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.professional_id,
         coalesce(nullif(btrim(d.display_name), ''), nullif(btrim(p.full_name), ''), 'المختص')::text,
         coalesce(nullif(btrim(d.professional_title), ''), 'مختص تغذية')::text,
         r.status,
         r.created_at,
         r.agreement_service_title,
         r.agreement_service_description,
         r.agreement_amount,
         r.agreement_currency,
         r.agreement_duration_days,
         r.agreement_start_date,
         r.agreement_end_date,
         r.agreement_terms,
         r.patient_agreement_at,
         r.professional_agreement_at,
         r.payment_sent_at,
         r.payment_received_at,
         r.ended_at
  from public.professional_connection_requests r
  left join public.professional_directory_profiles d on d.user_id = r.professional_id
  left join public.profiles p on p.id = r.professional_id
  where r.patient_id = v_patient_id
    and r.requested_by = v_uid
  order by r.created_at desc
  limit 100;
end;
$function$;

revoke all on function public.list_my_professional_connection_requests() from public, anon;
grant execute on function public.list_my_professional_connection_requests() to authenticated;
