create or replace function private.is_expired_care_professional(p_patient_id uuid)
returns boolean language sql stable security definer
set search_path='pg_catalog','public' set row_security='off'
as $function$
 select auth.uid() is not null and p_patient_id is not null and exists(
   select 1 from public.professional_connection_requests r
   where r.patient_id=p_patient_id and r.professional_id=auth.uid()
     and r.status='active' and r.agreement_end_date is not null and r.agreement_end_date<current_date
 );
$function$;

do $block$
declare t text; patient_expr text;
targets text[]:=array['patients','weight_logs','nutrition_plans','patient_appointments','patient_finances','nutrition_support_days'];
begin
 foreach t in array targets loop
  patient_expr:=case when t='patients' then 'id' else 'patient_id' end;
  execute format('drop policy if exists care_agreement_not_expired_insert on public.%I',t);
  execute format('drop policy if exists care_agreement_not_expired_update on public.%I',t);
  execute format('drop policy if exists care_agreement_not_expired_delete on public.%I',t);
  execute format('create policy care_agreement_not_expired_insert on public.%I as restrictive for insert to authenticated with check (not private.is_expired_care_professional(%I))',t,patient_expr);
  execute format('create policy care_agreement_not_expired_update on public.%I as restrictive for update to authenticated using (not private.is_expired_care_professional(%I)) with check (not private.is_expired_care_professional(%I))',t,patient_expr,patient_expr);
  execute format('create policy care_agreement_not_expired_delete on public.%I as restrictive for delete to authenticated using (not private.is_expired_care_professional(%I))',t,patient_expr);
 end loop;
end $block$;

drop policy if exists care_agreement_not_expired_insert on public.patient_plan_publications;
drop policy if exists care_agreement_not_expired_update on public.patient_plan_publications;
drop policy if exists care_agreement_not_expired_delete on public.patient_plan_publications;
create policy care_agreement_not_expired_insert on public.patient_plan_publications as restrictive for insert to authenticated with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_update on public.patient_plan_publications as restrictive for update to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id))) with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_delete on public.patient_plan_publications as restrictive for delete to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));

drop policy if exists care_agreement_not_expired_insert on public.plan_days;
drop policy if exists care_agreement_not_expired_update on public.plan_days;
drop policy if exists care_agreement_not_expired_delete on public.plan_days;
create policy care_agreement_not_expired_insert on public.plan_days as restrictive for insert to authenticated with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_update on public.plan_days as restrictive for update to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id))) with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_delete on public.plan_days as restrictive for delete to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));

drop policy if exists care_agreement_not_expired_insert on public.plan_meals;
drop policy if exists care_agreement_not_expired_update on public.plan_meals;
drop policy if exists care_agreement_not_expired_delete on public.plan_meals;
create policy care_agreement_not_expired_insert on public.plan_meals as restrictive for insert to authenticated with check (not exists(select 1 from public.plan_days pd join public.nutrition_plans np on np.id=pd.plan_id where pd.id=day_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_update on public.plan_meals as restrictive for update to authenticated using (not exists(select 1 from public.plan_days pd join public.nutrition_plans np on np.id=pd.plan_id where pd.id=day_id and private.is_expired_care_professional(np.patient_id))) with check (not exists(select 1 from public.plan_days pd join public.nutrition_plans np on np.id=pd.plan_id where pd.id=day_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_delete on public.plan_meals as restrictive for delete to authenticated using (not exists(select 1 from public.plan_days pd join public.nutrition_plans np on np.id=pd.plan_id where pd.id=day_id and private.is_expired_care_professional(np.patient_id)));

drop policy if exists care_agreement_not_expired_insert on public.plan_items;
drop policy if exists care_agreement_not_expired_update on public.plan_items;
drop policy if exists care_agreement_not_expired_delete on public.plan_items;
create policy care_agreement_not_expired_insert on public.plan_items as restrictive for insert to authenticated with check (not exists(select 1 from public.plan_meals pm join public.plan_days pd on pd.id=pm.day_id join public.nutrition_plans np on np.id=pd.plan_id where pm.id=meal_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_update on public.plan_items as restrictive for update to authenticated using (not exists(select 1 from public.plan_meals pm join public.plan_days pd on pd.id=pm.day_id join public.nutrition_plans np on np.id=pd.plan_id where pm.id=meal_id and private.is_expired_care_professional(np.patient_id))) with check (not exists(select 1 from public.plan_meals pm join public.plan_days pd on pd.id=pm.day_id join public.nutrition_plans np on np.id=pd.plan_id where pm.id=meal_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_delete on public.plan_items as restrictive for delete to authenticated using (not exists(select 1 from public.plan_meals pm join public.plan_days pd on pd.id=pm.day_id join public.nutrition_plans np on np.id=pd.plan_id where pm.id=meal_id and private.is_expired_care_professional(np.patient_id)));

drop policy if exists care_agreement_not_expired_insert on public.exchange_values;
drop policy if exists care_agreement_not_expired_update on public.exchange_values;
drop policy if exists care_agreement_not_expired_delete on public.exchange_values;
create policy care_agreement_not_expired_insert on public.exchange_values as restrictive for insert to authenticated with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_update on public.exchange_values as restrictive for update to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id))) with check (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));
create policy care_agreement_not_expired_delete on public.exchange_values as restrictive for delete to authenticated using (not exists(select 1 from public.nutrition_plans np where np.id=plan_id and private.is_expired_care_professional(np.patient_id)));

grant execute on function private.is_expired_care_professional(uuid) to authenticated;
revoke all on function private.is_expired_care_professional(uuid) from anon;