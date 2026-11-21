create or replace function public.save_nutrition_plan_day(
  p_plan jsonb,
  p_day jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_is_admin boolean := (select public.is_admin());
  v_patient_id uuid;
  v_plan_id uuid;
  v_requested_plan_id uuid;
  v_day_id uuid;
  v_requested_day_id uuid;
  v_plan_name text;
  v_day_number integer;
  v_meal jsonb;
  v_meal_id uuid;
  v_meal_number integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_plan, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_day, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid plan/day payload';
  end if;

  v_patient_id := nullif(p_plan->>'patient_id', '')::uuid;
  v_requested_plan_id := nullif(p_plan->>'id', '')::uuid;
  v_requested_day_id := case
    when coalesce(p_day->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (p_day->>'id')::uuid
    else null
  end;
  v_plan_name := coalesce(nullif(btrim(p_plan->>'plan_name'), ''), 'الخطة الغذائية');

  if v_patient_id is null then raise exception 'patient_id is required'; end if;

  if not v_is_admin then
    if not (select public.has_active_subscription(v_user_id)) then
      raise exception 'An active paid subscription is required';
    end if;
    if not exists (
      select 1 from public.patients p
      where p.id = v_patient_id and p.user_id = v_user_id
    ) then
      raise exception 'Patient access denied';
    end if;
  elsif not exists (
    select 1 from public.patients p where p.id = v_patient_id
  ) then
    raise exception 'Patient not found';
  end if;

  -- Serialize only operations that allocate a new plan or day number.
  -- Editing an already persisted day is protected by that day's row lock below.
  if v_requested_plan_id is null or v_requested_day_id is null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_patient_id::text || '|' || v_plan_name, 0)
    );
  end if;

  if v_requested_plan_id is not null then
    select np.id into v_plan_id
    from public.nutrition_plans np
    where np.id = v_requested_plan_id
      and np.patient_id = v_patient_id
      and np.plan_name is not distinct from v_plan_name;

    if v_plan_id is null then
      raise exception 'Plan id does not match the requested patient/plan';
    end if;
  else
    v_plan_id := pg_catalog.gen_random_uuid();
    insert into public.nutrition_plans(id, patient_id, plan_name, start_date, target_fluid, notes)
    values (
      v_plan_id,
      v_patient_id,
      v_plan_name,
      nullif(p_plan->>'start_date', '')::date,
      nullif(p_plan->>'target_fluid', '')::numeric,
      nullif(p_plan->>'notes', '')
    );
  end if;

  if v_requested_day_id is not null then
    select pd.id, pd.day_number
      into v_day_id, v_day_number
    from public.plan_days pd
    where pd.id = v_requested_day_id
      and pd.plan_id = v_plan_id
    for update;

    if v_day_id is null then
      raise exception 'Day id does not belong to the requested plan';
    end if;

    update public.plan_days
    set day_name = coalesce(nullif(btrim(p_day->>'title'), ''), 'اليوم ' || v_day_number),
        notes = coalesce(p_day->>'notes', '')
    where id = v_day_id;
  else
    select coalesce(max(pd.day_number), 0) + 1
      into v_day_number
    from public.plan_days pd
    where pd.plan_id = v_plan_id;

    insert into public.plan_days(plan_id, day_number, day_name, notes)
    values (
      v_plan_id,
      v_day_number,
      coalesce(nullif(btrim(p_day->>'title'), ''), 'اليوم ' || v_day_number),
      coalesce(p_day->>'notes', '')
    )
    returning id into v_day_id;

    -- Only adding a day updates plan recency; editing a day must not lock
    -- the shared nutrition_plans row and serialize other day saves.
    update public.nutrition_plans
    set updated_at = pg_catalog.now()
    where id = v_plan_id;
  end if;

  delete from public.plan_meals where day_id = v_day_id;

  for v_meal in
    select value
    from pg_catalog.jsonb_array_elements(
      case when jsonb_typeof(p_day->'meals') = 'array'
        then p_day->'meals' else '[]'::jsonb end
    )
  loop
    v_meal_number := v_meal_number + 1;

    insert into public.plan_meals(day_id, meal_name, meal_order)
    values (
      v_day_id,
      coalesce(nullif(btrim(v_meal->>'name'), ''), 'وجبة ' || v_meal_number),
      v_meal_number
    )
    returning id into v_meal_id;

    -- Insert all items for this meal in one set-based statement.
    insert into public.plan_items(
      id, meal_id, food_id, quantity_g, household_measure, frequency, notes
    )
    select
      pg_catalog.gen_random_uuid()::text,
      v_meal_id,
      nullif(item.value->>'foodId', ''),
      coalesce(nullif(item.value->>'grams', '')::numeric, 0),
      nullif(item.value->>'household_measure', ''),
      nullif(item.value->>'repeat', ''),
      nullif(item.value->>'notes', '')
    from pg_catalog.jsonb_array_elements(
      case when jsonb_typeof(v_meal->'items') = 'array'
        then v_meal->'items' else '[]'::jsonb end
    ) as item(value)
    where nullif(item.value->>'foodId', '') is not null;
  end loop;

  return pg_catalog.jsonb_build_object(
    'plan_id', v_plan_id,
    'day_id', v_day_id,
    'day_number', v_day_number
  );
end;
$function$;

revoke all on function public.save_nutrition_plan_day(jsonb,jsonb) from public, anon;
grant execute on function public.save_nutrition_plan_day(jsonb,jsonb) to authenticated;
