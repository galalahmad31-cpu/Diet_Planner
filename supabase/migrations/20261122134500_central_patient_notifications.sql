begin;
do $$
declare v_constraint text;
begin
  select conname into v_constraint from pg_constraint
  where conrelid='public.notifications'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%event_type%' limit 1;
  if v_constraint is not null then
    execute format('alter table public.notifications drop constraint %I',v_constraint);
  end if;
end;
$$;
alter table public.notifications add constraint notifications_event_type_check
check(event_type=any(array[
'connection_request_received','connection_request_accepted','connection_request_declined',
'patient_agreement_confirmed','professional_agreement_confirmed','payment_sent',
'followup_activated','followup_ended','message_received','nutrition_plan_published',
'appointment_requested','appointment_confirmed','appointment_declined','appointment_cancelled'
]::text[]));
create or replace function private.emit_patient_plan_publication_notification()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_recipient_id uuid;
begin
  if new.revoked_at is not null then return new; end if;
  if tg_op='UPDATE' and old.revoked_at is null then return new; end if;
  select pa.user_id into v_recipient_id
  from public.nutrition_plans p join public.patient_accounts pa
    on pa.patient_id=p.patient_id and pa.status='active'
  where p.id=new.plan_id limit 1;
  if v_recipient_id is not null and new.published_by is distinct from v_recipient_id then
    insert into public.notifications(recipient_id,actor_id,event_type,title,body)
    values(v_recipient_id,new.published_by,'nutrition_plan_published',
      'خطة غذائية جديدة','شارك مختصك خطة غذائية جديدة. يمكنك فتح مساحة الخطط لمراجعتها.');
  end if;
  return new;
end;
$$;
revoke all on function private.emit_patient_plan_publication_notification() from public,anon,authenticated;
drop trigger if exists trg_patient_plan_publication_notification on public.patient_plan_publications;
create trigger trg_patient_plan_publication_notification
after insert or update of revoked_at on public.patient_plan_publications
for each row when (new.revoked_at is null)
execute function private.emit_patient_plan_publication_notification();
create or replace function private.emit_patient_appointment_notification()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_recipient_id uuid;
  v_event_type text;
  v_title text;
  v_body text;
begin
  if tg_op='INSERT' then
    if new.status<>'pending' then return new; end if;
    v_recipient_id:=new.professional_id;
    v_actor_id:=coalesce(v_actor_id,new.requested_by);
    v_event_type:='appointment_requested';
    v_title:='طلب موعد جديد';
    v_body:='لديك طلب موعد جديد من أحد المرضى.';
  elsif new.status is distinct from old.status then
    if new.status='confirmed' then
      v_recipient_id:=new.requested_by; v_event_type:='appointment_confirmed';
      v_title:='تم تأكيد موعدك'; v_body:='وافق المختص على موعدك. يمكنك مراجعة تفاصيل الموعد في بوابة المريض.';
    elsif new.status='declined' then
      v_recipient_id:=new.requested_by; v_event_type:='appointment_declined';
      v_title:='لم تتم الموافقة على الموعد'; v_body:='لم يوافق المختص على طلب الموعد. يمكنك التواصل معه لتحديد موعد آخر.';
    elsif new.status='cancelled' then
      if v_actor_id=new.professional_id then v_recipient_id:=new.requested_by;
      elsif v_actor_id=new.requested_by then v_recipient_id:=new.professional_id;
      else return new; end if;
      v_event_type:='appointment_cancelled'; v_title:='تم إلغاء الموعد';
      v_body:='تم إلغاء موعد المتابعة. راجع تفاصيل الموعد لمعرفة الحالة.';
    else return new;
    end if;
  else return new;
  end if;
  if v_recipient_id is not null and v_actor_id is distinct from v_recipient_id then
    insert into public.notifications(recipient_id,actor_id,event_type,title,body)
    values(v_recipient_id,v_actor_id,v_event_type,v_title,v_body);
  end if;
  return new;
end;
$$;
revoke all on function private.emit_patient_appointment_notification() from public,anon,authenticated;
drop trigger if exists trg_patient_appointment_notification on public.patient_appointments;
create trigger trg_patient_appointment_notification
after insert or update of status on public.patient_appointments
for each row execute function private.emit_patient_appointment_notification();
commit;