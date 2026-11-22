CREATE OR REPLACE FUNCTION public.create_professional_patient(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_patient_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING errcode = '28000'; END IF;
  IF v_name IS NULL OR char_length(v_name)<2 OR char_length(v_name)>120 THEN
    RAISE EXCEPTION 'invalid_patient_name' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id=v_uid AND pr.account_type='professional' AND pr.role<>'admin'
  ) THEN RAISE EXCEPTION 'professional_account_required' USING errcode = '42501'; END IF;
  IF NOT public.can_add_patient(v_uid) THEN
    RAISE EXCEPTION 'active_subscription_or_patient_quota_required' USING errcode = '42501';
  END IF;
  INSERT INTO public.patients(user_id,name) VALUES(v_uid,v_name) RETURNING id INTO v_patient_id;
  RETURN v_patient_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_professional_patient(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_professional_patient(text) TO authenticated;
