-- Consolidate all contact requests by patient account + professional account.
-- Keep legacy file references temporarily nullable; the next migration removes them.
with ranked as (
 select id,row_number() over(partition by requested_by,professional_id
 order by case status when 'accepted' then 1 when 'blocked' then 2 when 'restore_pending' then 3 when 'pending' then 4 when 'declined' then 5 else 6 end,
 updated_at desc,created_at desc,id) rn
 from public.professional_connection_requests
)
delete from public.professional_connection_requests r using ranked x where r.id=x.id and x.rn>1;

alter table public.professional_connection_requests drop constraint if exists professional_connection_requests_patient_professional_key;
drop index if exists public.professional_connection_requests_standalone_pair_key;
alter table public.professional_connection_requests drop constraint if exists professional_connection_requests_status_check;
alter table public.professional_connection_requests add constraint professional_connection_requests_status_check
 check(status=any(array['pending','accepted','declined','cancelled','blocked','restore_pending']::text[]));
update public.patient_messages set patient_id=null where patient_id is not null;
update public.professional_connection_requests set patient_id=null where patient_id is not null;
create unique index professional_connection_requests_account_pair_key on public.professional_connection_requests(requested_by,professional_id);

create or replace function private.can_read_patient_conversation_message(p_patient_id uuid,p_sender_id uuid,p_recipient_id uuid)
returns boolean language sql stable security definer set search_path='' set row_security='off'
as $$
 select p_patient_id is null and auth.uid() in(p_sender_id,p_recipient_id)
 and exists(select 1 from public.professional_connection_requests r
 where r.requested_by in(p_sender_id,p_recipient_id) and r.professional_id in(p_sender_id,p_recipient_id)
 and r.requested_by<>r.professional_id and r.status='accepted');
$$;

create or replace function public.request_professional_connection(p_professional_id uuid,p_patient_id uuid default null,p_message text default null)
returns uuid language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_id uuid;v_status text;
begin
 if v_uid is null then raise exception 'authentication_required' using errcode='42501';end if;
 if p_professional_id is null or p_professional_id=v_uid then raise exception 'invalid_connection_request' using errcode='22023';end if;
 if p_message is not null and char_length(btrim(p_message))>1000 then raise exception 'message_too_long' using errcode='22023';end if;
 if not exists(select 1 from public.profiles where id=v_uid and account_type='patient') then raise exception 'patient_account_required' using errcode='42501';end if;
 if not exists(select 1 from public.professional_directory_profiles where user_id=p_professional_id and listing_status='published' and is_verified=true) then raise exception 'professional_not_available' using errcode='22023';end if;
 if p_patient_id is not null and not exists(select 1 from public.patient_accounts where patient_id=p_patient_id and user_id=v_uid and status='active') then raise exception 'patient_file_not_linked_to_account' using errcode='42501';end if;
 insert into public.professional_connection_requests(patient_id,professional_id,requested_by,message,status)
 values(null,p_professional_id,v_uid,nullif(btrim(p_message),''),'pending')
 on conflict(requested_by,professional_id) do update
 set message=coalesce(excluded.message,public.professional_connection_requests.message),
 status=case public.professional_connection_requests.status when 'blocked' then 'restore_pending' when 'declined' then 'pending' when 'cancelled' then 'pending' else public.professional_connection_requests.status end,
 decided_at=case when public.professional_connection_requests.status in('blocked','declined','cancelled') then null else public.professional_connection_requests.decided_at end,
 updated_at=now()
 returning id,status into v_id,v_status;
 if v_status='accepted' then raise exception 'conversation_already_accepted' using errcode='23505';end if;
 return v_id;
end;$$;

