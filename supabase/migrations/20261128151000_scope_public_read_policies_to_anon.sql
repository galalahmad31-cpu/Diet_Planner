-- Keep public visibility policies for anonymous visitors only.
-- Authenticated users use the consolidated role-aware policies created previously.
DROP POLICY IF EXISTS "Public can read active announcements" ON public.announcements;
CREATE POLICY "Public can read active announcements"
ON public.announcements FOR SELECT TO anon
USING (
  is_active = true
  AND starts_at <= now()
  AND (expires_at IS NULL OR expires_at > now())
);

DROP POLICY IF EXISTS articles_public_read_published ON public.articles;
CREATE POLICY articles_public_read_published
ON public.articles FOR SELECT TO anon
USING (visibility = 'public');

DROP POLICY IF EXISTS books_public_read_published ON public.books;
CREATE POLICY books_public_read_published
ON public.books FOR SELECT TO anon
USING (status = 'published');

DROP POLICY IF EXISTS "Public can read published active job posts" ON public.job_posts;
CREATE POLICY "Public can read published active job posts"
ON public.job_posts FOR SELECT TO anon
USING (
  status = 'published'
  AND published_at IS NOT NULL
  AND published_at <= now()
  AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
);
