-- Remove file-scoped identifiers from messaging and connection requests.
drop policy if exists patient_messages_select_participants on public.patient_messages;
drop policy if exists patient_messages_insert_participants on public.patient_messages;
drop function if exists private.can_read_patient_conversation_message(uuid,uuid,uuid);
drop function if exists public.mark_patient_messages_read(uuid,uuid);
drop function if exists public.list_my_professional_connection_requests(uuid);
drop function if exists public.list_professional_connection_requests();
drop function if exists public.request_professional_connection(uuid,uuid,text);
drop function if exists private.activate_patient_professional_conversation(uuid,uuid);

drop index if exists public.patient_messages_patient_created_idx;
drop index if exists public.patient_messages_recipient_unread_idx;
drop index if exists public.professional_connection_requests_patient_status_idx;

alter table public.patient_messages drop column if exists patient_id;
alter table public.professional_connection_requests drop column if exists patient_id;

create index patient_messages_recipient_sender_created_idx
  on public.patient_messages(recipient_id,sender_id,created_at desc);
create index patient_messages_recipient_unread_idx
  on public.patient_messages(recipient_id,sender_id,created_at desc) where read_at is null;
create index professional_connection_requests_requester_status_idx
  on public.professional_connection_requests(requested_by,status,updated_at desc);

create or replace function private.can_read_patient_conversation_message(p_sender_id uuid,p_recipient_id uuid)
returns boolean language sql stable security definer set search_path='' set row_security='off'
as $$
 select auth.uid() in (p_sender_id,p_recipient_id)
 and exists(select 1 from public.professional_connection_requests r
   where r.requested_by in (p_sender_id,p_recipient_id)
   and r.professional_id in (p_sender_id,p_recipient_id)
   and r.requested_by<>r.professional_id and r.status='accepted');
$$;
create policy patient_messages_select_participants on public.patient_messages
for select to authenticated using(private.can_read_patient_conversation_message(sender_id,recipient_id));
create policy patient_messages_insert_participants on public.patient_messages
for insert to authenticated with check(sender_id=(select auth.uid()) and sender_id<>recipient_id
 and private.can_read_patient_conversation_message(sender_id,recipient_id));

create or replace function public.request_professional_connection(p_professional_id uuid,p_message text default null)
returns uuid language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_id uuid;v_status text;
begin
 if v_uid is null then raise exception 'authentication_required' using errcode='42501';end if;
 if p_professional_id is null or p_professional_id=v_uid then raise exception 'invalid_connection_request' using errcode='22023';end if;
 if p_message is not null and char_length(btrim(p_message))>1000 then raise exception 'message_too_long' using errcode='22023';end if;
 if not exists(select 1 from public.profiles where id=v_uid and account_type='patient') then raise exception 'patient_account_required' using errcode='42501';end if;
 if not exists(select 1 from public.professional_directory_profiles where user_id=p_professional_id and listing_status='published' and is_verified=true) then raise exception 'professional_not_available' using errcode='22023';end if;
 insert into public.professional_connection_requests(professional_id,requested_by,message,status)
 values(p_professional_id,v_uid,nullif(btrim(p_message),''),'pending')
 on conflict(requested_by,professional_id) do update
 set message=coalesce(excluded.message,public.professional_connection_requests.message),
 status=case public.professional_connection_requests.status when 'blocked' then 'restore_pending' when 'declined' then 'pending' when 'cancelled' then 'pending' else public.professional_connection_requests.status end,
 decided_at=case when public.professional_connection_requests.status in ('blocked','declined','cancelled') then null else public.professional_connection_requests.decided_at end,
 updated_at=now()
 returning id,status into v_id,v_status;
 if v_status='accepted' then raise exception 'conversation_already_accepted' using errcode='23505';end if;
 return v_id;
end;$$;

create or replace function public.list_professional_connection_requests()
returns table(request_id uuid,patient_user_id uuid,patient_name text,message text,status text,created_at timestamptz)
language sql stable security definer set search_path='' set row_security='off'
as $$
 select r.id,r.requested_by,coalesce(pr.full_name,'مريض'),r.message,r.status,r.created_at
 from public.professional_connection_requests r left join public.profiles pr on pr.id=r.requested_by
 where r.professional_id=auth.uid() order by r.updated_at desc,r.created_at desc limit 200;
$$;
create or replace function public.list_my_professional_connection_requests()
returns table(request_id uuid,professional_id uuid,professional_name text,professional_title text,status text,created_at timestamptz)
language sql stable security definer set search_path='' set row_security='off'
as $$
 select r.id,r.professional_id,d.display_name,d.professional_title,r.status,r.created_at
 from public.professional_connection_requests r join public.professional_directory_profiles d on d.user_id=r.professional_id
 where r.requested_by=auth.uid() order by r.updated_at desc,r.created_at desc limit 200;
$$;
create or replace function public.mark_patient_messages_read(p_other_user_id uuid)
returns integer language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_updated integer:=0;
begin
 if v_uid is null or p_other_user_id is null or p_other_user_id=v_uid then raise exception 'invalid_conversation_participants' using errcode='22023';end if;
 if not private.can_read_patient_conversation_message(v_uid,p_other_user_id) then raise exception 'not_authorized_for_conversation' using errcode='42501';end if;
 update public.patient_messages set read_at=now() where recipient_id=v_uid and sender_id=p_other_user_id and read_at is null;
 get diagnostics v_updated=row_count;return v_updated;
end;$$;

create or replace function private.activate_patient_professional_conversation(p_patient_user_id uuid,p_professional_id uuid)
returns void language plpgsql security definer set search_path='' set row_security='off'
as $$
begin
 insert into public.professional_connection_requests(professional_id,requested_by,status,decided_at,updated_at)
 values(p_professional_id,p_patient_user_id,'accepted',now(),now())
 on conflict(requested_by,professional_id) do update
 set status=case when public.professional_connection_requests.status in ('blocked','restore_pending')
                 then public.professional_connection_requests.status else 'accepted' end,
     decided_at=case when public.professional_connection_requests.status in ('blocked','restore_pending')
                     then public.professional_connection_requests.decided_at else now() end,
     updated_at=now();
end;$$;

revoke all on function private.can_read_patient_conversation_message(uuid,uuid) from public,anon;
grant execute on function private.can_read_patient_conversation_message(uuid,uuid) to authenticated;
revoke all on function private.activate_patient_professional_conversation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.request_professional_connection(uuid,text) from public,anon;
revoke all on function public.list_professional_connection_requests() from public,anon;
revoke all on function public.list_my_professional_connection_requests() from public,anon;
revoke all on function public.mark_patient_messages_read(uuid) from public,anon;
grant execute on function public.request_professional_connection(uuid,text) to authenticated;
grant execute on function public.list_professional_connection_requests() to authenticated;
grant execute on function public.list_my_professional_connection_requests() to authenticated;
grant execute on function public.mark_patient_messages_read(uuid) to authenticated;
