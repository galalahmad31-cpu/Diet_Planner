# Security Phase 1 — Supabase Hardening

Status: review branch only. No production database changes have been applied.

## Environment guardrail
- Production project currently connected: `zwxnmnfoknfbzvptnpmv` (Diet planner).
- Do not run DDL or change Auth settings on this project during this phase.
- Create/use a separate free Supabase DEV project before applying security migrations. Copy schema, policies, functions, triggers, indexes and non-sensitive seed data only; do not copy real patient/user data.

## Confirmed observations (2026-10-19)
1. Security Advisor reports 12 authenticated-callable `SECURITY DEFINER` functions:
   - `admin_set_profile_role(uuid,text)`
   - `can_access(text,text)`
   - `can_add_patient(uuid)`
   - `cancel_pending_subscription(uuid)`
   - `create_subscription(uuid,text,text,text,uuid)`
   - `finish_subscription_audit(uuid,boolean,text)`
   - `get_access_status()`
   - `get_page_access(text)`
   - `has_active_subscription(uuid)`
   - `has_feature(uuid,text)`
   - `is_admin()`
   - `start_subscription_audit(uuid,text)`
2. These functions currently have an empty `search_path`, which is good hardening. The advisor finding is not by itself proof of a vulnerability: several are intentionally exposed RPCs. Each needs an authorization/input review and an explicit EXECUTE decision before changing grants.
3. `public.trial_claims` has RLS enabled and no direct policies. The current table grants inspected for `anon`, `authenticated`, and `PUBLIC` are absent; `service_role` and `postgres` have privileges. This appears intentionally RPC-only, but needs regression testing of trial creation and duplicate-trial prevention.
4. `patients` policies scope SELECT and DELETE by owner (or admin), INSERT checks owner + patient quota + subscription_id, and UPDATE checks owner + active subscription. The database triggers and child-table policies must be reviewed alongside these policies.
5. `profiles` has a self-update policy that constrains the role to the existing role, and role changes use `admin_set_profile_role`. Verify that self-promotion fails both through direct UPDATE and RPC.
6. Supabase Auth leaked-password protection is disabled; this is a dashboard Auth setting, not a SQL migration.

## Safe implementation sequence
- [ ] Establish a separate DEV Supabase project; no production DDL.
- [ ] Inventory all table grants and RLS policies, including child tables and Storage.
- [ ] Map every RPC to frontend call sites before changing EXECUTE grants.
- [ ] Add automated negative tests: user A cannot read/update/delete user B's patient, visits, plans, finance rows or uploaded proof; user cannot self-promote; expired/non-subscribed user cannot perform protected writes; duplicate free trial is rejected.
- [ ] On DEV, apply the smallest reviewed migration and run positive + negative regression tests.
- [ ] Enable leaked-password protection in DEV Auth settings and test password sign-in/reset flows.
- [ ] Re-run Security Advisor and review residual warnings. Only then prepare a production migration for explicit approval.

## Read-only diagnostic SQL
Run only for audit/reporting. These statements do not mutate data.

```sql
-- RLS state and policy count for public tables
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.polname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by 1,2,3
order by 2;

-- SECURITY DEFINER function ownership, search_path and grants
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, '; '), '') as function_config,
       coalesce(array_to_string(p.proacl, ', '), '(default ACL)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- Policies for sensitive tables
select tablename, policyname, cmd, roles,
       qual as using_expression,
       with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles','patients','patient_visits','nutrition_plans',
    'plan_days','plan_meals','plan_items','patient_finances',
    'subscriptions','subscription_plans','trial_claims'
  )
order by tablename, policyname;
```

## Important
Do not apply blanket `REVOKE EXECUTE` to all `SECURITY DEFINER` functions. That could break sign-in routing, subscription requests, access checks or admin workflows. Revoke only after mapping each function to its intended callers and preserving required functionality.
