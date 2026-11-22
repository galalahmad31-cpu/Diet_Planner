create or replace function public.ensure_patient_self_record()
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_name text;
  v_phone text;
  v_patient_id uuid;
  v_existing_count integer;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('patient-self-record:' || v_uid::text, 0));

  select p.account_type,
         coalesce(nullif(btrim(p.full_name), ''), 'مريض'),
         nullif(btrim(p.phone), '')
    into v_account_type, v_name, v_phone
  from public.profiles p
  where p.id = v_uid;

  if v_account_type is distinct from 'patient' then
    raise exception 'patient_account_required' using errcode = '42501';
  end if;

  select pa.patient_id
    into v_patient_id
  from public.patient_accounts pa
  where pa.user_id = v_uid
    and pa.status = 'active';

  if v_patient_id is not null then
    return v_patient_id;
  end if;

  if exists (
    select 1 from public.patient_accounts pa
    where pa.user_id = v_uid and pa.status = 'revoked'
  ) then
    raise exception 'patient_account_revoked' using errcode = '42501';
  end if;

  select count(*), min(p.id)
    into v_existing_count, v_patient_id
  from public.patients p
  where p.user_id = v_uid;

  if v_existing_count > 1 then
    raise exception 'patient_self_record_ambiguous' using errcode = '23505';
  end if;

  if v_patient_id is null then
    insert into public.patients(user_id, name, phone)
    values (v_uid, v_name, v_phone)
    returning id into v_patient_id;
  end if;

  insert into public.patient_accounts(patient_id, user_id, status)
  values (v_patient_id, v_uid, 'active');

  return v_patient_id;
end;
$function$;

revoke all on function public.ensure_patient_self_record() from public, anon;
grant execute on function public.ensure_patient_self_record() to authenticated;
