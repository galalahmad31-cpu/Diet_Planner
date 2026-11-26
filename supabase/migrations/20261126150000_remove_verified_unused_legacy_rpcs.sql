-- Remove legacy RPCs confirmed unused by the current Diet Planner source
-- and by live database function/view/policy/trigger references.
-- Keep the public delete wrapper: js/professional-directory-manage.js calls it.
-- Keep save_nutrition_plan_day: js/visit-diet-plan.js calls it.
-- Keep save_diet_template: js/diet.js calls it.
-- Keep get_book_delivery_link and get_patient_published_nutrition_plans: current UI calls them.

DROP FUNCTION IF EXISTS public.get_page_access(text);
DROP FUNCTION IF EXISTS public.can_access(text, text);
DROP FUNCTION IF EXISTS public.get_access_status();
DROP FUNCTION IF EXISTS public.get_patient_subscription_follow_up();
DROP FUNCTION IF EXISTS public.save_nutrition_plan(jsonb, jsonb);
