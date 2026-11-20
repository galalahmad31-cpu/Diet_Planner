create table public.job_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  specialty text not null check (specialty in ('medicine','pharmacy','nursing','clinical_nutrition','laboratory','radiology','dentistry','physiotherapy','healthcare_management','other')),
  organization_name text not null check (char_length(btrim(organization_name)) between 2 and 180),
  location_city text,
  country_code text not null default 'EG',
  employment_type text not null check (employment_type in ('full_time','part_time','contract','temporary','internship','freelance')),
  workplace_type text not null default 'on_site' check (workplace_type in ('on_site','hybrid','remote')),
  description text not null check (char_length(btrim(description)) between 20 and 20000),
  requirements text,
  salary_min numeric(12,2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12,2) check (salary_max is null or salary_max >= 0),
  salary_currency text not null default 'EGP' check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period text check (salary_period is null or salary_period in ('hour','day','week','month','year')),
  application_url text,
  contact_email text,
  contact_phone text,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  published_at timestamptz,
  expires_at date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_posts_salary_range_check check (salary_min is null or salary_max is null or salary_max >= salary_min),
  constraint job_posts_application_contact_check check (
    nullif(btrim(application_url),'') is not null
    or nullif(btrim(contact_email),'') is not null
    or nullif(btrim(contact_phone),'') is not null
  ),
  constraint job_posts_application_url_check check (
    application_url is null or application_url ~* '^https?://'
  )
);
create index job_posts_public_listing_idx on public.job_posts (published_at desc, created_at desc) where status = 'published';
create index job_posts_specialty_idx on public.job_posts (specialty, published_at desc) where status = 'published';
create index job_posts_location_idx on public.job_posts (location_city) where status = 'published';
alter table public.job_posts enable row level security;
grant select on public.job_posts to anon, authenticated;
grant insert, update, delete on public.job_posts to authenticated;
create policy "Public can read published active job posts" on public.job_posts for select to anon, authenticated using (
  status = 'published' and published_at is not null and published_at <= now()
  and (expires_at is null or expires_at >= current_date)
);
create policy "Admins can read all job posts" on public.job_posts for select to authenticated using ((select public.is_admin()));
create policy "Admins can insert job posts" on public.job_posts for insert to authenticated with check (
  (select public.is_admin()) and created_by = (select auth.uid())
);
create policy "Admins can update job posts" on public.job_posts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete job posts" on public.job_posts for delete to authenticated using ((select public.is_admin()));
comment on table public.job_posts is 'Admin-managed public healthcare job listings, separate from application announcements.';
comment on column public.job_posts.specialty is 'Healthcare discipline category used for public filtering.';
comment on column public.job_posts.status is 'draft, published, or closed; only published and unexpired jobs are public.';
