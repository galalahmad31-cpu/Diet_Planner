-- Harden professional directory lifecycle and expose only the minimum identity needed for connection requests.
create or replace function public.list_professional_connection_requests()
returns table(request_id uuid, patient_name text, message text, status text, created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 return query select r.id,p.name::text,r.message,r.status,r.created_at
 from public.professional_connection_requests r join public.patients p on p.id=r.patient_id
 where r.professional_id=v_uid order by r.created_at desc limit 100;
end $$;
create or replace function public.list_my_professional_connection_requests()
returns table(professional_id uuid,professional_name text,professional_title text,status text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_patient uuid;
begin
 if v_uid is null then raise exception 'authentication_required'; end if;
 select a.patient_id into v_patient from public.patient_accounts a where a.user_id=v_uid and a.status='active';
 if v_patient is null then raise exception 'patient_account_not_linked'; end if;
 return query select r.professional_id,d.display_name,d.professional_title,r.status,r.created_at
 from public.professional_connection_requests r join public.professional_directory_profiles d on d.user_id=r.professional_id
 where r.patient_id=v_patient and r.requested_by=v_uid order by r.created_at desc limit 100;
end $$;
create or replace function public.withdraw_professional_directory_profile()
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 update public.professional_directory_profiles set listing_status='draft',is_verified=false,moderation_note=null,updated_at=now()
 where user_id=auth.uid() and listing_status in ('published','pending_review');
 if not found then raise exception 'profile_not_withdrawable'; end if;
end $$;
create or replace function public.moderate_professional_directory_profile(p_user_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'admin_required'; end if;
 if p_decision not in ('published','rejected','suspended') then raise exception 'invalid_decision'; end if;
 update public.professional_directory_profiles set listing_status=p_decision,is_verified=(p_decision='published'),moderation_note=left(p_note,1000),reviewed_at=now(),updated_at=now()
 where user_id=p_user_id and ((listing_status='pending_review' and p_decision in ('published','rejected')) or (listing_status='published' and p_decision='suspended'));
 if not found then raise exception 'listing_not_in_moderatable_state'; end if;
end $$;
revoke all on function public.list_professional_connection_requests() from public,anon;
revoke all on function public.list_my_professional_connection_requests() from public,anon;
revoke all on function public.withdraw_professional_directory_profile() from public,anon;
grant execute on function public.list_professional_connection_requests() to authenticated;
grant execute on function public.list_my_professional_connection_requests() to authenticated;
grant execute on function public.withdraw_professional_directory_profile() to authenticated;