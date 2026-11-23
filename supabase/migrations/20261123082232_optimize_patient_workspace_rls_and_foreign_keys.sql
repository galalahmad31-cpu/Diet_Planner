-- Align patient-workspace RLS with the direct-owner model and avoid per-row auth.uid() evaluation.
-- Add only indexes that cover currently unindexed patient-workspace foreign keys.

DROP POLICY IF EXISTS patients_insert_professional_owner ON public.patients;
CREATE POLICY patients_insert_professional_owner
ON public.patients
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND public.can_add_patient((SELECT auth.uid()))
);

DROP POLICY IF EXISTS patients_delete_professional_owner ON public.patients;
CREATE POLICY patients_delete_professional_owner
ON public.patients
FOR DELETE TO authenticated
USING (
  private.is_patient_workspace_owner(id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
);

DROP POLICY IF EXISTS patients_update_professional_owner ON public.patients;
CREATE POLICY patients_update_professional_owner
ON public.patients
FOR UPDATE TO authenticated
USING (
  private.is_patient_workspace_owner(id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(id)
)
WITH CHECK (
  private.is_patient_workspace_owner(id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(id)
);

DROP POLICY IF EXISTS patient_accounts_select_self_or_owner ON public.patient_accounts;
CREATE POLICY patient_accounts_select_self_or_owner
ON public.patient_accounts
FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()) AND status = 'active')
  OR private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS patient_finances_select_owner_or_patient ON public.patient_finances;
CREATE POLICY patient_finances_select_owner_or_patient
ON public.patient_finances
FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()) AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid())))
  OR private.is_active_patient_account(patient_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS patient_finances_insert_owner ON public.patient_finances;
CREATE POLICY patient_finances_insert_owner
ON public.patient_finances
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND (public.is_admin() OR public.has_active_subscription((SELECT auth.uid())))
);

DROP POLICY IF EXISTS patient_finances_update_owner ON public.patient_finances;
CREATE POLICY patient_finances_update_owner
ON public.patient_finances
FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND (public.is_admin() OR public.has_active_subscription((SELECT auth.uid())))
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND (public.is_admin() OR public.has_active_subscription((SELECT auth.uid())))
);

DROP POLICY IF EXISTS patient_finances_delete_owner ON public.patient_finances;
CREATE POLICY patient_finances_delete_owner
ON public.patient_finances
FOR DELETE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND (public.is_admin() OR public.has_active_subscription((SELECT auth.uid())))
);

DROP POLICY IF EXISTS patient_messages_insert_participants ON public.patient_messages;
CREATE POLICY patient_messages_insert_participants
ON public.patient_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND sender_id <> recipient_id
  AND private.can_read_patient_conversation_message(patient_id, sender_id, recipient_id)
);

DROP POLICY IF EXISTS patient_plan_publications_select_owner_or_patient ON public.patient_plan_publications;
CREATE POLICY patient_plan_publications_select_owner_or_patient
ON public.patient_plan_publications
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.nutrition_plans AS np
    WHERE np.id = patient_plan_publications.plan_id
      AND private.is_patient_workspace_owner(np.patient_id, (SELECT auth.uid()))
  )
  OR (
    revoked_at IS NULL
    AND private.is_linked_patient_for_plan(plan_id)
  )
);

DROP POLICY IF EXISTS weight_logs_insert_owner ON public.weight_logs;
CREATE POLICY weight_logs_insert_owner
ON public.weight_logs
FOR INSERT TO authenticated
WITH CHECK (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(patient_id)
);

DROP POLICY IF EXISTS weight_logs_update_owner ON public.weight_logs;
CREATE POLICY weight_logs_update_owner
ON public.weight_logs
FOR UPDATE TO authenticated
USING (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(patient_id)
)
WITH CHECK (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(patient_id)
);

DROP POLICY IF EXISTS weight_logs_delete_owner ON public.weight_logs;
CREATE POLICY weight_logs_delete_owner
ON public.weight_logs
FOR DELETE TO authenticated
USING (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND NOT private.is_patient_followup_expired(patient_id)
);

DROP POLICY IF EXISTS nutrition_support_days_insert_owner ON public.nutrition_support_days;
CREATE POLICY nutrition_support_days_insert_owner
ON public.nutrition_support_days
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND public.has_feature((SELECT auth.uid()), 'nutrition_support')
  AND NOT private.is_patient_followup_expired(patient_id)
);

DROP POLICY IF EXISTS nutrition_support_days_update_owner ON public.nutrition_support_days;
CREATE POLICY nutrition_support_days_update_owner
ON public.nutrition_support_days
FOR UPDATE TO authenticated
USING (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND public.has_feature((SELECT auth.uid()), 'nutrition_support')
  AND NOT private.is_patient_followup_expired(patient_id)
)
WITH CHECK (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND public.has_feature((SELECT auth.uid()), 'nutrition_support')
  AND NOT private.is_patient_followup_expired(patient_id)
);

DROP POLICY IF EXISTS nutrition_support_days_delete_owner ON public.nutrition_support_days;
CREATE POLICY nutrition_support_days_delete_owner
ON public.nutrition_support_days
FOR DELETE TO authenticated
USING (
  private.is_patient_workspace_owner(patient_id, (SELECT auth.uid()))
  AND public.has_active_subscription((SELECT auth.uid()))
  AND public.has_feature((SELECT auth.uid()), 'nutrition_support')
  AND NOT private.is_patient_followup_expired(patient_id)
);

-- The invitation table is intentionally accessible only through the two checked SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS patient_invitations_deny_direct_access ON public.patient_invitations;
CREATE POLICY patient_invitations_deny_direct_access
ON public.patient_invitations
FOR ALL TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE INDEX IF NOT EXISTS notifications_patient_id_idx
  ON public.notifications (patient_id);
CREATE INDEX IF NOT EXISTS patient_invitations_created_by_idx
  ON public.patient_invitations (created_by);
CREATE INDEX IF NOT EXISTS patient_plan_publications_published_by_idx
  ON public.patient_plan_publications (published_by);
CREATE INDEX IF NOT EXISTS weight_logs_created_by_idx
  ON public.weight_logs (created_by);
