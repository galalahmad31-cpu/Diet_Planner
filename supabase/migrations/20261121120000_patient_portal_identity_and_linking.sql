-- Patient portal identity foundation.
-- Adds a secure account-to-existing-patient link without duplicating clinical records.
-- Invitations use high-entropy UUIDv4 tokens; the invitation table is not directly
-- readable or writable by API roles. Tokens are returned once by a restricted RPC.

begin;

create table public.patient_accounts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default now()
);

create index patient_accounts_user_status_idx
  on public.patient_accounts (user_id, status);

create table public.patient_care_team (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete restrict,
  relationship_role text not null default 'primary'
    check (relationship_role in ('primary', 'collaborator')),
  status text not null default 'active'
    check (status in ('active', 'ended', 'revoked')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint patient_care_team_dates_check
    check (ended_at is null or ended_at >= started_at),
  constraint patient_care_team_unique_member
    unique (patient_id, professional_id)
);

create index patient_care_team_professional_status_idx
  on public.patient_care_team (professional_id, status);
create index patient_care_team_patient_status_idx
  on public.patient_care_team (patient_id, status);

create table public.patient_invitations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token uuid not null unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint patient_invitations_terminal_state_check
    check (not (accepted_at is not null and revoked_at is not null))
);

create index patient_invitations_patient_created_idx
  on public.patient_invitations (patient_id, created_at desc);

alter table public.patient_accounts enable row level security;
alter table public.patient_care_team enable row level security;
alter table public.patient_invitations enable row level security;

revoke all on public.patient_accounts from anon, authenticated;
revoke all on public.patient_care_team from anon, authenticated;
revoke all on public.patient_invitations from anon, authenticated;

grant select on public.patient_accounts to authenticated;
grant select on public.patient_care_team to authenticated;

create policy patient_accounts_select_self
  on public.patient_accounts
  for select to authenticated
  using (user_id = (select auth.uid()) and status = 'active');

create policy patient_care_team_select_patient_or_professional
  on public.patient_care_team
  for select to authenticated
  using (
    professional_id = (select auth.uid())
    or exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patient_care_team.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

-- A patient can see their own existing patient row; no clinical data is copied.
create policy patients_select_linked_patient
  on public.patients
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patients.id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

-- Preserve the existing subscription gate for workspace users, while allowing
-- the linked patient to reach only their own row.
drop policy if exists subscription_required_for_workspace_reads on public.patients;
create policy subscription_required_for_workspace_reads
  on public.patients
  as restrictive
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patients.id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

create policy weight_logs_select_linked_patient
  on public.weight_logs
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = weight_logs.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

create policy weight_logs_insert_linked_patient
  on public.weight_logs
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = weight_logs.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

drop policy if exists subscription_required_for_workspace_reads on public.weight_logs;
create policy subscription_required_for_workspace_reads
  on public.weight_logs
  as restrictive
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = weight_logs.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
  );

create or replace function public.create_patient_invitation(p_patient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.user_id = v_uid
  ) and not public.is_admin() then
    raise exception 'Patient record not owned by caller' using errcode = '42501';
  end if;

  if not public.is_admin()
     and not public.has_active_subscription(v_uid) then
    raise exception 'Active professional subscription required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.patient_accounts pa
    where pa.patient_id = p_patient_id
      and pa.status = 'active'
  ) then
    raise exception 'Patient record is already linked to an account'
      using errcode = '23505';
  end if;

  insert into public.patient_invitations (patient_id, created_by, token)
  values (p_patient_id, v_uid, v_token);

  return v_token;
end;
$$;

create or replace function public.accept_patient_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
  v_professional_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select i.patient_id, p.user_id
    into v_patient_id, v_professional_id
  from public.patient_invitations i
  join public.patients p on p.id = i.patient_id
  where i.token = p_token
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  for update of i;

  if v_patient_id is null then
    raise exception 'Invitation is invalid, expired, or already used'
      using errcode = '22023';
  end if;

  insert into public.patient_accounts (patient_id, user_id)
  values (v_patient_id, v_uid);

  insert into public.patient_care_team (
    patient_id, professional_id, relationship_role, status
  )
  values (v_patient_id, v_professional_id, 'primary', 'active')
  on conflict (patient_id, professional_id)
  do update set status = 'active', ended_at = null;

  update public.patient_invitations
  set accepted_at = now()
  where token = p_token;

  return v_patient_id;
exception
  when unique_violation then
    raise exception 'This account or patient record is already linked'
      using errcode = '23505';
end;
$$;

revoke all on function public.create_patient_invitation(uuid) from public, anon;
revoke all on function public.accept_patient_invitation(uuid) from public, anon;
grant execute on function public.create_patient_invitation(uuid) to authenticated;
grant execute on function public.accept_patient_invitation(uuid) to authenticated;

comment on table public.patient_accounts is
  'Maps one authenticated patient account to one existing clinical patient record; no duplicate clinical profile.';
comment on table public.patient_care_team is
  'Explicit patient-professional relationship records. Access remains governed by table-specific RLS policies.';
comment on table public.patient_invitations is
  'Single-use, expiring patient-link invitations. API roles have no direct table access.';
comment on function public.create_patient_invitation(uuid) is
  'Creates a 24-hour single-use patient linking token for a record owned by the caller.';
