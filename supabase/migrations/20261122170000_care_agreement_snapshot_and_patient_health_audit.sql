-- Care relationship foundation: structured direct-payment agreements and patient audit trail.
-- Reuses professional_connection_requests and existing patient records; no parallel relationship tables.

alter table public.professional_connection_requests
  add column if not exists agreement_service_title text,
  add column if not exists agreement_service_description text,
  add column if not exists agreement_amount numeric(12,2),
  add column if not exists agreement_currency text not null default 'EGP',
  add column if not exists agreement_duration_days integer,
  add column if not exists agreement_start_date date,
  add column if not exists agreement_end_date date,
  add column if not exists agreement_terms text,
  add column if not exists agreement_payment_method text not null default 'direct',
  add column if not exists agreement_version integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.professional_connection_requests'::regclass and conname='professional_connection_agreement_amount_nonnegative') then
    alter table public.professional_connection_requests add constraint professional_connection_agreement_amount_nonnegative check (agreement_amount is null or agreement_amount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.professional_connection_requests'::regclass and conname='professional_connection_agreement_duration_positive') then
    alter table public.professional_connection_requests add constraint professional_connection_agreement_duration_positive check (agreement_duration_days is null or agreement_duration_days > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.professional_connection_requests'::regclass and conname='professional_connection_agreement_dates_valid') then
    alter table public.professional_connection_requests add constraint professional_connection_agreement_dates_valid check (agreement_start_date is null or agreement_end_date is null or agreement_end_date >= agreement_start_date) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.professional_connection_requests'::regclass and conname='professional_connection_agreement_payment_direct') then
    alter table public.professional_connection_requests add constraint professional_connection_agreement_payment_direct check (agreement_payment_method = 'direct') not valid;
  end if;
end $$;

create table if not exists public.patient_health_audit (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('patient','professional','admin')),
  operation text not null check (operation in ('UPDATE')),
  changed_fields text[] not null,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists patient_health_audit_patient_created_idx
  on public.patient_health_audit(patient_id, created_at desc);

alter table public.patient_health_audit enable row level security;

drop policy if exists patient_health_audit_read_participants on public.patient_health_audit;
create policy patient_health_audit_read_participants
on public.patient_health_audit
for select to authenticated
using (
  exists (
    select 1 from public.patients p
    where p.id = patient_health_audit.patient_id
      and (
        p.user_id = (select auth.uid())
        or (select is_admin())
        or exists (
          select 1 from public.patient_care_team pct
          where pct.patient_id = p.id
            and pct.professional_id = (select auth.uid())
            and pct.status = 'active'
        )
      )
  )
);

revoke insert, update, delete on public.patient_health_audit from anon, authenticated;

create or replace function private.capture_patient_health_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed text[] := array[]::text[];
  v_key text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if v_actor is null then return new; end if;

  for v_key in select jsonb_object_keys(v_new)
  loop
    if v_key not in ('updated_at') and (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := array_append(v_changed, v_key);
      v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;

  if cardinality(v_changed) = 0 then return new; end if;

  if (select is_admin()) then v_role := 'admin';
  elsif old.user_id = v_actor then v_role := 'patient';
  else v_role := 'professional';
  end if;

  insert into public.patient_health_audit(
    patient_id, actor_id, actor_role, operation, changed_fields, before_values, after_values
  ) values (new.id, v_actor, v_role, 'UPDATE', v_changed, v_before, v_after);

  return new;
end;
$function$;

drop trigger if exists patient_health_audit_capture on public.patients;
create trigger patient_health_audit_capture
after update on public.patients
for each row execute function private.capture_patient_health_audit();

comment on table public.patient_health_audit is
  'Immutable audit trail for patient profile row updates; visible to patient owner, active care-team professionals, and admins.';
comment on column public.professional_connection_requests.agreement_payment_method is
  'Payment is settled directly between patient and professional; the platform records confirmations only.';
