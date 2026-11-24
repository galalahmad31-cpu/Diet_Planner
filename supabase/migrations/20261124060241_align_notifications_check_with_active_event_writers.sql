alter table public.notifications
  drop constraint if exists notifications_event_type_check;

alter table public.notifications
  add constraint notifications_event_type_check
  check (event_type = any (array[
    'message_received',
    'nutrition_plan_published'
  ]::text[]));
