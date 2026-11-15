alter table public.weight_logs
  add column if not exists waist_cm numeric(5,1),
  add column if not exists hip_cm numeric(5,1),
  add column if not exists diet_adherence text;

alter table public.weight_logs
  add constraint weight_logs_diet_adherence_check
  check (diet_adherence is null or diet_adherence in ('excellent','good','fair','poor'));
