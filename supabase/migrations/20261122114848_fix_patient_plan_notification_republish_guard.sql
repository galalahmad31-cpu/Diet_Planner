create or replace function private.emit_patient_plan_publication_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  -- A publication is notified once on insert, or when an explicitly revoked
  -- publication is restored. Unrelated/no-op updates must not resend it.
  if tg_op = 'UPDATE' and old.revoked_at is null then
    return new;
  end if;

  select pa.user_id
    into v_recipient_id
  from public.nutrition_plans p
  join public.patient_accounts pa
    on pa.patient_id = p.patient_id
   and pa.status = 'active'
  where p.id = new.plan_id
  limit 1;

  if v_recipient_id is not null
     and new.published_by is distinct from v_recipient_id then
    insert into public.notifications(recipient_id, actor_id, event_type, title, body)
    values (
      v_recipient_id,
      new.published_by,
      'nutrition_plan_published',
      'خطة غذائية جديدة',
      'شارك مختصك خطة غذائية جديدة. يمكنك فتح مساحة الخطط لمراجعتها.'
    );
  end if;

  return new;
end;
$$;

revoke all on function private.emit_patient_plan_publication_notification() from public, anon, authenticated;