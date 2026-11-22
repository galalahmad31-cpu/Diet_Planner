-- Gate public professional directory visibility and new connections by the same
-- subscription entitlement used by the application.
begin;

create or replace function private.professional_has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.account_type = 'professional'
      and (
        p.role = 'admin'
        or exists (
          select 1
          from public.subscriptions s
          where s.user_id = p_user_id
            and s.status = 'paid'
            and s.start_date <= current_date
            and s.expiry_date >= current_date
        )
      )
  );
$function$;

revoke all on function private.professional_has_active_subscription(uuid) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.professional_has_active_subscription(uuid) to anon, authenticated;

drop policy if exists professional_directory_public_read on public.professional_directory_profiles;
create policy professional_directory_public_read
on public.professional_directory_profiles
for select
to anon, authenticated
using (
  listing_status = 'published'
  and is_verified
  and private.professional_has_active_subscription(user_id)
);

drop policy if exists professional_directory_offers_public_read on public.professional_directory_offers;
create policy professional_directory_offers_public_read
on public.professional_directory_offers
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.professional_directory_profiles p
    where p.user_id = professional_directory_offers.professional_id
      and p.listing_status = 'published'
      and p.is_verified
      and private.professional_has_active_subscription(p.user_id)
  )
);

create or replace function public.request_professional_connection(
  p_professional_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_professional_id is null or p_professional_id = v_uid then raise exception 'invalid_professional'; end if;
  if p_message is not null and char_length(p_message) > 1000 then raise exception 'message_too_long'; end if;

  select p.account_type into v_account_type
  from public.profiles p
  where p.id = v_uid;

  if v_account_type is distinct from 'patient' then
    raise exception 'patient_account_required';
  end if;

  if not exists (
    select 1
    from public.professional_directory_profiles d
    join public.profiles p on p.id = d.user_id
    where d.user_id = p_professional_id
      and p.account_type = 'professional'
      and d.listing_status = 'published'
      and d.is_verified
      and private.professional_has_active_subscription(d.user_id)
  ) then
    raise exception 'professional_not_available';
  end if;

  if exists (
    select 1
    from public.patient_accounts pa
    join public.patient_care_team pct on pct.patient_id = pa.patient_id
    where pa.user_id = v_uid
      and pa.status = 'active'
      and pct.professional_id = p_professional_id
      and pct.status = 'active'
  ) then
    raise exception 'already_in_care_team';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_professional_id::text, 0)
  );

  select r.id into v_id
  from public.professional_connection_requests r
  where r.requested_by = v_uid
    and r.professional_id = p_professional_id
    and r.status in ('accepted','active')
  order by r.created_at desc
  limit 1
  for update;

  if v_id is not null then
    raise exception 'connection_already_open';
  end if;

  select r.id into v_id
  from public.professional_connection_requests r
  where r.requested_by = v_uid
    and r.professional_id = p_professional_id
    and r.status = 'pending'
  order by r.created_at desc
  limit 1
  for update;

  if v_id is not null then
    update public.professional_connection_requests
    set message = nullif(btrim(p_message), ''),
        updated_at = now()
    where id = v_id;
    return v_id;
  end if;

  select r.id into v_id
  from public.professional_connection_requests r
  where r.requested_by = v_uid
    and r.professional_id = p_professional_id
    and r.status in ('declined','cancelled')
  order by r.updated_at desc
  limit 1
  for update;

  if v_id is not null then
    update public.professional_connection_requests
    set message = nullif(btrim(p_message), ''),
        status = 'pending',
        patient_id = null,
        decided_at = null,
        patient_agreement_at = null,
        professional_agreement_at = null,
        payment_sent_at = null,
        payment_received_at = null,
        updated_at = now()
    where id = v_id;
    return v_id;
  end if;

  insert into public.professional_connection_requests(
    patient_id, professional_id, requested_by, message
  )
  values (
    null, p_professional_id, v_uid, nullif(btrim(p_message), '')
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.respond_professional_connection_request(
  p_request_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_patient uuid;
  v_requester uuid;
  v_status text;
  v_name text;
  v_phone text;
  v_subscription uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'invalid_decision'; end if;

  select patient_id, requested_by, status
    into v_patient, v_requester, v_status
  from public.professional_connection_requests
  where id = p_request_id
    and professional_id = v_uid
  for update;

  if v_requester is null then raise exception 'request_not_found'; end if;
  if v_status <> 'pending' then raise exception 'request_not_pending'; end if;

  if p_decision = 'accepted' then
    if not exists (
      select 1
      from public.professional_directory_profiles
      where user_id = v_uid
        and listing_status = 'published'
        and is_verified
    ) then
      raise exception 'professional_listing_not_active';
    end if;

    if not private.professional_has_active_subscription(v_uid) then
      raise exception 'active_subscription_required';
    end if;

    select pa.patient_id into v_patient
    from public.patient_accounts pa
    where pa.user_id = v_requester
      and pa.status = 'active';

    if v_patient is null then
      if exists (
        select 1
        from public.patient_accounts
        where user_id = v_requester
          and status = 'revoked'
      ) then
        raise exception 'patient_account_revoked';
      end if;

      select
        coalesce(nullif(btrim(full_name), ''), 'مريض جديد'),
        nullif(btrim(phone), '')
      into v_name, v_phone
      from public.profiles
      where id = v_requester
        and account_type = 'patient';

      if v_name is null then raise exception 'patient_account_not_found'; end if;

      select s.id into v_subscription
      from public.subscriptions s
      where s.user_id = v_uid
        and s.status = 'paid'
        and s.start_date <= current_date
        and s.expiry_date >= current_date
      order by s.start_date desc
      limit 1;

      if v_subscription is null and not public.is_admin() then
        raise exception 'active_subscription_required';
      end if;

      insert into public.patients(user_id, name, phone, subscription_id)
      values (v_uid, v_name, v_phone, v_subscription)
      returning id into v_patient;

      insert into public.patient_accounts(patient_id, user_id, status)
      values (v_patient, v_requester, 'active');
    end if;

    update public.professional_connection_requests
    set patient_id = v_patient,
        status = 'accepted',
        decided_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.professional_connection_requests
    set status = 'declined',
        decided_at = now(),
        updated_at = now()
    where id = p_request_id;
  end if;
end;
$function$;

commit;
