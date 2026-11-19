ALTER TABLE public.patient_finances
  ADD COLUMN IF NOT EXISTS last_visit_date date,
  ADD COLUMN IF NOT EXISTS next_follow_up_date date;

WITH latest_legacy_dates AS (
  SELECT DISTINCT ON (finance_id)
    finance_id,
    last_visit_date,
    next_follow_up_date
  FROM public.patient_finance_legacy_dates
  ORDER BY finance_id, archived_at DESC
)
UPDATE public.patient_finances AS finance
SET
  last_visit_date = COALESCE(finance.last_visit_date, legacy.last_visit_date),
  next_follow_up_date = COALESCE(finance.next_follow_up_date, legacy.next_follow_up_date)
FROM latest_legacy_dates AS legacy
WHERE finance.id = legacy.finance_id
  AND (
    (finance.last_visit_date IS NULL AND legacy.last_visit_date IS NOT NULL)
    OR
    (finance.next_follow_up_date IS NULL AND legacy.next_follow_up_date IS NOT NULL)
  );

COMMENT ON COLUMN public.patient_finances.last_visit_date
  IS 'Actual date the patient attended the most recent visit.';
COMMENT ON COLUMN public.patient_finances.next_follow_up_date
  IS 'Manually scheduled next patient follow-up date.';