create or replace function public.respond_professional_connection_request(p_request_id uuid,p_decision text)
returns void language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_status text;v_next text;
begin
 if v_uid is null then raise exception 'authentication_required' using errcode='42501';end if;
 if p_decision not in('accepted','declined','blocked') then raise exception 'invalid_decision' using errcode='22023';end if;
 select status into v_status from public.professional_connection_requests where id=p_request_id and professional_id=v_uid for update;
 if not found then raise exception 'request_not_found' using errcode='P0002';end if;
 if p_decision='blocked' then
  if v_status<>'accepted' then raise exception 'conversation_not_active' using errcode='55000';end if;v_next:='blocked';
 elsif v_status='pending' then v_next:=p_decision;
 elsif v_status='restore_pending' then v_next:=case when p_decision='accepted' then 'accepted' else 'blocked' end;
 else raise exception 'request_not_actionable' using errcode='55000';end if;
 if v_next='accepted' and not exists(select 1 from public.professional_directory_profiles where user_id=v_uid and listing_status='published' and is_verified=true) then raise exception 'professional_listing_not_active' using errcode='42501';end if;
 update public.professional_connection_requests set status=v_next,decided_at=now(),updated_at=now() where id=p_request_id and professional_id=v_uid;
end;$$;

create or replace function public.cancel_professional_connection_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_status text;
begin
 if v_uid is null then raise exception 'authentication_required' using errcode='42501';end if;
 select status into v_status from public.professional_connection_requests where id=p_request_id and requested_by=v_uid for update;
 if not found then raise exception 'request_not_found' using errcode='P0002';end if;
 if v_status='pending' then update public.professional_connection_requests set status='cancelled',decided_at=now(),updated_at=now() where id=p_request_id;
 elsif v_status='restore_pending' then update public.professional_connection_requests set status='blocked',decided_at=now(),updated_at=now() where id=p_request_id;
 else raise exception 'request_not_pending' using errcode='55000';end if;
end;$$;

create or replace function public.list_professional_connection_requests()
returns table(request_id uuid,patient_id uuid,patient_user_id uuid,patient_name text,message text,status text,created_at timestamptz)
language sql stable security definer set search_path='' set row_security='off'
as $$
 select r.id,null::uuid,r.requested_by,coalesce(pr.full_name,'مريض'),r.message,r.status,r.created_at
 from public.professional_connection_requests r left join public.profiles pr on pr.id=r.requested_by
 where r.professional_id=auth.uid() order by r.updated_at desc,r.created_at desc limit 200;
$$;
create or replace function public.list_my_professional_connection_requests(p_patient_id uuid default null)
returns table(request_id uuid,professional_id uuid,professional_name text,professional_title text,status text,created_at timestamptz)
language sql stable security definer set search_path='' set row_security='off'
as $$
 select r.id,r.professional_id,d.display_name,d.professional_title,r.status,r.created_at
 from public.professional_connection_requests r join public.professional_directory_profiles d on d.user_id=r.professional_id
 where r.requested_by=auth.uid() order by r.updated_at desc,r.created_at desc limit 200;
$$;
create or replace function public.mark_patient_messages_read(p_patient_id uuid,p_other_user_id uuid)
returns integer language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_updated integer:=0;
begin
 if v_uid is null or p_other_user_id is null or p_other_user_id=v_uid then raise exception 'invalid_conversation_participants' using errcode='22023';end if;
 if not private.can_read_patient_conversation_message(null,v_uid,p_other_user_id) then raise exception 'not_authorized_for_conversation' using errcode='42501';end if;
 update public.patient_messages set read_at=now() where patient_id is not distinct from p_patient_id and recipient_id=v_uid and sender_id=p_other_user_id and read_at is null;
 get diagnostics v_updated=row_count;return v_updated;
end;$$;

create or replace function private.activate_patient_professional_conversation(p_patient_user_id uuid,p_professional_id uuid)
returns void language plpgsql security definer set search_path='' set row_security='off'
as $$
begin
 insert into public.professional_connection_requests(patient_id,professional_id,requested_by,status,decided_at,updated_at)
 values(null,p_professional_id,p_patient_user_id,'accepted',now(),now())
 on conflict(requested_by,professional_id) do update
 set status=case when public.professional_connection_requests.status in('blocked','restore_pending') then public.professional_connection_requests.status else 'accepted' end,
 decided_at=case when public.professional_connection_requests.status in('blocked','restore_pending') then public.professional_connection_requests.decided_at else now() end,
 updated_at=now();
