alter table public.job_posts
  alter column location_city set not null;

alter table public.job_posts
  add constraint job_posts_location_city_check
  check (char_length(btrim(location_city)) between 2 and 120);
