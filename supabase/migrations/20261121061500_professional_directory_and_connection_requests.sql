create table if not exists public.professional_directory_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(btrim(display_name)) between 2 and 120),
 professional_title text not null check(char_length(btrim(professional_title)) between 2 and 160),
 bio text not null default '' check(char_length(bio)<=2000),
 specialties text[] not null default '{}'::text[],
 city text not null default '', governorate text not null default '',
 experience_years integer check(experience_years is null or experience_years between 0 and 70),
 service_modes text[] not null default '{}'::text[],
 languages text[] not null default array['Arabic']::text[],
 photo_url text check(photo_url is null or photo_url ~* '^https://'),
 listing_status text not null default 'draft' check(listing_status=any(array['draft','pending_review','published','rejected','suspended'])),
 is_verified boolean not null default false, moderation_note text,
 submitted_at timestamptz, reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists professional_directory_public_idx on public.professional_directory_profiles(governorate,city,updated_at desc) where listing_status='published' and is_verified;
create table if not exists public.professional_connection_requests (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients(id) on delete cascade,
 professional_id uuid not null references auth.users(id) on delete restrict,
 requested_by uuid not null references auth.users(id) on delete cascade,
 message text check(message is null or char_length(message)<=1000),
 status text not null default 'pending' check(status=any(array['pending','accepted','declined','cancelled'])),
 decided_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(patient_id,professional_id)
);
create index if not exists professional_connection_requests_professional_idx on public.professional_connection_requests(professional_id,status,created_at desc);
alter table public.professional_directory_profiles enable row level security;
alter table public.professional_connection_requests enable row level security;
drop policy if exists professional_directory_public_read on public.professional_directory_profiles;
create policy professional_directory_public_read on public.professional_directory_profiles for select to anon,authenticated using(listing_status='published' and is_verified);
drop policy if exists professional_directory_owner_read on public.professional_directory_profiles;
create policy professional_directory_owner_read on public.professional_directory_profiles for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists professional_directory_admin_read on public.professional_directory_profiles;
create policy professional_directory_admin_read on public.professional_directory_profiles for select to authenticated using((select public.is_admin()));
drop policy if exists professional_directory_owner_insert on public.professional_directory_profiles;
create policy professional_directory_owner_insert on public.professional_directory_profiles for insert to authenticated with check(user_id=(select auth.uid()) and listing_status='draft' and is_verified=false);
drop policy if exists professional_directory_owner_update on public.professional_directory_profiles;
create policy professional_directory_owner_update on public.professional_directory_profiles for update to authenticated using(user_id=(select auth.uid()) and listing_status in ('draft','rejected')) with check(user_id=(select auth.uid()) and listing_status in ('draft','rejected') and is_verified=false);
drop policy if exists professional_connection_patient_read on public.professional_connection_requests;
create policy professional_connection_patient_read on public.professional_connection_requests for select to authenticated using(requested_by=(select auth.uid()));
drop policy if exists professional_connection_professional_read on public.professional_connection_requests;
create policy professional_connection_professional_read on public.professional_connection_requests for select to authenticated using(professional_id=(select auth.uid()));
revoke all on public.professional_directory_profiles from anon,authenticated;
grant select on public.professional_directory_profiles to anon,authenticated;
grant insert(display_name,professional_title,bio,specialties,city,governorate,experience_years,service_modes,languages,photo_url) on public.professional_directory_profiles to authenticated;
grant update(display_name,professional_title,bio,specialties,city,governorate,experience_years,service_modes,languages,photo_url) on public.professional_directory_profiles to authenticated;
revoke all on public.professional_connection_requests from anon,authenticated;
grant select on public.professional_connection_requests to authenticated;
create or replace function public.submit_professional_directory_profile() returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 update public.professional_directory_profiles set listing_status='pending_review',is_verified=false,submitted_at=now(),moderation_note=null,updated_at=now()
 where user_id=v_uid and listing_status in ('draft','rejected') and char_length(btrim(display_name))>=2 and char_length(btrim(professional_title))>=2 and cardinality(specialties)>0 and btrim(city)<>'' and btrim(governorate)<>'';
 if not found then raise exception 'profile_incomplete_or_not_editable'; end if;
