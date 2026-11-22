create or replace function private.is_active_patient_care_team_member(p_patient_id uuid, p_professional_id uuid)
returns boolean language sql stable security definer
set search_path = 'pg_catalog','public' set row_security = 'off'
as $function$
  select exists (
    select 1 from public.patient_care_team pct
    where pct.patient_id=p_patient_id and pct.professional_id=p_professional_id and pct.status='active'
      and (
        not exists (select 1 from public.professional_connection_requests r
          where r.patient_id=p_patient_id and r.professional_id=p_professional_id and r.status='active')
        or exists (select 1 from public.professional_connection_requests r
          where r.patient_id=p_patient_id and r.professional_id=p_professional_id and r.status='active'
            and (r.agreement_end_date is null or r.agreement_end_date>=current_date))
      )
  );
$function$;

create or replace function private.can_access_patient_workspace(p_patient_id uuid)
returns boolean language sql stable security definer
set search_path = 'pg_catalog','public' set row_security = 'off'
as $function$
  select p_patient_id is not null and auth.uid() is not null and (
    public.is_admin()
    or exists(select 1 from public.patient_accounts pa where pa.patient_id=p_patient_id and pa.user_id=auth.uid() and pa.status='active')
    or private.is_active_patient_care_team_member(p_patient_id,auth.uid())
    or exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=auth.uid()
      and not exists(select 1 from public.professional_connection_requests r where r.patient_id=p.id and r.professional_id=auth.uid() and r.status in ('accepted','active')))
  );
$function$;

drop function if exists public.list_my_professional_connection_requests();
create function public.list_my_professional_connection_requests()
returns table(request_id uuid,professional_id uuid,professional_name text,professional_title text,status text,created_at timestamptz,
agreement_service_title text,agreement_service_description text,agreement_amount numeric,agreement_currency text,
agreement_duration_days integer,agreement_start_date date,agreement_end_date date,agreement_terms text,
patient_agreement_at timestamptz,professional_agreement_at timestamptz,payment_sent_at timestamptz,payment_received_at timestamptz,ended_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 return query select r.id,d.user_id,d.display_name,d.professional_title,r.status,r.created_at,
 r.agreement_service_title,r.agreement_service_description,r.agreement_amount,r.agreement_currency,
 r.agreement_duration_days,r.agreement_start_date,r.agreement_end_date,r.agreement_terms,
 r.patient_agreement_at,r.professional_agreement_at,r.payment_sent_at,r.payment_received_at,r.ended_at
 from public.professional_connection_requests r
 join public.professional_directory_profiles d on d.user_id=r.professional_id
 where r.requested_by=v_uid order by r.created_at desc limit 100;
end;
$function$;

drop function if exists public.list_professional_connection_requests();
create function public.list_professional_connection_requests()
returns table(request_id uuid,patient_id uuid,patient_name text,message text,status text,created_at timestamptz,
requested_by uuid,agreement_service_title text,agreement_service_description text,agreement_amount numeric,
agreement_currency text,agreement_duration_days integer,agreement_start_date date,agreement_end_date date,
agreement_terms text,patient_agreement_at timestamptz,professional_agreement_at timestamptz,
payment_sent_at timestamptz,payment_received_at timestamptz,ended_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 return query select r.id,r.patient_id,coalesce(nullif(btrim(p.full_name),''),'مريض جديد')::text,
 r.message,r.status,r.created_at,r.requested_by,r.agreement_service_title,r.agreement_service_description,
 r.agreement_amount,r.agreement_currency,r.agreement_duration_days,r.agreement_start_date,r.agreement_end_date,
 r.agreement_terms,r.patient_agreement_at,r.professional_agreement_at,r.payment_sent_at,r.payment_received_at,r.ended_at
 from public.professional_connection_requests r join public.profiles p on p.id=r.requested_by
 where r.professional_id=v_uid order by r.created_at desc limit 100;
end;
$function$;

revoke all on function public.list_my_professional_connection_requests() from public,anon;
revoke all on function public.list_professional_connection_requests() from public,anon;
grant execute on function public.list_my_professional_connection_requests() to authenticated;
grant execute on function public.list_professional_connection_requests() to authenticated;
