-- Correct subscription and follow-up authorization for nutrition-plan creation/publication.
-- These functions run as SECURITY DEFINER, so the checks must be enforced here,
-- not only by frontend visibility or table RLS.

CREATE OR REPLACE FUNCTION public.create_nutrition_plan(p_patient_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_plan_count integer;
  v_max_number integer;
  v_next_number integer;
  v_plan_id uuid;
  v_plan_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;
  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'patient_id is required' USING errcode = '22023';
  END IF;
  IF NOT private.can_manage_patient_care(p_patient_id) THEN
    RAISE EXCEPTION 'Patient care access denied' USING errcode = '42501';
  END IF;
  IF private.is_patient_followup_expired(p_patient_id) THEN
    RAISE EXCEPTION 'patient_followup_expired_read_only' USING errcode = '42501';
  END IF;

  SELECT COALESCE(pr.role = 'admin', false) INTO v_is_admin
  FROM public.profiles pr WHERE pr.id = v_user_id;

  IF NOT COALESCE(v_is_admin, false)
     AND NOT public.has_active_subscription(v_user_id) THEN
    RAISE EXCEPTION 'An active paid subscription is required' USING errcode = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_patient_id::text || '|nutrition-plan-sequence', 0)
  );

  SELECT count(*)::integer,
         COALESCE(max(nullif(substring(np.plan_name FROM '^الخطة ([0-9]+)'), '')::integer), 0)
    INTO v_plan_count, v_max_number
  FROM public.nutrition_plans np
  WHERE np.patient_id = p_patient_id;

  v_next_number := greatest(v_plan_count, v_max_number) + 1;
  v_plan_name := 'الخطة ' || v_next_number || ' - ' || to_char(current_date, 'DD/MM/YYYY');

  INSERT INTO public.nutrition_plans(patient_id, plan_name, start_date)
  VALUES (p_patient_id, v_plan_name, current_date)
  RETURNING id INTO v_plan_id;

  RETURN v_plan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_patient_nutrition_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_patient_id uuid;
  v_is_owner boolean := false;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;

  SELECT np.patient_id INTO v_patient_id
  FROM public.nutrition_plans np WHERE np.id = p_plan_id;

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'Nutrition plan not found' USING errcode = 'P0002';
  END IF;

  v_is_owner := private.is_patient_workspace_owner(v_patient_id, v_uid);
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Plan is not accessible to caller' USING errcode = '42501';
  END IF;

  SELECT COALESCE(pr.role = 'admin', false) INTO v_is_admin
  FROM public.profiles pr WHERE pr.id = v_uid;

  IF NOT COALESCE(v_is_admin, false) THEN
    IF private.is_patient_followup_expired(v_patient_id) THEN
      RAISE EXCEPTION 'patient_followup_expired_read_only' USING errcode = '42501';
    END IF;
    IF NOT public.has_active_subscription(v_uid) THEN
      RAISE EXCEPTION 'Active professional subscription required' USING errcode = '42501';
    END IF;
  END IF;

  INSERT INTO public.patient_plan_publications (plan_id, published_by)
  VALUES (p_plan_id, v_uid)
  ON CONFLICT (plan_id) DO UPDATE
    SET published_by = excluded.published_by,
        published_at = now(),
        revoked_at = null;
END;
$function$;
