-- Isolate patient workspaces to the owning professional and the linked patient account.
CREATE OR REPLACE FUNCTION private.can_access_patient_workspace(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET row_security TO 'off'
AS $function$
  SELECT p_patient_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient_id AND p.user_id = auth.uid())
    OR private.is_active_patient_account(p_patient_id, auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_add_patient(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p_user_id AND pr.account_type = 'professional' AND pr.role <> 'admin'
    ) THEN false
    ELSE COALESCE((
      SELECT s.max_patients_snapshot IS NULL OR
        (SELECT count(*) FROM public.patients pt WHERE pt.user_id = p_user_id) < s.max_patients_snapshot
      FROM public.subscriptions s
      WHERE s.user_id = p_user_id AND s.status = 'paid'
        AND s.start_date <= CURRENT_DATE AND s.expiry_date >= CURRENT_DATE
      ORDER BY s.start_date DESC, s.id DESC LIMIT 1
    ), false)
  END;
$function$;

DROP POLICY IF EXISTS patients_select_admin_or_owner ON public.patients;
CREATE POLICY patients_select_owner_or_linked_patient ON public.patients
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR private.is_active_patient_account(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS patient_workspace_select_gate ON public.patients;
CREATE POLICY patient_workspace_select_gate ON public.patients
AS RESTRICTIVE FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR private.is_active_patient_account(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS patients_insert_admin_or_paid_doctor ON public.patients;
DROP POLICY IF EXISTS patient_workspace_insert_gate ON public.patients;
CREATE POLICY patients_insert_owner_with_quota ON public.patients
FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_add_patient((SELECT auth.uid())));
CREATE POLICY patient_workspace_insert_gate ON public.patients
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_add_patient((SELECT auth.uid())));

DROP POLICY IF EXISTS patients_update_admin_or_paid_doctor ON public.patients;
DROP POLICY IF EXISTS patient_workspace_update_gate ON public.patients;
CREATE POLICY patients_update_owner_with_subscription ON public.patients
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.has_active_subscription((SELECT auth.uid())))
WITH CHECK (user_id = (SELECT auth.uid()) AND public.has_active_subscription((SELECT auth.uid())));
CREATE POLICY patient_workspace_update_gate ON public.patients
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS patients_delete_admin_or_paid_owner ON public.patients;
DROP POLICY IF EXISTS patient_workspace_delete_gate ON public.patients;
CREATE POLICY patients_delete_owner_with_subscription ON public.patients
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.has_active_subscription((SELECT auth.uid())));
CREATE POLICY patient_workspace_delete_gate ON public.patients
AS RESTRICTIVE FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS patient_finances_unlinked_only ON public.patient_finances;
CREATE POLICY patient_finances_owner_only ON public.patient_finances
AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS patient_appointments_select_participants ON public.patient_appointments;
CREATE POLICY patient_appointments_select_owner_or_patient ON public.patient_appointments
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.patients p
    WHERE p.id = patient_appointments.patient_id AND p.user_id = (SELECT auth.uid()))
  OR private.is_active_patient_account(patient_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS patient_health_audit_read_participants ON public.patient_health_audit;
CREATE POLICY patient_health_audit_read_owner_or_patient ON public.patient_health_audit
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.patients p
    WHERE p.id = patient_health_audit.patient_id AND p.user_id = (SELECT auth.uid()))
  OR private.is_active_patient_account(patient_id, (SELECT auth.uid()))
);
