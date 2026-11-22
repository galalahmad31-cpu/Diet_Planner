-- Invitation redemption must resolve to a professional account, never another patient account.
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

  select pa.patient_id into v_patient_id
  from public.patient_accounts pa
  where pa.user_id = v_uid and pa.status = 'active'
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
    and exists (
      select 1 from public.profiles pr
      where pr.id = p.user_id and pr.account_type = 'professional'
    )
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
      end_reason = null,
      updated_at = now()
  where public.professional_connection_requests.status in ('declined', 'cancelled', 'ended')
  returning id into v_request_id;

  if v_request_id is null then
    raise exception 'connection_request_already_open_or_processed' using errcode = '23505';
  end if;

  update public.patient_invitations
  set accepted_at = now()
  where token = p_token and accepted_at is null and revoked_at is null;

  if not found then
    raise exception 'invitation_already_used' using errcode = '22023';
  end if;

  return v_request_id;
end;
$function$;

revoke all on function public.redeem_patient_professional_invitation(uuid) from public, anon;
grant execute on function public.redeem_patient_professional_invitation(uuid) to authenticated;
