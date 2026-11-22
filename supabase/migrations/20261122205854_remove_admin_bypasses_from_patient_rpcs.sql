-- Remove administrator and non-owner professional bypasses from patient RPCs.
DO $migration$
DECLARE v_def text; v_old text;
BEGIN
  SELECT pg_get_functiondef('public.create_patient_invitation(uuid)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def, '  ) and not public.is_admin() then', '  ) then');
  v_def := replace(v_def, '  if not public.is_admin()' || chr(10) || '     and not public.has_active_subscription(v_uid) then', '  if not public.has_active_subscription(v_uid) then');
  IF v_def = v_old THEN RAISE EXCEPTION 'create_patient_invitation hardening pattern not found'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.create_professional_patient_appointment(uuid,timestamp with time zone,integer,text,text)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def,
    '  if not (' || chr(10) ||
    '    public.is_admin()' || chr(10) ||
    '    or private.is_active_patient_care_team_member(p_patient_id, v_uid)' || chr(10) ||
    '    or exists (' || chr(10) ||
    '      select 1' || chr(10) ||
    '      from public.patients p' || chr(10) ||
    '      where p.id = p_patient_id' || chr(10) ||
    '        and p.user_id = v_uid' || chr(10) ||
    '        and not exists (' || chr(10) ||
    '          select 1' || chr(10) ||
    '          from public.professional_connection_requests r' || chr(10) ||
    '          where r.patient_id = p.id' || chr(10) ||
    '            and r.professional_id = v_uid' || chr(10) ||
    '            and r.status in (''accepted'',''active'')' || chr(10) ||
    '        )' || chr(10) ||
    '    )' || chr(10) ||
    '  ) then',
    '  if not exists (' || chr(10) ||
    '    select 1 from public.patients p' || chr(10) ||
    '    where p.id = p_patient_id and p.user_id = v_uid' || chr(10) ||
    '  ) then');
  v_def := replace(v_def, '  if not public.is_admin() and not private.professional_has_active_subscription(v_uid) then', '  if not private.professional_has_active_subscription(v_uid) then');
  IF v_def = v_old THEN RAISE EXCEPTION 'create_professional_patient_appointment hardening pattern not found'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.publish_patient_nutrition_plan(uuid)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def, '  ) and not public.is_admin() then', '  ) then');
  v_def := replace(v_def, '  if not public.is_admin() and exists (', '  if exists (');
  v_def := replace(v_def, '  if not public.is_admin() and not public.has_active_subscription(v_uid) then', '  if not public.has_active_subscription(v_uid) then');
  IF v_def = v_old THEN RAISE EXCEPTION 'publish_patient_nutrition_plan hardening pattern not found'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.revoke_patient_nutrition_plan(uuid)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def, '    and (p.user_id = v_uid or public.is_admin())', '    and p.user_id = v_uid');
  IF v_def = v_old THEN RAISE EXCEPTION 'revoke_patient_nutrition_plan hardening pattern not found'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def, ' v_is_admin boolean;' || chr(10), '');
  v_def := replace(v_def, ' v_is_professional boolean;' || chr(10), '');
  v_def := replace(v_def, ' select public.is_admin() into v_is_admin;' || chr(10) || chr(10), '');
  v_def := replace(v_def,
    ' -- A professional may have an active care-team relationship or own the workspace.' || chr(10) ||
    ' select exists (' || chr(10) ||
    '   select 1 from public.patient_care_team pct' || chr(10) ||
    '   where pct.patient_id = p_patient_id' || chr(10) ||
    '     and pct.professional_id = v_uid' || chr(10) ||
    '     and pct.status = ''active''' || chr(10) ||
    ' ) into v_is_professional;' || chr(10) || chr(10), '');
  v_def := replace(v_def, ' if not (v_is_admin or v_is_patient or v_is_professional or v_is_owner) then', ' if not (v_is_patient or v_is_owner) then');
  v_def := replace(v_def,
    ' if not v_is_admin' || chr(10) ||
    '    and not v_is_patient' || chr(10) ||
    '    and (v_is_professional or v_is_owner)' || chr(10) ||
    '    and private.is_expired_care_professional(p_patient_id) then',
    ' if not v_is_patient and v_is_owner' || chr(10) ||
    '    and private.is_expired_care_professional(p_patient_id) then');
  IF v_def = v_old OR position('v_is_admin' in v_def) > 0 OR position('v_is_professional' in v_def) > 0 THEN RAISE EXCEPTION 'update_shared_patient_health_profile hardening pattern not found'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.save_nutrition_plan_day(jsonb,jsonb)'::regprocedure) INTO v_def;
  v_old := v_def;
  v_def := replace(v_def, '  v_is_admin boolean := (select public.is_admin());' || chr(10), '');
  v_def := replace(v_def,
    '  if not v_is_admin then' || chr(10) ||
    '    if private.is_expired_care_professional(v_patient_id) then' || chr(10) ||
    '      raise exception ''care_agreement_expired_read_only'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '    if not (select public.has_active_subscription(v_user_id)) then' || chr(10) ||
    '      raise exception ''An active paid subscription is required'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '    if not exists (' || chr(10) ||
    '      select 1 from public.patients p' || chr(10) ||
    '      where p.id = v_patient_id and p.user_id = v_user_id' || chr(10) ||
    '    ) then' || chr(10) ||
    '      raise exception ''Patient access denied'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '  elsif not exists (' || chr(10) ||
    '    select 1 from public.patients p where p.id = v_patient_id' || chr(10) ||
    '  ) then' || chr(10) ||
    '    raise exception ''Patient not found'';' || chr(10) ||
    '  end if;',
    '  if private.is_expired_care_professional(v_patient_id) then' || chr(10) ||
    '    raise exception ''care_agreement_expired_read_only'';' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if not (select public.has_active_subscription(v_user_id)) then' || chr(10) ||
    '    raise exception ''An active paid subscription is required'';' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if not exists (' || chr(10) ||
    '    select 1 from public.patients p' || chr(10) ||
    '    where p.id = v_patient_id and p.user_id = v_user_id' || chr(10) ||
    '  ) then' || chr(10) ||
    '    raise exception ''Patient access denied'';' || chr(10) ||
    '  end if;');
  IF v_def = v_old OR position('v_is_admin' in v_def) > 0 THEN RAISE EXCEPTION 'save_nutrition_plan_day hardening pattern not found'; END IF;
  EXECUTE v_def;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.can_manage_plan_meal(p_meal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET row_security TO 'off'
AS $function$
  SELECT p_meal_id IS NOT NULL
    AND public.has_active_subscription(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.plan_meals pm
      JOIN public.plan_days pd ON pd.id = pm.day_id
      JOIN public.nutrition_plans np ON np.id = pd.plan_id
      JOIN public.patients p ON p.id = np.patient_id
      WHERE pm.id = p_meal_id AND p.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_plan_meal(p_meal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET row_security TO 'off'
AS $function$
  SELECT p_meal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.plan_meals pm
    JOIN public.plan_days pd ON pd.id = pm.day_id
    JOIN public.nutrition_plans np ON np.id = pd.plan_id
    JOIN public.patients p ON p.id = np.patient_id
    WHERE pm.id = p_meal_id
      AND private.can_access_patient_workspace(np.patient_id)
      AND (
        (p.user_id = auth.uid() AND public.has_active_subscription(auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.patient_plan_publications pp
          JOIN public.patient_accounts pa ON pa.patient_id = np.patient_id
          WHERE pp.plan_id = np.id AND pp.revoked_at IS NULL
            AND pa.user_id = auth.uid() AND pa.status = 'active'
        )
      )
  );
$function$;
