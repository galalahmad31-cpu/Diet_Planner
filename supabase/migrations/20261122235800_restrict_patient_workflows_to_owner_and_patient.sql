-- SECURITY DEFINER workflows must enforce the same owner/patient boundary as RLS.
DO $migration$
DECLARE v_def text; v_old text;
BEGIN
  SELECT pg_get_functiondef('public.cancel_patient_appointment(uuid,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,
    '  select v_appointment.professional_id = v_user_id and (' || chr(10) ||
    '    private.is_active_patient_care_team_member(v_appointment.patient_id, v_user_id)' || chr(10) ||
    '    or exists (' || chr(10) ||
    '      select 1 from public.patients p' || chr(10) ||
    '      where p.id = v_appointment.patient_id and p.user_id = v_user_id' || chr(10) ||
    '        and not exists (' || chr(10) ||
    '          select 1 from public.professional_connection_requests r' || chr(10) ||
    '          where r.patient_id = p.id and r.professional_id = v_user_id' || chr(10) ||
    '            and r.status in (''accepted'',''active'')' || chr(10) ||
    '        )' || chr(10) || '    )' || chr(10) || '  ) into v_is_professional;',
    '  select v_appointment.professional_id = v_user_id' || chr(10) ||
    '    and private.is_patient_workspace_owner(v_appointment.patient_id, v_user_id)' || chr(10) ||
    '    into v_is_professional;');
  IF v_def=v_old THEN RAISE EXCEPTION 'cancel_patient_appointment owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.respond_patient_appointment(uuid,text,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'  v_is_active_care_professional :=' || chr(10) ||
    '    private.is_active_patient_care_team_member(v_appointment.patient_id, v_user_id);',
    '  v_is_active_care_professional :=' || chr(10) ||
    '    private.is_patient_workspace_owner(v_appointment.patient_id, v_user_id);');
  v_def:=replace(v_def,
    '  select exists (' || chr(10) ||
    '    select 1 from public.patients p' || chr(10) ||
    '    where p.id = v_appointment.patient_id and p.user_id = v_user_id' || chr(10) ||
    '      and not exists (' || chr(10) ||
    '        select 1 from public.professional_connection_requests r' || chr(10) ||
    '        where r.patient_id = p.id and r.professional_id = v_user_id' || chr(10) ||
    '          and r.status in (''accepted'',''active'')' || chr(10) ||
    '      )' || chr(10) || '  ) into v_is_record_owner;',
    '  v_is_record_owner := private.is_patient_workspace_owner(v_appointment.patient_id, v_user_id);');
  IF v_def=v_old THEN RAISE EXCEPTION 'respond_patient_appointment owner checks not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.mark_patient_messages_read(uuid,uuid)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,
    '  if not (' || chr(10) || '    exists (' || chr(10) || '      select 1' || chr(10) || '      from public.patient_accounts pa',
    '  if not (private.is_patient_workspace_owner(p_patient_id, v_user_id)' || chr(10) ||
    '    or private.is_active_patient_account(p_patient_id, v_user_id)) then' || chr(10) ||
    '    raise exception ''Not authorized for this conversation'';' || chr(10) ||
    '  end if;' || chr(10) || '  if not (' || chr(10) || '    exists (' || chr(10) || '      select 1' || chr(10) || '      from public.patient_accounts pa');
  IF v_def=v_old THEN RAISE EXCEPTION 'mark_patient_messages_read workspace guard not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.confirm_professional_connection_step(uuid,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,
    '  if v_uid <> v_request.requested_by and v_uid <> v_request.professional_id then' || chr(10) ||
    '    raise exception ''not_authorized'';' || chr(10) || '  end if;',
    '  if v_uid <> v_request.requested_by and v_uid <> v_request.professional_id then' || chr(10) ||
    '    raise exception ''not_authorized'';' || chr(10) || '  end if;' || chr(10) ||
    '  if v_uid = v_request.professional_id and not private.is_patient_workspace_owner(v_request.patient_id, v_uid) then' || chr(10) ||
    '    raise exception ''patient_workspace_owner_required'';' || chr(10) || '  end if;' || chr(10) ||
    '  if v_uid = v_request.requested_by and not private.is_active_patient_account(v_request.patient_id, v_uid) then' || chr(10) ||
    '    raise exception ''patient_account_required'';' || chr(10) || '  end if;');
  IF v_def=v_old THEN RAISE EXCEPTION 'confirm_professional_connection_step participant guard not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.end_professional_followup(uuid,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'  if v_request.status <> ''active'' or v_request.payment_received_at is null then',
    '  if not private.is_patient_workspace_owner(v_request.patient_id, v_uid) then' || chr(10) ||
    '    raise exception ''patient_workspace_owner_required'';' || chr(10) ||
    '  end if;' || chr(10) || '  if v_request.status <> ''active'' or v_request.payment_received_at is null then');
  IF v_def=v_old THEN RAISE EXCEPTION 'end_professional_followup owner guard not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.list_professional_connection_requests()'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'  where r.professional_id=v_uid','  where r.professional_id=v_uid' || chr(10) || '    and private.is_patient_workspace_owner(r.patient_id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'list_professional_connection_requests owner filter not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.respond_professional_connection_request(uuid,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,
    '  if v_uid is null then raise exception ''authentication_required''; end if;',
    '  if v_uid is null then raise exception ''authentication_required''; end if;' || chr(10) ||
    '  if not exists (select 1 from public.profiles pr where pr.id=v_uid and pr.account_type=''professional'' and pr.role<>''admin'') then' || chr(10) ||
    '    raise exception ''professional_account_required'';' || chr(10) || '  end if;');
  v_def:=replace(v_def,'    if v_patient is null then' || chr(10) || '      if exists (',
    '    if v_patient is not null and not private.is_patient_workspace_owner(v_patient, v_uid) then' || chr(10) ||
    '      raise exception ''patient_record_owned_by_another_professional'';' || chr(10) ||
    '    end if;' || chr(10) || '    if v_patient is null then' || chr(10) || '      if exists (');
  v_def:=replace(v_def,'      if v_subscription is null and not public.is_admin() then','      if v_subscription is null then');
  IF v_def=v_old THEN RAISE EXCEPTION 'respond_professional_connection_request owner guard not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.protect_patient_ownership()'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'    IF session_user = ''postgres'' OR public.is_admin() THEN','    IF session_user = ''postgres'' THEN');
  IF v_def=v_old THEN RAISE EXCEPTION 'protect_patient_ownership admin bypass not found'; END IF; EXECUTE v_def;
END;
$migration$;
