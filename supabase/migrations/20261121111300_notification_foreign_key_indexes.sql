create index if not exists notifications_actor_id_idx
  on public.notifications (actor_id);

create index if not exists notifications_request_id_idx
  on public.notifications (request_id);