end $$;
create or replace function public.moderate_professional_directory_profile(p_user_id uuid,p_decision text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'admin_required'; end if;
 if p_decision not in ('published','rejected','suspended') then raise exception 'invalid_decision'; end if;
 update public.professional_directory_profiles set listing_status=p_decision,is_verified=(p_decision='published'),moderation_note=left(p_note,1000),reviewed_at=now(),updated_at=now()
 where user_id=p_user_id and listing_status='pending_review';
 if not found then raise exception 'listing_not_pending_review'; end if;
end $$;
create or replace function public.request_professional_connection(p_professional_id uuid,p_message text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_patient uuid; v_id uuid;
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 if p_message is not null and char_length(p_message)>1000 then raise exception 'message_too_long'; end if;
 select patient_id into v_patient from public.patient_accounts where user_id=v_uid and status='active';
 if v_patient is null then raise exception 'patient_account_not_linked'; end if;
 if not exists(select 1 from public.professional_directory_profiles where user_id=p_professional_id and listing_status='published' and is_verified) then raise exception 'professional_not_available'; end if;
 if exists(select 1 from public.patient_care_team where patient_id=v_patient and professional_id=p_professional_id and status='active') then raise exception 'already_in_care_team'; end if;
 insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message) values(v_patient,p_professional_id,v_uid,nullif(btrim(p_message),'')) on conflict(patient_id,professional_id) do update set requested_by=excluded.requested_by,message=excluded.message,status='pending',decided_at=null,updated_at=now() where public.professional_connection_requests.status in ('declined','cancelled') returning id into v_id;
 if v_id is null then select id into v_id from public.professional_connection_requests where patient_id=v_patient and professional_id=p_professional_id and status='pending'; end if;
 if v_id is null then raise exception 'connection_request_already_processed'; end if;
 return v_id;
end $$;
create or replace function public.respond_professional_connection_request(p_request_id uuid,p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_patient uuid; v_prof uuid; v_status text; v_role text;
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 if p_decision not in ('accepted','declined') then raise exception 'invalid_decision'; end if;
 select patient_id,professional_id,status into v_patient,v_prof,v_status from public.professional_connection_requests where id=p_request_id for update;
 if v_patient is null or v_prof<>v_uid then raise exception 'request_not_found'; end if;
 if v_status<>'pending' then raise exception 'request_not_pending'; end if;
 if p_decision='accepted' then
  if not exists(select 1 from public.professional_directory_profiles where user_id=v_uid and listing_status='published' and is_verified) then raise exception 'professional_listing_not_active'; end if;
  select case when exists(select 1 from public.patient_care_team where patient_id=v_patient and status='active' and relationship_role='primary') then 'collaborator' else 'primary' end into v_role;
  insert into public.patient_care_team(patient_id,professional_id,relationship_role,status,started_at,ended_at) values(v_patient,v_uid,v_role,'active',now(),null)
  on conflict(patient_id,professional_id) do update set relationship_role=excluded.relationship_role,status='active',started_at=now(),ended_at=null;
 end if;
 update public.professional_connection_requests set status=p_decision,decided_at=now(),updated_at=now() where id=p_request_id;
end $$;
revoke all on function public.submit_professional_directory_profile() from public,anon;
revoke all on function public.moderate_professional_directory_profile(uuid,text,text) from public,anon;
revoke all on function public.request_professional_connection(uuid,text) from public,anon;
revoke all on function public.respond_professional_connection_request(uuid,text) from public,anon;
grant execute on function public.submit_professional_directory_profile() to authenticated;
grant execute on function public.moderate_professional_directory_profile(uuid,text,text) to authenticated;
grant execute on function public.request_professional_connection(uuid,text) to authenticated;
grant execute on function public.respond_professional_connection_request(uuid,text) to authenticated;
