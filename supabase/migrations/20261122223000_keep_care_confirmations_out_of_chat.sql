create or replace function public.confirm_professional_connection_step(p_request_id uuid, p_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_request public.professional_connection_requests%rowtype;
  v_role text;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;

  select * into v_request
  from public.professional_connection_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request_not_found'; end if;
  if v_request.status not in ('accepted','active') then raise exception 'conversation_not_accepted'; end if;
  if v_uid <> v_request.requested_by and v_uid <> v_request.professional_id then
    raise exception 'not_authorized';
  end if;

  if p_step = 'agreement' then
    if v_request.status <> 'accepted' then raise exception 'follow_up_already_active'; end if;
    if v_request.agreement_service_title is null
       or v_request.agreement_amount is null
       or v_request.agreement_duration_days is null
       or v_request.agreement_start_date is null
       or v_request.agreement_end_date is null then
      raise exception 'care_agreement_not_proposed';
    end if;

    if v_uid = v_request.requested_by then
      if v_request.patient_agreement_at is not null then raise exception 'step_already_confirmed'; end if;
      update public.professional_connection_requests
      set patient_agreement_at = now(), updated_at = now()
      where id = p_request_id;
    else
      if v_request.professional_agreement_at is not null then raise exception 'step_already_confirmed'; end if;
      update public.professional_connection_requests
      set professional_agreement_at = now(), updated_at = now()
      where id = p_request_id;
    end if;

  elsif p_step = 'payment_sent' then
    if v_uid <> v_request.requested_by then raise exception 'patient_action_only'; end if;
    if v_request.status <> 'accepted'
       or v_request.patient_agreement_at is null
       or v_request.professional_agreement_at is null then
      raise exception 'agreement_not_confirmed';
    end if;
    if v_request.payment_sent_at is not null then raise exception 'step_already_confirmed'; end if;

    update public.professional_connection_requests
    set payment_sent_at = now(), updated_at = now()
    where id = p_request_id;

  elsif p_step = 'payment_received' then
    if v_uid <> v_request.professional_id then raise exception 'professional_action_only'; end if;
    if v_request.status <> 'accepted'
       or v_request.patient_agreement_at is null
       or v_request.professional_agreement_at is null
       or v_request.payment_sent_at is null then
      raise exception 'payment_not_ready_for_receipt';
    end if;
    if v_request.payment_received_at is not null then raise exception 'step_already_confirmed'; end if;

    perform 1 from public.patients where id = v_request.patient_id for update;

    select case when exists (
      select 1 from public.patient_care_team
      where patient_id = v_request.patient_id
        and status = 'active'
        and relationship_role = 'primary'
    ) then 'collaborator' else 'primary' end into v_role;

    insert into public.patient_care_team(
      patient_id, professional_id, relationship_role, status, started_at, ended_at
    ) values (
      v_request.patient_id, v_request.professional_id, v_role, 'active', now(), null
    )
    on conflict (patient_id, professional_id)
    do update set relationship_role = excluded.relationship_role,
                  status = 'active', started_at = now(), ended_at = null;

    update public.professional_connection_requests
    set payment_received_at = now(), status = 'active', updated_at = now()
    where id = p_request_id;

  else
    raise exception 'invalid_confirmation_step';
  end if;
end;
$function$;

revoke all on function public.confirm_professional_connection_step(uuid,text) from public, anon;
grant execute on function public.confirm_professional_connection_step(uuid,text) to authenticated;
