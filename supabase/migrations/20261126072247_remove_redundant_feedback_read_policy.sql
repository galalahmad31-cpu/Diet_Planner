-- The public projection policy now intentionally permits all feedback rows
-- to be read through the restricted column grants. The old own/admin SELECT
-- policy is redundant and would only add overlapping policy logic.
DROP POLICY IF EXISTS "Users can view own feedback or admin can view all"
  ON public.app_feedback;
