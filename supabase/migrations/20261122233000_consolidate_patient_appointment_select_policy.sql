-- Keep one SELECT policy for appointments; merge owner and linked-care visibility.
drop policy if exists patient_appointments_select_professional_owned on public.patient_appointments;
drop policy if exists patient_appointments_select_participants on public.patient_appointments;

create policy patient_appointments_select_participants
on public.patient_appointments
for select to authenticated
using (
  exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = patient_appointments.patient_id
      and pa.user_id = (select auth.uid())
      and pa.status = 'active'
  )
  or (
    professional_id = (select auth.uid())
    and (
      private.is_active_patient_care_team_member(patient_id, (select auth.uid()))
      or exists (
        select 1 from public.patients p
        where p.id = patient_appointments.patient_id
          and p.user_id = (select auth.uid())
          and not exists (
            select 1 from public.professional_connection_requests r
            where r.patient_id = p.id
              and r.professional_id = (select auth.uid())
              and r.status in ('accepted','active')
          )
      )
    )
  )
);
