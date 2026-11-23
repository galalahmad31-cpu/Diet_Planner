-- Restore the RPC used by js/patient-profile.js.
-- The current patient workspace is directly owned by the professional account;
-- authorization and follow-up expiry are checked through the centralized helpers.
CREATE OR REPLACE FUNCTION public.update_shared_patient_health_profile(
  p_patient_id uuid,
  p_gender text,
  p_birth_date date,
  p_height numeric,
  p_diagnosis text,
  p_complaints text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR p_patient_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
  END IF;

  IF NOT private.is_patient_workspace_owner(p_patient_id, v_uid) THEN
    RAISE EXCEPTION 'patient_workspace_access_denied' USING errcode = '42501';
  END IF;

  IF private.is_patient_followup_expired(p_patient_id) THEN
    RAISE EXCEPTION 'patient_followup_expired_read_only' USING errcode = '42501';
  END IF;

  IF p_gender IS NOT NULL AND p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'invalid_gender_value';
  END IF;
  IF p_birth_date IS NOT NULL AND p_birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'birth_date_in_future';
  END IF;
  IF p_height IS NOT NULL AND (p_height < 30 OR p_height > 260) THEN
    RAISE EXCEPTION 'height_out_of_range';
  END IF;
  IF p_diagnosis IS NOT NULL AND length(p_diagnosis) > 4000 THEN
    RAISE EXCEPTION 'diagnosis_too_long';
  END IF;
  IF p_complaints IS NOT NULL AND length(p_complaints) > 4000 THEN
    RAISE EXCEPTION 'complaints_too_long';
  END IF;

  UPDATE public.patients AS patient_row
  SET gender = p_gender,
      birth_date = p_birth_date,
      age = CASE
        WHEN p_birth_date IS NULL THEN NULL
        ELSE extract(year FROM age(CURRENT_DATE, p_birth_date))
      END,
      height = p_height,
      diagnosis = nullif(trim(p_diagnosis), ''),
      complaints = nullif(trim(p_complaints), '')
  WHERE patient_row.id = p_patient_id
    AND patient_row.user_id = v_uid
  RETURNING jsonb_build_object(
    'id', patient_row.id,
    'name', patient_row.name,
    'gender', patient_row.gender,
    'birth_date', patient_row.birth_date,
    'age', patient_row.age,
    'height', patient_row.height,
    'diagnosis', patient_row.diagnosis,
    'complaints', patient_row.complaints
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'patient_not_found' USING errcode = 'P0002';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_shared_patient_health_profile(uuid, text, date, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_shared_patient_health_profile(uuid, text, date, numeric, text, text)
  TO authenticated;
