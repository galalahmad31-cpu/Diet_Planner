-- Consolidate overlapping SELECT policies for authenticated users.
-- Anonymous/public visibility policies remain unchanged; authenticated users retain
-- the union of public-visible rows and administrator-only rows.
DROP POLICY IF EXISTS "Admins can read all announcements" ON public.announcements;
CREATE POLICY "announcements_authenticated_read_visible_or_admin"
ON public.announcements
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_admin())
  OR (
    is_active = true
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  )
);

DROP POLICY IF EXISTS articles_admin_select_all ON public.articles;
CREATE POLICY articles_authenticated_read_public_or_admin
ON public.articles
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_admin())
  OR visibility = 'public'
);

DROP POLICY IF EXISTS books_admin_read_all ON public.books;
CREATE POLICY books_authenticated_read_published_or_admin
ON public.books
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_admin())
  OR status = 'published'
);

DROP POLICY IF EXISTS "Admins can read all job posts" ON public.job_posts;
CREATE POLICY job_posts_authenticated_read_published_or_admin
ON public.job_posts
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_admin())
  OR (
    status = 'published'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
  )
);
