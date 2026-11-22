alter table public.about_sections
  add column if not exists audience text not null default 'both';

alter table public.about_sections
  drop constraint if exists about_sections_audience_check;

alter table public.about_sections
  add constraint about_sections_audience_check
  check (audience in ('patient', 'professional', 'both'));

update public.about_sections
set audience = case
  when id in (
    '19c04bbf-c35c-40f9-980f-e3c3d7703ec0',
    '678f0ffa-4f19-456a-9e60-f7083a0d5cfd',
    'ae9b197b-4194-48f8-8ad3-113b1a7df509',
    '28a89741-c116-4f82-9d58-97b61c951678',
    '2b754500-af10-4a77-b4e7-087495b64cc5',
    'd6c5a17d-9e81-4f86-91ff-6a6541ab03cc',
    'd64e7e1c-9f41-42f9-bc4e-f55689826dad',
    '11eb88cd-5ec0-4fdd-b421-9ceb7d71f863',
    'e1a977ce-8cff-4114-bc92-9df7e609e451'
  ) then 'professional'
  when id = '14c3252d-85a7-42a3-a59a-aa38b25ffb34' then 'patient'
  else 'both'
end
where audience = 'both';

create index if not exists about_sections_audience_order_idx
  on public.about_sections (audience, display_order, created_at);
