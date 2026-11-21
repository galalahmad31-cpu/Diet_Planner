create or replace function public.get_patient_published_nutrition_plans(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  result jsonb;
begin
  if auth.uid() is null or p_patient_id is null or not exists (
    select 1 from public.patient_accounts pa
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
        'id', np.id, 'patient_id', np.patient_id, 'plan_name', np.plan_name,
        'start_date', np.start_date, 'notes', np.notes,
        'created_at', np.created_at, 'updated_at', np.updated_at,
        'publication', jsonb_build_object('published_at', pp.published_at, 'revoked_at', pp.revoked_at),
        'days', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', pd.id, 'plan_id', pd.plan_id, 'day_number', pd.day_number,
              'day_name', pd.day_name, 'notes', pd.notes,
              'meals', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', pm.id, 'day_id', pm.day_id, 'meal_name', pm.meal_name,
                    'meal_order', pm.meal_order, 'frequency', pm.frequency,
                    'items', coalesce((
                      select jsonb_agg(
                        jsonb_build_object(
                          'id', pi.id, 'meal_id', pi.meal_id, 'food_id', pi.food_id,
                          'item_name', pi.item_name, 'quantity_g', pi.quantity_g,
                          'household_measure', pi.household_measure, 'frequency', pi.frequency,
                          'notes', pi.notes,
                          'food', case when f.id is null then null else jsonb_build_object('name_ar', f.name_ar) end
                        ) order by pi.id
                      )
                      from public.plan_items pi
                      left join public.foods f on f.id = pi.food_id
                      where pi.meal_id = pm.id
                    ), '[]'::jsonb)
                  ) order by pm.meal_order nulls last, pm.id
                )
                from public.plan_meals pm where pm.day_id = pd.id
              ), '[]'::jsonb)
            ) order by pd.day_number nulls last, pd.id
          )
          from public.plan_days pd where pd.plan_id = np.id
        ), '[]'::jsonb)
      ) order by pp.published_at desc nulls last, np.updated_at desc nulls last
    ), '[]'::jsonb
  )
  into result
  from public.nutrition_plans np
  join public.patient_plan_publications pp
    on pp.plan_id = np.id and pp.revoked_at is null
  where np.patient_id = p_patient_id;

  return result;
end;
$function$;

revoke all on function public.get_patient_published_nutrition_plans(uuid) from public, anon;
grant execute on function public.get_patient_published_nutrition_plans(uuid) to authenticated;
