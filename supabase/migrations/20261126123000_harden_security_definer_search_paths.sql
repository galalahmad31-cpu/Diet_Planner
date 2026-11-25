begin;

-- Keep privileged function name resolution deterministic.
-- All application objects referenced by these functions are schema-qualified.
alter function public.get_book_delivery_link(uuid) set search_path = '';
alter function public.get_patient_published_nutrition_plans(uuid) set search_path = '';
alter function public.publish_patient_nutrition_plan(uuid) set search_path = '';
alter function public.revoke_patient_nutrition_plan(uuid) set search_path = '';
alter function public.save_exchange_nutrition_plan(uuid, text, jsonb) set search_path = '';

-- get_book_delivery_link now explicitly calls public.is_admin() so it remains
-- functional with an empty search_path. Its authorization logic is unchanged.

commit;
