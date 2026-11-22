do $block$
declare v_def text; v_old text; v_new text;
begin
  v_def:=pg_get_functiondef('public.save_nutrition_plan_day(jsonb,jsonb)'::regprocedure);
  v_old:='  if not v_is_admin then'||E'\n'||'    if not (select public.has_active_subscription(v_user_id)) then';
  v_new:='  if not v_is_admin then'||E'\n'||
    '    if private.is_expired_care_professional(v_patient_id) then'||E'\n'||
    '      raise exception ''care_agreement_expired_read_only'';'||E'\n'||
    '    end if;'||E'\n'||
    '    if not (select public.has_active_subscription(v_user_id)) then';
  if position(v_old in v_def)=0 then raise exception 'save_nutrition_plan_day source anchor not found'; end if;
  execute replace(v_def,v_old,v_new);

  v_def:=pg_get_functiondef('public.publish_patient_nutrition_plan(uuid)'::regprocedure);
  v_old:='  if not public.is_admin() and not public.has_active_subscription(v_uid) then';
  v_new:='  if not public.is_admin() and exists ('||E'\n'||
    '    select 1 from public.nutrition_plans np where np.id = p_plan_id'||E'\n'||
    '      and private.is_expired_care_professional(np.patient_id)'||E'\n'||
    '  ) then raise exception ''care_agreement_expired_read_only'' using errcode = ''42501''; end if;'||E'\n'||v_old;
  if position(v_old in v_def)=0 then raise exception 'publish_patient_nutrition_plan source anchor not found'; end if;
  execute replace(v_def,v_old,v_new);

  v_def:=pg_get_functiondef('public.revoke_patient_nutrition_plan(uuid)'::regprocedure);
  v_old:='  update public.patient_plan_publications pp';
  v_new:='  if exists ('||E'\n'||
    '    select 1 from public.nutrition_plans np'||E'\n'||
    '    join public.patients p on p.id = np.patient_id'||E'\n'||
    '    where np.id = p_plan_id and p.user_id = v_uid'||E'\n'||
    '      and private.is_expired_care_professional(np.patient_id)'||E'\n'||
    '  ) then raise exception ''care_agreement_expired_read_only'' using errcode = ''42501''; end if;'||E'\n'||v_old;
  if position(v_old in v_def)=0 then raise exception 'revoke_patient_nutrition_plan source anchor not found'; end if;
  execute replace(v_def,v_old,v_new);
end
$block$;