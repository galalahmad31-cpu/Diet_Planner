-- Qualify every output-column name inside the PL/pgSQL body.
-- The RETURNS TABLE output variable "id" made the unqualified profiles.id
-- reference ambiguous and caused the professional patient directory RPC to return HTTP 400.
CREATE OR REPLACE FUNCTION public.list_my_professional_patients(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  name text,
  diagnosis text,
  is_linked boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile_row
    WHERE profile_row.id = v_uid
      AND profile_row.account_type = 'professional'
  ) THEN
    RAISE EXCEPTION 'professional_account_required' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    patient_row.id,
    patient_row.user_id,
    patient_row.name,
    patient_row.diagnosis,
    EXISTS (
      SELECT 1
      FROM public.patient_accounts AS account_row
      WHERE account_row.patient_id = patient_row.id
        AND account_row.status = 'active'
    ),
    COUNT(*) OVER ()
  FROM public.patients AS patient_row
  WHERE patient_row.user_id = v_uid
  ORDER BY patient_row.name ASC NULLS LAST, patient_row.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$function$;