end;$$;

revoke all on function private.activate_patient_professional_conversation(uuid,uuid) from public,anon,authenticated;
revoke all on function private.can_read_patient_conversation_message(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_patient_conversation_message(uuid,uuid,uuid) to authenticated;
revoke all on function public.request_professional_connection(uuid,uuid,text) from public,anon;
revoke all on function public.respond_professional_connection_request(uuid,text) from public,anon;
revoke all on function public.cancel_professional_connection_request(uuid) from public,anon;
revoke all on function public.list_professional_connection_requests() from public,anon;
revoke all on function public.list_my_professional_connection_requests(uuid) from public,anon;
revoke all on function public.mark_patient_messages_read(uuid,uuid) from public,anon;
grant execute on function public.request_professional_connection(uuid,uuid,text) to authenticated;
grant execute on function public.respond_professional_connection_request(uuid,text) to authenticated;
grant execute on function public.cancel_professional_connection_request(uuid) to authenticated;
grant execute on function public.list_professional_connection_requests() to authenticated;
grant execute on function public.list_my_professional_connection_requests(uuid) to authenticated;
grant execute on function public.mark_patient_messages_read(uuid,uuid) to authenticated;

drop policy if exists patient_messages_insert_participants on public.patient_messages;
drop policy if exists patient_messages_select_participants on public.patient_messages;
create policy patient_messages_select_participants on public.patient_messages for select to authenticated
using(private.can_read_patient_conversation_message(patient_id,sender_id,recipient_id));
create policy patient_messages_insert_participants on public.patient_messages for insert to authenticated
with check(patient_id is null and sender_id=(select auth.uid()) and sender_id<>recipient_id
 and private.can_read_patient_conversation_message(null,sender_id,recipient_id));

-- The invitation contract is unchanged; successful code linking creates an active account-pair conversation.
create or replace function public.accept_patient_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path='' set row_security='off'
as $$
declare v_uid uuid:=auth.uid();v_patient_id uuid;v_owner_id uuid;v_type text;
begin
 if v_uid is null then raise exception 'authentication_required' using errcode='28000';end if;
 select account_type into v_type from public.profiles where id=v_uid;
 if v_type is distinct from 'patient' then raise exception 'patient_account_required' using errcode='42501';end if;
 select i.patient_id,p.user_id into v_patient_id,v_owner_id from public.patient_invitations i
 join public.patients p on p.id=i.patient_id where i.token=p_token and i.accepted_at is null and i.revoked_at is null
 and i.expires_at>now() and p.archived_at is null and p.user_id is not null and p.user_id<>v_uid
 and exists(select 1 from public.profiles pr where pr.id=p.user_id and pr.account_type='professional') for update of i;
 if v_patient_id is null or v_owner_id is null then raise exception 'invitation_invalid_expired_or_used' using errcode='22023';end if;
 insert into public.patient_accounts(patient_id,user_id,status,linked_at) values(v_patient_id,v_uid,'active',now())
 on conflict(patient_id) do update set user_id=excluded.user_id,status='active',linked_at=now()
 where public.patient_accounts.status='revoked';
 if not found then
  if exists(select 1 from public.patient_accounts where patient_id=v_patient_id and user_id=v_uid and status='active') then
   update public.patient_invitations set accepted_at=now() where token=p_token;
   perform private.activate_patient_professional_conversation(v_uid,v_owner_id);return v_patient_id;
  end if;
  raise exception 'patient_record_already_linked' using errcode='23505';
 end if;
 update public.patient_invitations set accepted_at=now() where token=p_token;
 perform private.activate_patient_professional_conversation(v_uid,v_owner_id);return v_patient_id;
end;$$;
revoke all on function public.accept_patient_invitation(uuid) from public,anon;
grant execute on function public.accept_patient_invitation(uuid) to authenticated;
