alter table public.professional_connection_requests
  drop constraint if exists professional_connection_requests_status_check;
alter table public.professional_connection_requests
  add constraint professional_connection_requests_status_check
  check (status = any (array['pending','accepted','declined','cancelled','ended']::text[]));

create or replace function public.end_professional_connection(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_professional_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'invalid_request_id' using errcode='22023'; end if;
  select r.professional_id,r.status into v_professional_id,v_status
  from public.professional_connection_requests r where r.id=p_request_id for update;
  if not found then raise exception 'connection_not_found' using errcode='P0002'; end if;
  if v_professional_id<>v_uid then raise exception 'not_connection_professional' using errcode='42501'; end if;
  if v_status<>'accepted' then raise exception 'connection_not_active' using errcode='55000'; end if;
  update public.professional_connection_requests
  set status='ended',decided_at=now(),updated_at=now()
  where id=p_request_id and professional_id=v_uid and status='accepted';
end;
$function$;
revoke all on function public.end_professional_connection(uuid) from public,anon;
grant execute on function public.end_professional_connection(uuid) to authenticated;

