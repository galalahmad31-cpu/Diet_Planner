-- A missing legacy finance row is not proof that follow-up has expired.
-- Only an explicitly recorded end date in the past closes professional write access.
CREATE OR REPLACE FUNCTION private.is_patient_followup_expired(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT
    auth.uid() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patient_finances AS pf
      JOIN public.patients AS p
        ON p.id = pf.patient_id
      WHERE pf.patient_id = p_patient_id
        AND pf.user_id = auth.uid()
        AND p.user_id = auth.uid()
        AND pf.subscription_end_date IS NOT NULL
        AND pf.subscription_end_date < CURRENT_DATE
    );
$function$;
