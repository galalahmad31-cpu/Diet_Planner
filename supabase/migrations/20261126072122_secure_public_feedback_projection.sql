BEGIN;

-- Public feedback is intentionally visible to everyone, but only through a
-- narrow projection. The view now obeys the caller's privileges and RLS.
DROP VIEW IF EXISTS public.app_feedback_public;

-- Remove broad source-table access, then grant only the columns needed by
-- the public list and the feedback form.
REVOKE ALL PRIVILEGES ON TABLE public.app_feedback
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, rating, comment, display_name, created_at, updated_at)
  ON TABLE public.app_feedback TO anon, authenticated;

GRANT INSERT (user_id, rating, comment, display_name)
  ON TABLE public.app_feedback TO authenticated;

GRANT UPDATE (rating, comment)
  ON TABLE public.app_feedback TO authenticated;

GRANT DELETE ON TABLE public.app_feedback TO authenticated;

-- Public can read every review. Column privileges above prevent exposure of
-- user_id and any future private columns through direct table access.
DROP POLICY IF EXISTS "Public can read feedback" ON public.app_feedback;
DROP POLICY IF EXISTS "Public can read feedback projection" ON public.app_feedback;
CREATE POLICY "Public can read feedback projection"
  ON public.app_feedback
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE VIEW public.app_feedback_public
WITH (security_invoker = true)
AS
SELECT id, rating, comment, display_name, created_at, updated_at
FROM public.app_feedback;

REVOKE ALL PRIVILEGES ON TABLE public.app_feedback_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_feedback_public TO anon, authenticated;

-- The signed-in user retrieves only their own row through this narrowly scoped
-- function; user_id is never exposed by the public view or table grants.
CREATE OR REPLACE FUNCTION public.get_my_app_feedback()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'id', f.id,
    'rating', f.rating,
    'comment', f.comment,
    'display_name', f.display_name,
    'created_at', f.created_at,
    'updated_at', f.updated_at
  )
  FROM public.app_feedback AS f
  WHERE f.user_id = auth.uid()
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_my_app_feedback() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_app_feedback() TO authenticated;

COMMIT;