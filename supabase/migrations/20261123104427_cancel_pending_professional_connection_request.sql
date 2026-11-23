create or replace function public.cancel_professional_connection_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_uid uuid := auth.uid();
  v_requested_by uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;

  select r.requested_by, r.status
    into v_requested_by, v_status
  from public.professional_connection_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if v_requested_by <> v_uid then
    raise exception 'not_request_owner' using errcode = '42501';
  end if;

  if v_status <> 'pending' then
    raise exception 'request_not_pending' using errcode = '55000';
  end if;

  update public.professional_connection_requests
  set status = 'cancelled',
      decided_at = now(),
      updated_at = now()
  where id = p_request_id
    and requested_by = v_uid
    and status = 'pending';
end;
$function$;

revoke all on function public.cancel_professional_connection_request(uuid) from public, anon;
grant execute on function public.cancel_professional_connection_request(uuid) to authenticated;
