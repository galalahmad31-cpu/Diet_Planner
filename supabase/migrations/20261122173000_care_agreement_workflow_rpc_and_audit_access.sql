revoke all on table public.patient_health_audit from anon, authenticated;
grant select on table public.patient_health_audit to authenticated;

create or replace function public.save_professional_care_agreement(
  p_request_id uuid, p_service_title text, p_service_description text,
  p_amount numeric, p_duration_days integer, p_start_date date,
  p_end_date date, p_terms text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_request public.professional_connection_requests%rowtype;
  v_version integer;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_request_id is null then raise exception 'request_not_found'; end if;
  if nullif(btrim(p_service_title), '') is null or char_length(p_service_title) > 120 then raise exception 'invalid_service_title'; end if;
  if p_service_description is not null and char_length(p_service_description) > 2000 then raise exception 'service_description_too_long'; end if;
  if p_terms is not null and char_length(p_terms) > 4000 then raise exception 'agreement_terms_too_long'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'invalid_agreement_amount'; end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 3660 then raise exception 'invalid_agreement_duration'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'invalid_agreement_dates'; end if;
  if p_end_date <> p_start_date + (p_duration_days - 1) then raise exception 'agreement_duration_dates_mismatch'; end if;

  select * into v_request from public.professional_connection_requests
  where id = p_request_id and professional_id = v_uid for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status <> 'accepted' then raise exception 'request_not_editable'; end if;
  if v_request.patient_agreement_at is not null or v_request.professional_agreement_at is not null
     or v_request.payment_sent_at is not null or v_request.payment_received_at is not null then
    raise exception 'agreement_already_confirmed';
  end if;
  if not private.professional_has_active_subscription(v_uid) then raise exception 'active_professional_subscription_required'; end if;

  v_version := coalesce(v_request.agreement_version, 0) + 1;
  update public.professional_connection_requests
  set agreement_service_title=btrim(p_service_title),
      agreement_service_description=nullif(btrim(p_service_description),''),
      agreement_amount=p_amount, agreement_currency='EGP',
      agreement_duration_days=p_duration_days, agreement_start_date=p_start_date,
      agreement_end_date=p_end_date, agreement_terms=nullif(btrim(p_terms),''),
      agreement_payment_method='direct', agreement_version=v_version, updated_at=now()
  where id=p_request_id;

  insert into public.notifications(recipient_id,actor_id,request_id,event_type,title,body)
  values (v_request.requested_by,v_uid,v_request.id,'care_agreement_proposed',
    'اتفاق متابعة جديد',
    'أرسل المختص اتفاق متابعة بقيمة ' || p_amount::text || ' جنيه لمدة ' ||
    p_duration_days::text || ' يومًا. راجع التفاصيل ووافق قبل تأكيد الدفع.');
  return v_version;
end;
$function$;

revoke all on function public.save_professional_care_agreement(uuid,text,text,numeric,integer,date,date,text) from public, anon;
grant execute on function public.save_professional_care_agreement(uuid,text,text,numeric,integer,date,date,text) to authenticated;

create or replace function public.confirm_professional_connection_step(p_request_id uuid, p_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_request public.professional_connection_requests%rowtype;
  v_other uuid;
  v_body text;
  v_role text;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select * into v_request from public.professional_connection_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status not in ('accepted','active') then raise exception 'conversation_not_accepted'; end if;
  if v_uid <> v_request.requested_by and v_uid <> v_request.professional_id then raise exception 'not_authorized'; end if;
  v_other := case when v_uid=v_request.requested_by then v_request.professional_id else v_request.requested_by end;

  if p_step='agreement' then
    if v_request.status <> 'accepted' then raise exception 'follow_up_already_active'; end if;
    if v_request.agreement_service_title is null or v_request.agreement_amount is null
       or v_request.agreement_duration_days is null or v_request.agreement_start_date is null
       or v_request.agreement_end_date is null then raise exception 'care_agreement_not_proposed'; end if;
    if v_uid=v_request.requested_by then
      if v_request.patient_agreement_at is not null then raise exception 'step_already_confirmed'; end if;
      update public.professional_connection_requests set patient_agreement_at=now(),updated_at=now() where id=p_request_id;
    else
      if v_request.professional_agreement_at is not null then raise exception 'step_already_confirmed'; end if;
      update public.professional_connection_requests set professional_agreement_at=now(),updated_at=now() where id=p_request_id;
    end if;
    v_body := 'تأكيد الاتفاق: أوافق على تفاصيل الخدمة والسعر والمدة المسجلة في اتفاق المتابعة.';
  elsif p_step='payment_sent' then
    if v_uid <> v_request.requested_by then raise exception 'patient_action_only'; end if;
    if v_request.status <> 'accepted' or v_request.patient_agreement_at is null or v_request.professional_agreement_at is null then raise exception 'agreement_not_confirmed'; end if;
    if v_request.payment_sent_at is not null then raise exception 'step_already_confirmed'; end if;
    update public.professional_connection_requests set payment_sent_at=now(),updated_at=now() where id=p_request_id;
    v_body := 'تأكيد إرسال المبلغ: أؤكد أنني أرسلت المبلغ المتفق عليه للمختص.';
  elsif p_step='payment_received' then
    if v_uid <> v_request.professional_id then raise exception 'professional_action_only'; end if;
    if v_request.status <> 'accepted' or v_request.patient_agreement_at is null
       or v_request.professional_agreement_at is null or v_request.payment_sent_at is null then raise exception 'payment_not_ready_for_receipt'; end if;
    if v_request.payment_received_at is not null then raise exception 'step_already_confirmed'; end if;
    perform 1 from public.patients where id=v_request.patient_id for update;
    select case when exists (
      select 1 from public.patient_care_team where patient_id=v_request.patient_id
        and status='active' and relationship_role='primary'
    ) then 'collaborator' else 'primary' end into v_role;
    insert into public.patient_care_team(patient_id,professional_id,relationship_role,status,started_at,ended_at)
    values(v_request.patient_id,v_request.professional_id,v_role,'active',now(),null)
    on conflict(patient_id,professional_id)
    do update set relationship_role=excluded.relationship_role,status='active',started_at=now(),ended_at=null;
    update public.professional_connection_requests
    set payment_received_at=now(),status='active',updated_at=now() where id=p_request_id;
    v_body := 'تأكيد استلام المبلغ: أؤكد أنني استلمت المبلغ المتفق عليه من المريض. بدأت المتابعة.';
  else
    raise exception 'invalid_confirmation_step';
  end if;
  insert into public.patient_messages(patient_id,sender_id,recipient_id,body)
  values(v_request.patient_id,v_uid,v_other,v_body);
end;
$function$;

revoke all on function public.confirm_professional_connection_step(uuid,text) from public, anon;
grant execute on function public.confirm_professional_connection_step(uuid,text) to authenticated;
