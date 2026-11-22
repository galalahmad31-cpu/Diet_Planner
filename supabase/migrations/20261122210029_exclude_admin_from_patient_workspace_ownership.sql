-- Admin users are not professional workspace owners, even for legacy rows.
CREATE OR REPLACE FUNCTION private.is_patient_workspace_owner(p_patient_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET row_security TO 'off'
AS $function$
  SELECT p_patient_id IS NOT NULL AND p_user_id IS NOT NULL AND p_user_id=auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles pr JOIN public.patients p ON p.user_id=pr.id
      WHERE p.id=p_patient_id AND pr.id=p_user_id
        AND pr.role<>'admin' AND pr.account_type='professional'
    );
$function$;

CREATE OR REPLACE FUNCTION private.can_access_patient_workspace(p_patient_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET row_security TO 'off'
AS $function$
  SELECT p_patient_id IS NOT NULL AND auth.uid() IS NOT NULL
    AND (private.is_patient_workspace_owner(p_patient_id,auth.uid())
      OR private.is_active_patient_account(p_patient_id,auth.uid()));
$function$;

DROP POLICY IF EXISTS patients_select_owner_or_linked_patient ON public.patients;
CREATE POLICY patients_select_owner_or_linked_patient ON public.patients FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())) OR private.is_active_patient_account(id,(SELECT auth.uid())));
DROP POLICY IF EXISTS patient_workspace_select_gate ON public.patients;
CREATE POLICY patient_workspace_select_gate ON public.patients AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())) OR private.is_active_patient_account(id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patients_update_owner_with_subscription ON public.patients;
DROP POLICY IF EXISTS patient_workspace_update_gate ON public.patients;
CREATE POLICY patients_update_owner_with_subscription ON public.patients FOR UPDATE TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())) AND public.has_active_subscription((SELECT auth.uid())))
WITH CHECK (private.is_patient_workspace_owner(id,(SELECT auth.uid())) AND public.has_active_subscription((SELECT auth.uid())));
CREATE POLICY patient_workspace_update_gate ON public.patients AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())))
WITH CHECK (private.is_patient_workspace_owner(id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patients_delete_owner_with_subscription ON public.patients;
DROP POLICY IF EXISTS patient_workspace_delete_gate ON public.patients;
CREATE POLICY patients_delete_owner_with_subscription ON public.patients FOR DELETE TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())) AND public.has_active_subscription((SELECT auth.uid())));
CREATE POLICY patient_workspace_delete_gate ON public.patients AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.is_patient_workspace_owner(id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patient_finances_owner_only ON public.patient_finances;
CREATE POLICY patient_finances_owner_only ON public.patient_finances AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id=(SELECT auth.uid()) AND private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())))
WITH CHECK (user_id=(SELECT auth.uid()) AND private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patient_appointments_select_owner_or_patient ON public.patient_appointments;
CREATE POLICY patient_appointments_select_owner_or_patient ON public.patient_appointments FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())) OR private.is_active_patient_account(patient_id,(SELECT auth.uid())));
DROP POLICY IF EXISTS patient_health_audit_read_owner_or_patient ON public.patient_health_audit;
CREATE POLICY patient_health_audit_read_owner_or_patient ON public.patient_health_audit FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())) OR private.is_active_patient_account(patient_id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patient_accounts_select_self ON public.patient_accounts;
CREATE POLICY patient_accounts_select_self ON public.patient_accounts FOR SELECT TO authenticated
USING ((user_id=(SELECT auth.uid()) AND status='active') OR private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())));
DROP POLICY IF EXISTS patient_care_team_select_patient_or_professional ON public.patient_care_team;
CREATE POLICY patient_care_team_select_patient_or_professional ON public.patient_care_team FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())) OR private.is_active_patient_account(patient_id,(SELECT auth.uid())));
DROP POLICY IF EXISTS professional_connection_professional_read ON public.professional_connection_requests;
CREATE POLICY professional_connection_professional_read ON public.professional_connection_requests FOR SELECT TO authenticated
USING (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())));

