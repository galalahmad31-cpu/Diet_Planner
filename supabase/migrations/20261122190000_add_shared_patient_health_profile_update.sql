create or replace function public.update_shared_patient_health_profile(
 p_patient_id uuid,
 p_gender text default null,
 p_birth_date date default null,
 p_height numeric default null,
 p_diagnosis text default null,
 p_complaints text default null
)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public' set row_security='off'
as $function$
declare
 v_uid uuid:=auth.uid();
 v_is_admin boolean;
 v_is_patient boolean;
 v_is_professional boolean;
 v_result jsonb;
begin
 if v_uid is null or p_patient_id is null then raise exception 'authentication_required' using errcode='28000'; end if;
 select public.is_admin() into v_is_admin;
 select exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid)
   or exists(select 1 from public.patient_accounts pa where pa.patient_id=p_patient_id and pa.user_id=v_uid and pa.status='active')
 into v_is_patient;
 select exists(select 1 from public.patient_care_team pct where pct.patient_id=p_patient_id and pct.professional_id=v_uid and pct.status='active')
 into v_is_professional;
 if not (v_is_admin or v_is_patient or v_is_professional) then raise exception 'patient_workspace_access_denied' using errcode='42501'; end if;
 if v_is_professional and not v_is_patient and not v_is_admin and private.is_expired_care_professional(p_patient_id) then
  raise exception 'care_agreement_expired_read_only' using errcode='42501';
 end if;
 if p_gender is not null and length(trim(p_gender))>30 then raise exception 'invalid_gender_value'; end if;
 if p_height is not null and (p_height<30 or p_height>260) then raise exception 'height_out_of_range'; end if;
 if p_diagnosis is not null and length(p_diagnosis)>4000 then raise exception 'diagnosis_too_long'; end if;
 if p_complaints is not null and length(p_complaints)>4000 then raise exception 'complaints_too_long'; end if;
 update public.patients set gender=p_gender,birth_date=p_birth_date,
  age=case when p_birth_date is null then null else extract(year from age(current_date,p_birth_date)) end,
  height=p_height,diagnosis=nullif(trim(p_diagnosis),''),complaints=nullif(trim(p_complaints),'')
 where id=p_patient_id
 returning jsonb_build_object('id',id,'name',name,'gender',gender,'birth_date',birth_date,'age',age,'height',height,'diagnosis',diagnosis,'complaints',complaints) into v_result;
 if v_result is null then raise exception 'patient_not_found'; end if;
 return v_result;
end
$function$;
revoke all on function public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text) from public,anon;
grant execute on function public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text) to authenticated;