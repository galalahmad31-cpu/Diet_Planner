-- Validate public professional data and complete patient cancellation / serialized primary assignment.
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.professional_directory_profiles'::regclass and conname='professional_directory_specialties_nonempty') then
  alter table public.professional_directory_profiles add constraint professional_directory_specialties_nonempty check(cardinality(specialties)>0 and array_position(specialties,'') is null);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.professional_directory_profiles'::regclass and conname='professional_directory_service_modes_valid') then
  alter table public.professional_directory_profiles add constraint professional_directory_service_modes_valid check(cardinality(service_modes)>0 and service_modes <@ array['online','in_person','phone']::text[]);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.professional_directory_profiles'::regclass and conname='professional_directory_languages_nonempty') then
  alter table public.professional_directory_profiles add constraint professional_directory_languages_nonempty check(cardinality(languages)>0);
 end if;
end $$;
create or replace function public.respond_professional_connection_request(p_request_id uuid,p_decision text)
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_patient uuid;v_prof uuid;v_status text;v_role text;
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 if p_decision not in ('accepted','declined') then raise exception 'invalid_decision'; end if;
 select patient_id,professional_id,status into v_patient,v_prof,v_status from public.professional_connection_requests where id=p_request_id for update;
 if v_patient is null or v_prof<>v_uid then raise exception 'request_not_found'; end if;
 if v_status<>'pending' then raise exception 'request_not_pending'; end if;
 if p_decision='accepted' then
  if not exists(select 1 from public.professional_directory_profiles where user_id=v_uid and listing_status='published' and is_verified) then raise exception 'professional_listing_not_active'; end if;
  perform 1 from public.patients where id=v_patient for update;
  select case when exists(select 1 from public.patient_care_team where patient_id=v_patient and status='active' and relationship_role='primary') then 'collaborator' else 'primary' end into v_role;
  insert into public.patient_care_team(patient_id,professional_id,relationship_role,status,started_at,ended_at) values(v_patient,v_uid,v_role,'active',now(),null)
  on conflict(patient_id,professional_id) do update set relationship_role=excluded.relationship_role,status='active',started_at=now(),ended_at=null;
 end if;
 update public.professional_connection_requests set status=p_decision,decided_at=now(),updated_at=now() where id=p_request_id;
end $$;
create or replace function public.cancel_professional_connection_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 update public.professional_connection_requests set status='cancelled',decided_at=now(),updated_at=now()
 where id=p_request_id and requested_by=auth.uid() and status='pending';
 if not found then raise exception 'request_not_cancellable'; end if;
end $$;
revoke all on function public.cancel_professional_connection_request(uuid) from public,anon;
grant execute on function public.cancel_professional_connection_request(uuid) to authenticated;