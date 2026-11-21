-- The RPC validates the authenticated user, subscription, patient ownership,
-- plan ownership and day ownership before writing. Run it as its postgres owner
-- to avoid repeating the table RLS policy checks for every inserted/deleted row.
alter function public.save_nutrition_plan_day(jsonb, jsonb) security definer;
alter function public.save_nutrition_plan_day(jsonb, jsonb) set search_path = '';
revoke all on function public.save_nutrition_plan_day(jsonb, jsonb) from public, anon;
grant execute on function public.save_nutrition_plan_day(jsonb, jsonb) to authenticated;