DROP POLICY IF EXISTS patient_messages_workspace_isolation ON public.patient_messages;
CREATE POLICY patient_messages_workspace_isolation ON public.patient_messages AS RESTRICTIVE FOR ALL TO authenticated
USING (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())) OR private.is_active_patient_account(patient_id,(SELECT auth.uid())))
WITH CHECK (private.is_patient_workspace_owner(patient_id,(SELECT auth.uid())) OR private.is_active_patient_account(patient_id,(SELECT auth.uid())));

DO $migration$
DECLARE v_def text; v_old text;
BEGIN
  SELECT pg_get_functiondef('public.create_patient_invitation(uuid)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'    where p.id = p_patient_id'||chr(10)||'      and p.user_id = v_uid','    where p.id = p_patient_id'||chr(10)||'      and private.is_patient_workspace_owner(p.id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'create_patient_invitation owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.create_professional_patient_appointment(uuid,timestamp with time zone,integer,text,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'    where p.id = p_patient_id and p.user_id = v_uid','    where p.id = p_patient_id and private.is_patient_workspace_owner(p.id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'appointment owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.publish_patient_nutrition_plan(uuid)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'where np.id = p_plan_id and p.user_id = v_uid','where np.id = p_plan_id and private.is_patient_workspace_owner(p.id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'publish owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.revoke_patient_nutrition_plan(uuid)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'    and p.user_id = v_uid','    and private.is_patient_workspace_owner(p.id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'revoke owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.update_shared_patient_health_profile(uuid,text,date,numeric,text,text)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'   where p.id = p_patient_id and p.user_id = v_uid','   where p.id = p_patient_id and private.is_patient_workspace_owner(p.id, v_uid)');
  IF v_def=v_old THEN RAISE EXCEPTION 'shared profile owner check not found'; END IF; EXECUTE v_def;

  SELECT pg_get_functiondef('public.save_nutrition_plan_day(jsonb,jsonb)'::regprocedure) INTO v_def; v_old:=v_def;
  v_def:=replace(v_def,'    where p.id = v_patient_id and p.user_id = v_user_id','    where p.id = v_patient_id and private.is_patient_workspace_owner(p.id, v_user_id)');
  IF v_def=v_old THEN RAISE EXCEPTION 'save day owner check not found'; END IF; EXECUTE v_def;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.can_manage_plan_meal(p_meal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private' SET row_security TO 'off'
AS $function$
SELECT p_meal_id IS NOT NULL AND public.has_active_subscription(auth.uid()) AND EXISTS (
 SELECT 1 FROM public.plan_meals pm JOIN public.plan_days pd ON pd.id=pm.day_id
 JOIN public.nutrition_plans np ON np.id=pd.plan_id
 WHERE pm.id=p_meal_id AND private.is_patient_workspace_owner(np.patient_id,auth.uid())
);
$function$;

CREATE OR REPLACE FUNCTION private.can_read_plan_meal(p_meal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private' SET row_security TO 'off'
AS $function$
SELECT p_meal_id IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.plan_meals pm JOIN public.plan_days pd ON pd.id=pm.day_id
 JOIN public.nutrition_plans np ON np.id=pd.plan_id
 WHERE pm.id=p_meal_id AND private.can_access_patient_workspace(np.patient_id)
 AND (
  (private.is_patient_workspace_owner(np.patient_id,auth.uid()) AND public.has_active_subscription(auth.uid()))
  OR EXISTS (
   SELECT 1 FROM public.patient_plan_publications pp JOIN public.patient_accounts pa ON pa.patient_id=np.patient_id
   WHERE pp.plan_id=np.id AND pp.revoked_at IS NULL AND pa.user_id=auth.uid() AND pa.status='active'
  )
 )
);
$function$;
