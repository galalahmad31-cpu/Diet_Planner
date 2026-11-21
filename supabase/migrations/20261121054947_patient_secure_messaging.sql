begin;

create table if not exists public.patient_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint patient_messages_distinct_participants check (sender_id <> recipient_id)
);

create index if not exists patient_messages_patient_created_idx
  on public.patient_messages (patient_id, created_at desc);
create index if not exists patient_messages_recipient_unread_idx
  on public.patient_messages (recipient_id, patient_id, created_at desc)
  where read_at is null;

alter table public.patient_messages enable row level security;
revoke all on table public.patient_messages from anon, authenticated, public;
grant select, insert on table public.patient_messages to authenticated;

drop policy if exists patient_messages_select_participants on public.patient_messages;
create policy patient_messages_select_participants
  on public.patient_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patient_messages.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
    or exists (
      select 1
      from public.patient_care_team pct
      where pct.patient_id = patient_messages.patient_id
        and pct.professional_id = (select auth.uid())
        and pct.status = 'active'
    )
  );

drop policy if exists patient_messages_insert_active_participants on public.patient_messages;
create policy patient_messages_insert_active_participants
  on public.patient_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_id <> recipient_id
    and (
      exists (
        select 1
        from public.patient_accounts pa
        join public.patient_care_team pct
          on pct.patient_id = pa.patient_id
        where pa.patient_id = patient_messages.patient_id
          and pa.user_id = patient_messages.sender_id
          and pa.status = 'active'
          and pct.professional_id = patient_messages.recipient_id
          and pct.status = 'active'
      )
      or exists (
        select 1
        from public.patient_care_team pct
        join public.patient_accounts pa
          on pa.patient_id = pct.patient_id
        where pct.patient_id = patient_messages.patient_id
          and pct.professional_id = patient_messages.sender_id
          and pct.status = 'active'
          and pa.user_id = patient_messages.recipient_id
          and pa.status = 'active'
      )
    )
  );

create or replace function public.mark_patient_messages_read(p_patient_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.patient_accounts pa
    where pa.patient_id = p_patient_id
      and pa.user_id = v_user_id
      and pa.status = 'active'
  ) and not exists (
    select 1
    from public.patient_care_team pct
    where pct.patient_id = p_patient_id
      and pct.professional_id = v_user_id
      and pct.status = 'active'
  ) then
    raise exception 'Not authorized for this patient conversation';
  end if;

  update public.patient_messages
  set read_at = now()
  where patient_id = p_patient_id
    and recipient_id = v_user_id
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_patient_messages_read(uuid) from public, anon;
grant execute on function public.mark_patient_messages_read(uuid) to authenticated;

drop policy if exists profiles_subscription_required_for_other_profiles on public.profiles;
create policy profiles_subscription_required_for_other_profiles
  on public.profiles
  as restrictive
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select is_admin())
    or (select has_active_subscription((select auth.uid())))
    or exists (
      select 1
      from public.patient_accounts pa
      join public.patient_care_team pct
        on pct.patient_id = pa.patient_id
      where pa.user_id = (select auth.uid())
        and pa.status = 'active'
        and pct.professional_id = profiles.id
        and pct.status = 'active'
    )
  );

drop policy if exists patient_accounts_select_self on public.patient_accounts;
create policy patient_accounts_select_self
  on public.patient_accounts
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and status = 'active')
    or exists (
      select 1
      from public.patient_care_team pct
      where pct.patient_id = patient_accounts.patient_id
        and pct.professional_id = (select auth.uid())
        and pct.status = 'active'
    )
  );

commit;
