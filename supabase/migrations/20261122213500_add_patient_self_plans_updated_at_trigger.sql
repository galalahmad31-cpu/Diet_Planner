drop trigger if exists patient_self_plans_set_updated_at on public.patient_self_plans;
create trigger patient_self_plans_set_updated_at
before update on public.patient_self_plans
for each row execute function public.set_updated_at();
