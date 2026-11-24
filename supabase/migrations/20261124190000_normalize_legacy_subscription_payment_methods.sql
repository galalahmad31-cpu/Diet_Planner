alter table public.subscription_plans
  add column if not exists payment_methods jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'subscription_plans_payment_methods_array_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_payment_methods_array_check
      check (jsonb_typeof(payment_methods) = 'array');
  end if;
end;
$$;

update public.subscription_plans
set payment_methods = jsonb_build_array(
  jsonb_build_object(
    'id', 'legacy-vodafone-instapay',
    'name', 'فودافون كاش أو InstaPay',
    'details', '01094199634',
    'instructions', 'مع إرسال صورة التحويل'
  )
)
where payment_methods @> '[{"id":"legacy"}]'::jsonb
  and payment_method ilike '%01094199634%';

comment on column public.subscription_plans.payment_methods is
  'Ordered payment methods for each subscription plan; each item contains id, name, details, and optional instructions.';
