CREATE OR REPLACE FUNCTION public.save_diet_template(p_diet_id uuid, p_payload jsonb, p_day jsonb, p_meals jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_diet_id uuid;
  v_day_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_diet_id is not null then
    update public.diet_templates
    set
      name = p_payload->>'name',
      description = nullif(p_payload->>'description',''),
      notes = nullif(p_payload->>'notes',''),
      visibility = coalesce(nullif(p_payload->>'visibility',''),'private'),
      required_feature = nullif(p_payload->>'required_feature',''),
      publisher_name = nullif(p_payload->>'publisher_name',''),
      target_calories = nullif(p_payload->>'target_calories','')::numeric,
      target_protein = nullif(p_payload->>'target_protein','')::numeric,
      target_carb = nullif(p_payload->>'target_carb','')::numeric,
      target_fat = nullif(p_payload->>'target_fat','')::numeric,
      target_fluid = nullif(p_payload->>'target_fluid','')::numeric,
      goal = nullif(p_payload->>'goal','')
    where id = p_diet_id
      and (created_by = auth.uid() or public.is_admin())
    returning id into v_diet_id;

    if v_diet_id is null then
      raise exception 'Diet not found or access denied';
    end if;

    delete from public.diet_template_days
    where diet_id = v_diet_id;
  else
    insert into public.diet_templates (
      created_by, name, description, notes, visibility, required_feature,
      publisher_name, target_calories, target_protein, target_carb,
      target_fat, target_fluid, goal
    )
    values (
      auth.uid(),
      p_payload->>'name',
      nullif(p_payload->>'description',''),
      nullif(p_payload->>'notes',''),
      coalesce(nullif(p_payload->>'visibility',''),'private'),
      nullif(p_payload->>'required_feature',''),
      nullif(p_payload->>'publisher_name',''),
      nullif(p_payload->>'target_calories','')::numeric,
      nullif(p_payload->>'target_protein','')::numeric,
      nullif(p_payload->>'target_carb','')::numeric,
      nullif(p_payload->>'target_fat','')::numeric,
      nullif(p_payload->>'target_fluid','')::numeric,
      nullif(p_payload->>'goal','')
    )
    returning id into v_diet_id;
  end if;

  v_day_id := (p_day->>'id')::uuid;

  insert into public.diet_template_days(id,diet_id,day_number,day_name)
  values (
    v_day_id,
    v_diet_id,
    coalesce((p_day->>'day_number')::integer,1),
    nullif(p_day->>'day_name','')
  );

  insert into public.diet_template_meals (id,day_id,meal_name,meal_order)
  select m.id,v_day_id,coalesce(m.meal_name,'وجبة '||m.meal_order::text),m.meal_order
  from jsonb_to_recordset(coalesce(p_meals,'[]'::jsonb))
    as m(id uuid,meal_name text,meal_order integer);

  insert into public.diet_template_items (
    id,meal_id,food_id,quantity_g,household_measure,notes,item_order
  )
  select i.id,i.meal_id,i.food_id,coalesce(i.quantity_g,0),i.household_measure,
         i.notes,coalesce(i.item_order,0)
  from jsonb_to_recordset(coalesce(p_items,'[]'::jsonb))
    as i(id uuid,meal_id uuid,food_id text,quantity_g numeric,
         household_measure text,notes text,item_order integer);

  return v_diet_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.save_nutrition_plan(p_plan jsonb, p_days jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_is_admin boolean := (select public.is_admin());
  v_patient_id uuid;
  v_plan_id uuid;
  v_requested_id uuid;
  v_plan_name text;
  v_day jsonb;
  v_meal jsonb;
  v_item jsonb;
  v_day_id uuid;
  v_meal_id uuid;
  v_day_number integer := 0;
  v_meal_number integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_plan,'{}'::jsonb)) <> 'object' then raise exception 'Invalid plan payload'; end if;
  if jsonb_typeof(coalesce(p_days,'[]'::jsonb)) <> 'array' then raise exception 'Invalid days payload'; end if;

  v_patient_id := nullif(p_plan->>'patient_id','')::uuid;
  v_requested_id := nullif(p_plan->>'id','')::uuid;
  v_plan_name := coalesce(nullif(btrim(p_plan->>'plan_name'),''),'الخطة الغذائية');

  if v_patient_id is null then raise exception 'patient_id is required'; end if;

  if not v_is_admin then
    if not (select public.has_active_subscription(v_user_id)) then
      raise exception 'An active paid subscription is required';
    end if;
    if not exists (select 1 from public.patients p where p.id=v_patient_id and p.user_id=v_user_id) then
      raise exception 'Patient access denied';
    end if;
  else
    if not exists (select 1 from public.patients p where p.id=v_patient_id) then
      raise exception 'Patient not found';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_patient_id::text || '|' || v_plan_name,0)
  );

  if v_requested_id is not null then
    select np.id into v_plan_id
    from public.nutrition_plans np
    where np.id=v_requested_id
      and np.patient_id=v_patient_id
      and np.plan_name is not distinct from v_plan_name
    for update;
    if v_plan_id is null then raise exception 'Plan id does not match the requested patient/plan'; end if;
  else
    v_plan_id:=pg_catalog.gen_random_uuid();
  end if;

  if not exists (select 1 from public.nutrition_plans np where np.id=v_plan_id) then
    insert into public.nutrition_plans (id,patient_id,plan_name,start_date,target_fluid,notes)
    values (
      v_plan_id,v_patient_id,v_plan_name,
      nullif(p_plan->>'start_date','')::date,
      nullif(p_plan->>'target_fluid','')::numeric,
      nullif(p_plan->>'notes','')
    );
  else
    update public.nutrition_plans set
      patient_id=v_patient_id,
      plan_name=v_plan_name,
      start_date=nullif(p_plan->>'start_date','')::date,
      target_fluid=coalesce(nullif(p_plan->>'target_fluid','')::numeric,target_fluid),
      notes=nullif(p_plan->>'notes','')
    where id=v_plan_id;
  end if;

  delete from public.plan_days where plan_id=v_plan_id;
  for v_day in select value from pg_catalog.jsonb_array_elements(p_days) loop
    v_day_number:=v_day_number+1;
    insert into public.plan_days(id,plan_id,day_number,day_name,notes)
    values(pg_catalog.gen_random_uuid(),v_plan_id,v_day_number,
      coalesce(nullif(btrim(v_day->>'title'),''),'اليوم '||v_day_number),
      coalesce(v_day->>'notes',''))
    returning id into v_day_id;

    v_meal_number:=0;
    for v_meal in select value from pg_catalog.jsonb_array_elements(
      case when jsonb_typeof(v_day->'meals')='array' then v_day->'meals' else '[]'::jsonb end
    ) loop
      v_meal_number:=v_meal_number+1;
      insert into public.plan_meals(id,day_id,meal_name,meal_order)
      values(pg_catalog.gen_random_uuid(),v_day_id,
        coalesce(nullif(btrim(v_meal->>'name'),''),'وجبة '||v_meal_number),v_meal_number)
      returning id into v_meal_id;

      for v_item in select value from pg_catalog.jsonb_array_elements(
        case when jsonb_typeof(v_meal->'items')='array' then v_meal->'items' else '[]'::jsonb end
      ) loop
        if nullif(v_item->>'foodId','') is null then continue; end if;
        insert into public.plan_items(
          id,meal_id,food_id,item_name,quantity_g,household_measure,notes
        ) values(
          pg_catalog.gen_random_uuid(),v_meal_id,nullif(v_item->>'foodId',''),null,
          coalesce(nullif(v_item->>'grams','')::numeric,0),
          nullif(v_item->>'household_measure',''),
          nullif(v_item->>'notes','')
        );
      end loop;
    end loop;
  end loop;
  return v_plan_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.save_nutrition_plan_day(p_plan jsonb, p_day jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  v_user_id uuid := auth.uid();
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
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if jsonb_typeof(coalesce(p_plan, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_day, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid plan/day payload' using errcode = '22023';
  end if;

  v_patient_id := nullif(p_plan->>'patient_id', '')::uuid;
  v_requested_plan_id := nullif(p_plan->>'id', '')::uuid;
  v_requested_day_id := case
    when coalesce(p_day->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (p_day->>'id')::uuid
    else null
  end;
  v_plan_name := coalesce(nullif(btrim(p_plan->>'plan_name'), ''), 'الخطة الغذائية');

  if v_patient_id is null then
    raise exception 'patient_id is required' using errcode = '22023';
  end if;

  if private.is_patient_followup_expired(v_patient_id) then
    raise exception 'patient_followup_expired_read_only' using errcode = '42501';
  end if;

  if not private.can_manage_patient_nutrition(v_patient_id) then
    raise exception 'patient_nutrition_management_denied' using errcode = '42501';
  end if;

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

    insert into public.plan_items(
      id, meal_id, food_id, quantity_g, household_measure, notes
    )
    select
      pg_catalog.gen_random_uuid()::text,
      v_meal_id,
      nullif(item.value->>'foodId', ''),
      coalesce(nullif(item.value->>'grams', '')::numeric, 0),
      nullif(item.value->>'household_measure', ''),
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
$function$


CREATE OR REPLACE FUNCTION public.get_patient_published_nutrition_plans(p_patient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null or p_patient_id is null or not exists (
    select 1
    from public.patient_accounts pa
    where pa.patient_id = p_patient_id
      and pa.user_id = auth.uid()
      and pa.status = 'active'
  ) then
    raise exception 'Not authorized to view these nutrition plans'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', np.id,
        'patient_id', np.patient_id,
        'plan_name', np.plan_name,
        'start_date', np.start_date,
        'notes', np.notes,
        'created_at', np.created_at,
        'updated_at', np.updated_at,
        'publication', jsonb_build_object(
          'published_at', pp.published_at,
          'revoked_at', pp.revoked_at
        ),
        'days', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', pd.id,
              'plan_id', pd.plan_id,
              'day_number', pd.day_number,
              'day_name', pd.day_name,
              'notes', pd.notes,
              'meals', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', pm.id,
                    'day_id', pm.day_id,
                    'meal_name', pm.meal_name,
                    'meal_order', pm.meal_order,
                    'items', coalesce((
                      select jsonb_agg(
                        jsonb_build_object(
                          'id', pi.id,
                          'meal_id', pi.meal_id,
                          'food_id', pi.food_id,
                          'item_name', pi.item_name,
                          'quantity_g', pi.quantity_g,
                          'household_measure', pi.household_measure,
                          'notes', pi.notes,
                          'food', case when f.id is null then null
                            else jsonb_build_object('name_ar', f.name_ar) end
                        )
                        order by pi.id
                      )
                      from public.plan_items pi
                      left join public.foods f on f.id = pi.food_id
                      where pi.meal_id = pm.id
                    ), '[]'::jsonb)
                  )
                  order by pm.meal_order nulls last, pm.id
                )
                from public.plan_meals pm
                where pm.day_id = pd.id
              ), '[]'::jsonb)
            )
            order by pd.day_number nulls last, pd.id
          )
          from public.plan_days pd
          where pd.plan_id = np.id
        ), '[]'::jsonb)
      )
      order by pp.published_at desc nulls last, np.updated_at desc nulls last
    ),
    '[]'::jsonb
  )
  into result
  from public.nutrition_plans np
  join public.patient_plan_publications pp
    on pp.plan_id = np.id
   and pp.revoked_at is null
  where np.patient_id = p_patient_id;

  return result;
end;
$function$


alter table public.plan_items drop column if exists frequency;
alter table public.plan_meals drop column if exists frequency;
alter table public.diet_template_items drop column if exists frequency;
alter table public.diet_template_meals drop column if exists frequency;
