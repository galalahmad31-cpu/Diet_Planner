-- Keep the professional patient list scoped to directly owned files.
-- Appointment and care-team workflow fields are intentionally absent.

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
    FROM public.profiles
    WHERE id = v_uid
      AND account_type = 'professional'
  ) THEN
    RAISE EXCEPTION 'professional_account_required' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.name,
    p.diagnosis,
    EXISTS (
      SELECT 1
      FROM public.patient_accounts pa
      WHERE pa.patient_id = p.id
        AND pa.status = 'active'
    ),
    count(*) OVER ()
  FROM public.patients p
  WHERE p.user_id = v_uid
  ORDER BY p.name ASC NULLS LAST, p.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.list_my_professional_patients(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_professional_patients(integer, integer) TO authenticated, service_role;
