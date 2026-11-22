create table if not exists public.patient_self_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_name text not null default 'خطتي الغذائية',
  plan_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_self_plans_name_length check (char_length(btrim(plan_name)) between 1 and 160),
  constraint patient_self_plans_data_object check (jsonb_typeof(plan_data) = 'object')
);

create index if not exists patient_self_plans_owner_updated_idx
  on public.patient_self_plans (patient_id, updated_at desc);

alter table public.patient_self_plans enable row level security;

revoke all on public.patient_self_plans from anon, public;
grant select, insert, update, delete on public.patient_self_plans to authenticated;

drop policy if exists patient_self_plans_select_owner on public.patient_self_plans;
create policy patient_self_plans_select_owner
on public.patient_self_plans for select to authenticated
using (private.is_active_patient_account(patient_id, auth.uid()) and created_by = auth.uid());

drop policy if exists patient_self_plans_insert_owner on public.patient_self_plans;
create policy patient_self_plans_insert_owner
on public.patient_self_plans for insert to authenticated
with check (private.is_active_patient_account(patient_id, auth.uid()) and created_by = auth.uid());

drop policy if exists patient_self_plans_update_owner on public.patient_self_plans;
create policy patient_self_plans_update_owner
on public.patient_self_plans for update to authenticated
using (private.is_active_patient_account(patient_id, auth.uid()) and created_by = auth.uid())
with check (private.is_active_patient_account(patient_id, auth.uid()) and created_by = auth.uid());

drop policy if exists patient_self_plans_delete_owner on public.patient_self_plans
using (private.is_active_patient_account(patient_id, auth.uid()) and created_by = auth.uid());
