CREATE OR REPLACE FUNCTION public.can_add_patient(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p_user_id AND pr.account_type = 'professional'
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p_user_id AND pr.role = 'admin'
    ) THEN true
    ELSE COALESCE((
      SELECT s.max_patients_snapshot IS NULL OR
        (SELECT count(*) FROM public.patients pt WHERE pt.user_id = p_user_id) < s.max_patients_snapshot
      FROM public.subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status = 'paid'
        AND s.start_date <= CURRENT_DATE
        AND s.expiry_date >= CURRENT_DATE
      ORDER BY s.start_date DESC, s.id DESC
      LIMIT 1
    ), false)
  END;
$function$;