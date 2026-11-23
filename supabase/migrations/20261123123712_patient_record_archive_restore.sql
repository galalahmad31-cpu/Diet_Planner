-- Patient archive: reversible soft-archive, never cascade-delete clinical data.
alter table public.patients
  add column if not exists archived_at timestamptz;

create index if not exists patients_owner_archive_idx
  on public.patients (user_id, archived_at, name, id);

create or replace function private.is_patient_workspace_owner(
  p_patient_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog', 'public'
set row_security = 'off'
as $function$
  select p_patient_id is not null
    and p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles pr
      join public.patients p on p.user_id = pr.id
      where p.id = p_patient_id
        and p.archived_at is null
        and pr.id = p_user_id
        and pr.account_type = 'professional'
    );
$function$;

create or replace function public.can_add_patient(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_user_id is null or p_user_id is distinct from auth.uid() then false
    when not exists (
      select 1 from public.profiles pr
      where pr.id = p_user_id and pr.account_type = 'professional'
    ) then false
    when exists (
      select 1 from public.profiles pr
      where pr.id = p_user_id and pr.role = 'admin'
    ) then true
    else coalesce((
      select s.max_patients_snapshot is null or
        (select count(*) from public.patients pt
         where pt.user_id = p_user_id and pt.archived_at is null) < s.max_patients_snapshot
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.status = 'paid'
        and s.start_date <= current_date
        and s.expiry_date >= current_date
      order by s.start_date desc, s.id desc
      limit 1
    ), false)
  end;
$function$;

drop function if exists public.list_my_professional_patients(integer, integer);

create function public.list_my_professional_patients(
  p_limit integer default 50,
  p_offset integer default 0,
  p_include_archived boolean default false
)
returns table(
  id uuid,
  user_id uuid,
  name text,
  diagnosis text,
  is_linked boolean,
  is_archived boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles profile_row
    where profile_row.id = v_uid
      and profile_row.account_type = 'professional'
  ) then
    raise exception 'professional_account_required' using errcode = '42501';
  end if;

  return query
  select
    patient_row.id,
    patient_row.user_id,
    patient_row.name,
    patient_row.diagnosis,
    exists (
      select 1 from public.patient_accounts account_row
      where account_row.patient_id = patient_row.id
        and account_row.status = 'active'
    ),
    patient_row.archived_at is not null,
    count(*) over ()
  from public.patients patient_row
  where patient_row.user_id = v_uid
    and ((p_include_archived is true and patient_row.archived_at is not null)
      or (coalesce(p_include_archived, false) is false and patient_row.archived_at is null))
  order by patient_row.name asc nulls last, patient_row.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.list_my_professional_patients(integer, integer, boolean) from public, anon;
grant execute on function public.list_my_professional_patients(integer, integer, boolean) to authenticated;

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

  return v_archived_at;
end;
$function$;

revoke all on function public.set_patient_archive_status(uuid, boolean) from public, anon;
grant execute on function public.set_patient_archive_status(uuid, boolean) to authenticated;

drop policy if exists patients_delete_professional_owner on public.patients;
