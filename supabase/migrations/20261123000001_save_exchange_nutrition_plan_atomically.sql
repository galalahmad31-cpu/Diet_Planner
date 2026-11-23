create or replace function public.save_exchange_nutrition_plan(
  p_plan_id uuid,
  p_notes text,
  p_values jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_patient_id uuid;
  v_plan_name text;
  v_row record;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_plan_id is null then
    raise exception 'plan_id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_values, 'null'::jsonb)) <> 'array' then
    raise exception 'values must be a JSON array' using errcode = '22023';
  end if;

  select np.patient_id, np.plan_name
    into v_patient_id, v_plan_name
  from public.nutrition_plans np
  where np.id = p_plan_id
  for update;

  if v_patient_id is null then
    raise exception 'Nutrition plan not found' using errcode = 'P0002';
  end if;
  if coalesce(v_plan_name, '') not ilike '%البدائل%' then
    raise exception 'The requested plan is not an exchange-based plan' using errcode = '22023';
  end if;
  if private.is_expired_care_professional(v_patient_id) then
    raise exception 'care_agreement_expired_read_only' using errcode = '42501';
  end if;
  if not private.can_manage_patient_nutrition(v_patient_id) then
    raise exception 'patient_nutrition_management_denied' using errcode = '42501';
  end if;

  if jsonb_array_length(p_values) = 0 then
    raise exception 'At least one exchange row is required' using errcode = '22023';
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(p_values) as x(
      group_name text,
      subgroup_name text,
      exchange_count numeric,
      kcal numeric,
      carb numeric,
      protein numeric,
      fat numeric
    )
  loop
    if nullif(btrim(v_row.group_name), '') is null
       or v_row.exchange_count is null or v_row.exchange_count < 0
       or v_row.kcal is null or v_row.carb is null
       or v_row.protein is null or v_row.fat is null then
      raise exception 'Invalid exchange row payload' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_values) as e(value)
    group by btrim(e.value->>'group_name')
    having count(*) > 1
  ) then
    raise exception 'Duplicate exchange group names are not allowed' using errcode = '22023';
  end if;

  update public.nutrition_plans
  set notes = coalesce(p_notes, '')
  where id = p_plan_id;

  delete from public.exchange_values
  where plan_id = p_plan_id;

  insert into public.exchange_values (
    plan_id, group_name, subgroup_name, exchange_count, kcal, carb, protein, fat
  )
  select
    p_plan_id, x.group_name, x.subgroup_name, x.exchange_count,
    x.kcal, x.carb, x.protein, x.fat
  from jsonb_to_recordset(p_values) as x(
    group_name text,
    subgroup_name text,
    exchange_count numeric,
    kcal numeric,
    carb numeric,
    protein numeric,
    fat numeric
  );

  return true;
end;
$function$;

revoke all on function public.save_exchange_nutrition_plan(uuid, text, jsonb) from public, anon;
grant execute on function public.save_exchange_nutrition_plan(uuid, text, jsonb) to authenticated, service_role;
