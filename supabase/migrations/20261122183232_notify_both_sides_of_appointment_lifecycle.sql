create or replace function private.emit_patient_appointment_notification()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_actor_id uuid := auth.uid(); v_recipient_id uuid; v_event_type text; v_title text; v_body text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'INSERT' and new.status = 'pending' then
    v_event_type := 'appointment_requested'; v_title := 'طلب موعد متابعة جديد';
    v_body := 'لديك طلب موعد متابعة جديد من المريض. راجع الطلب وحدد القرار المناسب.';
    v_recipient_id := new.professional_id;
  elsif new.status = 'confirmed' then
    v_event_type := 'appointment_confirmed'; v_title := 'تم تأكيد موعدك';
    v_body := 'تم تأكيد موعد المتابعة. يمكنك مراجعة تفاصيله في بوابة المريض.';
  elsif new.status = 'declined' then
    v_event_type := 'appointment_declined'; v_title := 'لم تتم الموافقة على الموعد';
    v_body := 'لم تتم الموافقة على طلب الموعد. يمكنك التواصل مع المختص لتحديد موعد آخر.';
  elsif new.status = 'cancelled' then
    v_event_type := 'appointment_cancelled'; v_title := 'تم إلغاء الموعد';
    v_body := 'تم إلغاء موعد المتابعة. راجع تفاصيل الموعد لمعرفة الحالة.';
  else return new; end if;
  if v_recipient_id is null and v_actor_id = new.professional_id then
    select pa.user_id into v_recipient_id from public.patient_accounts pa
    where pa.patient_id = new.patient_id and pa.status = 'active'
    order by pa.linked_at desc limit 1;
  elsif v_recipient_id is null then v_recipient_id := new.professional_id; end if;
  if v_recipient_id is not null and v_recipient_id is distinct from v_actor_id then
    insert into public.notifications(recipient_id, actor_id, event_type, title, body)
    values (v_recipient_id, v_actor_id, v_event_type, v_title, v_body);
  end if;
  return new;
end; $function$;