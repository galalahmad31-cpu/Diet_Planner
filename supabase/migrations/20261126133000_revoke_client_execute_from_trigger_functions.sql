-- Trigger functions are invoked by PostgreSQL triggers, not by client RPC calls.
-- Remove the default PUBLIC/client EXECUTE grants while preserving trigger behavior.
REVOKE EXECUTE ON FUNCTION public.app_feedback_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_article_publication() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_article_publication_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_about_sections_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_nutrition_support_days_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_recipes_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_articles_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_exchange_values_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_patient_finance_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_subscription_plans_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_public_diet_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_public_diet_template() FROM PUBLIC, anon, authenticated;
