alter table public.announcements
  add column if not exists priority integer not null default 0;

update public.announcements
set priority = 100
where is_pinned = true and priority = 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.announcements'::regclass
      and conname = 'announcements_priority_range_check'
  ) then
    alter table public.announcements
      add constraint announcements_priority_range_check
      check (priority between 0 and 100);
  end if;
end
$$;

create index if not exists announcements_priority_schedule_idx
  on public.announcements (priority desc, starts_at desc, created_at desc);
