-- Final hardening for the direct-owner / linked-patient workspace model.
-- No patient data is inserted, updated, or deleted by this migration.

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
    OR NOT EXISTS (
      SELECT 1
      FROM public.patient_finances AS pf
      JOIN public.patients AS p
        ON p.id = pf.patient_id
      WHERE pf.patient_id = p_patient_id
        AND pf.user_id = auth.uid()
        AND p.user_id = auth.uid()
        AND pf.subscription_end_date IS NOT NULL
        AND pf.subscription_end_date >= CURRENT_DATE
    );
$function$;

-- This RPC already checks is_admin() internally. Do not expose it to anonymous callers.
REVOKE EXECUTE ON FUNCTION public.admin_set_profile_account_type(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_account_type(uuid, text) TO authenticated, service_role;

-- Keep the public feedback projection read-only and make its underlying RLS effective.
ALTER VIEW public.app_feedback_public SET (security_invoker = true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_feedback_public
  FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.app_feedback_public TO anon, authenticated, service_role;

-- The invoker view exposes only these selected fields to anonymous users.
-- In particular, user_id remains unavailable to anon.
GRANT SELECT (id, rating, comment, display_name, created_at, updated_at)
  ON TABLE public.app_feedback TO anon;
