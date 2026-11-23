create or replace function private.revoke_plan_publication_on_content_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
set row_security = off
as $function$
declare
  v_old_plan_id uuid;
  v_new_plan_id uuid;
begin
  if tg_table_name = 'nutrition_plans' then
    v_old_plan_id := old.id;
    v_new_plan_id := new.id;
  elsif tg_table_name = 'plan_days' then
    if tg_op <> 'INSERT' then v_old_plan_id := old.plan_id; end if;
    if tg_op <> 'DELETE' then v_new_plan_id := new.plan_id; end if;
  elsif tg_table_name = 'plan_meals' then
    if tg_op <> 'INSERT' then
      select pd.plan_id into v_old_plan_id
      from public.plan_days pd where pd.id = old.day_id;
    end if;
    if tg_op <> 'DELETE' then
      select pd.plan_id into v_new_plan_id
      from public.plan_days pd where pd.id = new.day_id;
    end if;
  elsif tg_table_name = 'plan_items' then
    if tg_op <> 'INSERT' then
      select pd.plan_id into v_old_plan_id
      from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      where pm.id = old.meal_id;
    end if;
    if tg_op <> 'DELETE' then
      select pd.plan_id into v_new_plan_id
      from public.plan_meals pm
      join public.plan_days pd on pd.id = pm.day_id
      where pm.id = new.meal_id;
    end if;
  elsif tg_table_name = 'exchange_values' then
    if tg_op <> 'INSERT' then v_old_plan_id := old.plan_id; end if;
    if tg_op <> 'DELETE' then v_new_plan_id := new.plan_id; end if;
  else
    raise exception 'Unsupported nutrition plan content table: %', tg_table_name;
  end if;

  if v_old_plan_id is not null then
    update public.patient_plan_publications
       set revoked_at = pg_catalog.now()
     where plan_id = v_old_plan_id and revoked_at is null;
  end if;

  if v_new_plan_id is not null and v_new_plan_id is distinct from v_old_plan_id then
    update public.patient_plan_publications
       set revoked_at = pg_catalog.now()
     where plan_id = v_new_plan_id and revoked_at is null;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.revoke_plan_publication_on_content_change() from public, anon, authenticated;

drop trigger if exists trg_revoke_publication_on_plan_update on public.nutrition_plans;
create trigger trg_revoke_publication_on_plan_update
after update on public.nutrition_plans
for each row execute function private.revoke_plan_publication_on_content_change();

drop trigger if exists trg_revoke_publication_on_plan_days_change on public.plan_days;
create trigger trg_revoke_publication_on_plan_days_change
after insert or update or delete on public.plan_days
for each row execute function private.revoke_plan_publication_on_content_change();

drop trigger if exists trg_revoke_publication_on_plan_meals_change on public.plan_meals;
create trigger trg_revoke_publication_on_plan_meals_change
after insert or update or delete on public.plan_meals
for each row execute function private.revoke_plan_publication_on_content_change();

drop trigger if exists trg_revoke_publication_on_plan_items_change on public.plan_items;
create trigger trg_revoke_publication_on_plan_items_change
after insert or update or delete on public.plan_items
for each row execute function private.revoke_plan_publication_on_content_change();

drop trigger if exists trg_revoke_publication_on_exchange_values_change on public.exchange_values;
create trigger trg_revoke_publication_on_exchange_values_change
after insert or update or delete on public.exchange_values
for each row execute function private.revoke_plan_publication_on_content_change();
