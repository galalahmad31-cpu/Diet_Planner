drop function if exists public.list_my_professional_patients(integer, integer);

create function public.list_my_professional_patients(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  diagnosis text,
  is_linked boolean,
  has_care_team boolean,
  next_appointment_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = v_uid
      and pr.account_type = 'professional'
  ) then
    raise exception 'professional_account_required' using errcode = '42501';
  end if;

  return query
  with visible_patients as (
    select
      p.id,
      p.user_id,
      p.name,
      p.diagnosis,
      (
        exists (
          select 1
          from public.professional_connection_requests r
          where r.patient_id = p.id
            and r.professional_id = v_uid
            and r.status in ('accepted', 'active')
        )
        or exists (
          select 1
          from public.patient_care_team ct
          where ct.patient_id = p.id
            and ct.professional_id = v_uid
            and ct.status = 'active'
        )
      ) as is_linked,
      exists (
        select 1
        from public.patient_care_team ct
        where ct.patient_id = p.id
          and ct.professional_id = v_uid
          and ct.status = 'active'
      ) as has_care_team
    from public.patients p
    where p.user_id = v_uid
       or exists (
         select 1
         from public.professional_connection_requests r
         where r.patient_id = p.id
           and r.professional_id = v_uid
           and r.status in ('accepted', 'active')
       )
       or exists (
         select 1
         from public.patient_care_team ct
         where ct.patient_id = p.id
           and ct.professional_id = v_uid
           and ct.status = 'active'
       )
  )
  select
    vp.id,
    vp.user_id,
    vp.name,
    vp.diagnosis,
    vp.is_linked,
    vp.has_care_team,
    case when vp.has_care_team then (
      select a.scheduled_at
      from public.patient_appointments a
      where a.patient_id = vp.id
        and a.professional_id = v_uid
        and a.status = 'confirmed'
        and a.scheduled_at >= now()
      order by a.scheduled_at asc
      limit 1
    ) else null end as next_appointment_at,
    count(*) over () as total_count
  from visible_patients vp
  order by vp.name asc nulls last, vp.id asc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.list_my_professional_patients(integer, integer) from public;
revoke all on function public.list_my_professional_patients(integer, integer) from anon;
grant execute on function public.list_my_professional_patients(integer, integer) to authenticated;