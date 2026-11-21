begin;

drop policy if exists patient_messages_select_participants on public.patient_messages;
create policy patient_messages_select_participants
  on public.patient_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_accounts pa
      where pa.patient_id = patient_messages.patient_id
        and pa.user_id = (select auth.uid())
        and pa.status = 'active'
    )
    or (
      (patient_messages.sender_id = (select auth.uid())
        or patient_messages.recipient_id = (select auth.uid()))
      and exists (
        select 1
        from public.patient_care_team pct
        where pct.patient_id = patient_messages.patient_id
          and pct.professional_id = (select auth.uid())
          and pct.status = 'active'
      )
    )
  );

drop function if exists public.mark_patient_messages_read(uuid);

create function public.mark_patient_messages_read(
  p_patient_id uuid,
  p_other_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null or p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Invalid conversation participants';
  end if;

  if not (
    exists (
      select 1
      from public.patient_accounts pa
      join public.patient_care_team pct
        on pct.patient_id = pa.patient_id
      where pa.patient_id = p_patient_id
        and pa.user_id = v_user_id
        and pa.status = 'active'
        and pct.professional_id = p_other_user_id
        and pct.status = 'active'
    )
    or exists (
      select 1
      from public.patient_care_team pct
      join public.patient_accounts pa
        on pa.patient_id = pct.patient_id
      where pct.patient_id = p_patient_id
        and pct.professional_id = v_user_id
        and pct.status = 'active'
        and pa.user_id = p_other_user_id
        and pa.status = 'active'
    )
  ) then
    raise exception 'Not authorized for this conversation';
  end if;

  update public.patient_messages
  set read_at = now()
  where patient_id = p_patient_id
    and recipient_id = v_user_id
    and sender_id = p_other_user_id
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_patient_messages_read(uuid, uuid) from public, anon;
grant execute on function public.mark_patient_messages_read(uuid, uuid) to authenticated;

commit;