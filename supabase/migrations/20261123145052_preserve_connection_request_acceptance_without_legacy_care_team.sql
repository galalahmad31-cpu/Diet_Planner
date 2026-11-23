create or replace function public.respond_professional_connection_request(p_request_id uuid,p_decision text)
returns void language plpgsql security definer
set search_path = '' set row_security = 'off'
as $$
declare v_uid uuid:=auth.uid(); v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'invalid_decision' using errcode='22023'; end if;
  select status into v_status
  from public.professional_connection_requests
  where id=p_request_id and professional_id=v_uid for update;
  if not found then raise exception 'request_not_found' using errcode='P0002'; end if;
  if v_status<>'pending' then raise exception 'request_not_pending' using errcode='55000'; end if;
  if p_decision='accepted' and not exists(select 1 from public.professional_directory_profiles
    where user_id=v_uid and listing_status='published' and is_verified=true) then
    raise exception 'professional_listing_not_active' using errcode='42501';
  end if;
  update public.professional_connection_requests
  set status=p_decision,decided_at=now(),updated_at=now()
  where id=p_request_id and professional_id=v_uid;
end;
$$;