comment on function public.accept_patient_invitation(uuid) is
  'Atomically links the authenticated patient account to the existing patient record and records the primary professional relationship.';


-- Explicit publication boundary: patients can read only plans the professional
-- has intentionally published. Drafts remain private to the professional.
create table public.patient_plan_publications (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.nutrition_plans(id) on delete cascade,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint patient_plan_publications_state_check
    check (revoked_at is null or revoked_at >= published_at)
);

alter table public.patient_plan_publications enable row level security;
revoke all on public.patient_plan_publications from anon, authenticated;
grant select on public.patient_plan_publications to authenticated;

create policy patient_plan_publications_select_linked_patient_or_owner
  on public.patient_plan_publications for select to authenticated
  using (
    revoked_at is null and (
      published_by = (select auth.uid())
      or exists (
        select 1 from public.nutrition_plans np
        join public.patient_accounts pa on pa.patient_id = np.patient_id
        where np.id = patient_plan_publications.plan_id
          and pa.user_id = (select auth.uid()) and pa.status = 'active'
      )
    )
  );

create or replace function public.publish_patient_nutrition_plan(p_plan_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.nutrition_plans np
    join public.patients p on p.id = np.patient_id
    where np.id = p_plan_id and p.user_id = v_uid
  ) and not public.is_admin() then
    raise exception 'Plan is not owned by caller' using errcode = '42501';
  end if;
  if not public.is_admin() and not public.has_active_subscription(v_uid) then
    raise exception 'Active professional subscription required' using errcode = '42501';
  end if;
  insert into public.patient_plan_publications (plan_id, published_by)
  values (p_plan_id, v_uid)
  on conflict (plan_id) do update
    set published_by = excluded.published_by,
        published_at = now(), revoked_at = null;
end;
$;

create or replace function public.revoke_patient_nutrition_plan(p_plan_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.patient_plan_publications pp
  set revoked_at = now()
  from public.nutrition_plans np
  join public.patients p on p.id = np.patient_id
  where pp.plan_id = np.id and np.id = p_plan_id
    and (p.user_id = v_uid or public.is_admin())
    and pp.revoked_at is null;
  if not found then
    raise exception 'Published plan not found or caller not authorized'
      using errcode = '42501';
  end if;
end;
$;

revoke all on function public.publish_patient_nutrition_plan(uuid) from public, anon;
revoke all on function public.revoke_patient_nutrition_plan(uuid) from public, anon;
grant execute on function public.publish_patient_nutrition_plan(uuid) to authenticated;
grant execute on function public.revoke_patient_nutrition_plan(uuid) to authenticated;

create policy nutrition_plans_select_published_patient on public.nutrition_plans
  for select to authenticated using (
    exists (
      select 1 from public.patient_plan_publications pp
      join public.patient_accounts pa on pa.patient_id = nutrition_plans.patient_id
      where pp.plan_id = nutrition_plans.id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );
create policy plan_days_select_published_patient on public.plan_days
  for select to authenticated using (
    exists (
      select 1 from public.nutrition_plans np
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where np.id = plan_days.plan_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );
create policy plan_meals_select_published_patient on public.plan_meals
  for select to authenticated using (
    exists (
      select 1 from public.plan_days pd
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pd.id = plan_meals.day_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );
create policy plan_items_select_published_patient on public.plan_items
  for select to authenticated using (
    exists (
      select 1 from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pm.id = plan_items.meal_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );

-- Preserve professional subscription gating while allowing a linked patient
-- to read only a currently published plan and its child rows.
drop policy if exists subscription_required_for_workspace_reads on public.nutrition_plans;
create policy subscription_required_for_workspace_reads on public.nutrition_plans
  as restrictive for select to authenticated using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1 from public.patient_plan_publications pp
      join public.patient_accounts pa on pa.patient_id = nutrition_plans.patient_id
      where pp.plan_id = nutrition_plans.id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );

drop policy if exists subscription_required_for_workspace_reads on public.plan_days;
create policy subscription_required_for_workspace_reads on public.plan_days
  as restrictive for select to authenticated using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1 from public.nutrition_plans np
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where np.id = plan_days.plan_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );

drop policy if exists subscription_required_for_workspace_reads on public.plan_meals;
create policy subscription_required_for_workspace_reads on public.plan_meals
  as restrictive for select to authenticated using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1 from public.plan_days pd
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pd.id = plan_meals.day_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );

drop policy if exists subscription_required_for_workspace_reads on public.plan_items;
create policy subscription_required_for_workspace_reads on public.plan_items
  as restrictive for select to authenticated using (
    (select public.is_admin())
    or (select public.has_active_subscription((select auth.uid())))
    or exists (
      select 1 from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      join public.nutrition_plans np on np.id = pd.plan_id
      join public.patient_plan_publications pp on pp.plan_id = np.id
      join public.patient_accounts pa on pa.patient_id = np.patient_id
      where pm.id = plan_items.meal_id and pp.revoked_at is null
        and pa.user_id = (select auth.uid()) and pa.status = 'active'
    )
  );

comment on table public.patient_plan_publications is
  'Explicit publish/revoke boundary for patient-visible nutrition plans; drafts are not visible to patients.';

commit;
