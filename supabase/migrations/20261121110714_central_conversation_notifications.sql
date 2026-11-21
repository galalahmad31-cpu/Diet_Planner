create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  request_id uuid references public.professional_connection_requests(id) on delete cascade,
  event_type text not null check (event_type in (
    'connection_request_received',
    'connection_request_accepted',
    'connection_request_declined',
    'patient_agreement_confirmed',
    'professional_agreement_confirmed',
    'payment_sent',
    'followup_activated',
    'message_received'
  )),
  title text not null check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_not_self check (actor_id is null or actor_id <> recipient_id)
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_unread_recipient_created_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy notifications_recipient_select
  on public.notifications for select to authenticated
  using ((select auth.uid()) = recipient_id);

create policy notifications_recipient_mark_read
  on public.notifications for update to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);

create or replace function private.emit_professional_connection_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
      values (new.professional_id, new.requested_by, new.id,
        'connection_request_received', 'طلب محادثة جديد',
        'لديك طلب محادثة جديد من أحد المرضى.');
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
      values (new.professional_id, new.requested_by, new.id,
        'connection_request_received', 'طلب محادثة جديد',
        'لديك طلب محادثة جديد من أحد المرضى.');
    elsif new.status = 'accepted' then
      insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
      values (new.requested_by, new.professional_id, new.id,
        'connection_request_accepted', 'تم قبول طلب المحادثة',
        'وافق المختص على طلبك. يمكنكما بدء الاتفاق داخل المحادثة.');
    elsif new.status = 'declined' then
      insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
      values (new.requested_by, new.professional_id, new.id,
        'connection_request_declined', 'لم يتم قبول طلب المحادثة',
        'قام المختص برفض طلب المحادثة.');
    end if;
  end if;

  if old.patient_agreement_at is null and new.patient_agreement_at is not null then
    insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
    values (new.professional_id, new.requested_by, new.id,
      'patient_agreement_confirmed', 'المريض أكد الاتفاق',
      'أكد المريض موافقته على تفاصيل الخدمة والسعر والمدة.');
  end if;

  if old.professional_agreement_at is null and new.professional_agreement_at is not null then
    insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
    values (new.requested_by, new.professional_id, new.id,
      'professional_agreement_confirmed', 'المختص أكد الاتفاق',
      'أكد المختص موافقته على تفاصيل الخدمة والسعر والمدة.');
  end if;

  if old.payment_sent_at is null and new.payment_sent_at is not null then
    insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
    values (new.professional_id, new.requested_by, new.id,
      'payment_sent', 'المريض أكد إرسال المبلغ',
      'أفاد المريض بأنه أرسل المبلغ المتفق عليه.');
  end if;

  if old.payment_received_at is null and new.payment_received_at is not null then
    insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
    values (new.requested_by, new.professional_id, new.id,
      'followup_activated', 'بدأت المتابعة',
      'أكد المختص استلام المبلغ، وتم تفعيل المتابعة وإتاحة الملف الصحي.');
  end if;

  return new;
end;
$$;

create or replace function private.emit_patient_message_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if new.body like 'تأكيد الاتفاق:%'
     or new.body like 'تأكيد إرسال المبلغ:%'
     or new.body like 'تأكيد استلام المبلغ:%' then
    return new;
  end if;

  select r.id into v_request_id
  from public.professional_connection_requests r
  where r.patient_id = new.patient_id
    and r.status in ('accepted', 'active')
    and (
      (r.requested_by = new.sender_id and r.professional_id = new.recipient_id)
      or
      (r.professional_id = new.sender_id and r.requested_by = new.recipient_id)
    )
  order by r.updated_at desc
  limit 1;

  if v_request_id is not null then
    insert into public.notifications(recipient_id, actor_id, request_id, event_type, title, body)
    values (new.recipient_id, new.sender_id, v_request_id,
      'message_received', 'رسالة جديدة',
      'لديك رسالة جديدة في محادثة المتابعة.');
  end if;

  return new;
end;
$$;

revoke all on function private.emit_professional_connection_notification() from public, anon, authenticated;
revoke all on function private.emit_patient_message_notification() from public, anon, authenticated;

drop trigger if exists trg_professional_connection_notifications
  on public.professional_connection_requests;
create trigger trg_professional_connection_notifications
after insert or update of status, patient_agreement_at, professional_agreement_at, payment_sent_at, payment_received_at
on public.professional_connection_requests
for each row execute function private.emit_professional_connection_notification();

drop trigger if exists trg_patient_message_notifications
  on public.patient_messages;
create trigger trg_patient_message_notifications
after insert on public.patient_messages
for each row execute function private.emit_patient_message_notification();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
