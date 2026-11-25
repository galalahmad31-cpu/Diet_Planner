-- Remove the subscription audit subsystem and keep subscription creation independent from audit records.
begin;

drop function if exists public.start_subscription_audit(uuid, text);
drop function if exists public.finish_subscription_audit(uuid, boolean, text);

drop function if exists public.create_subscription(uuid, text, text, text, uuid);

create function public.create_subscription(
  p_plan_id uuid,
  p_full_name text default null,
  p_notes text default null,
  p_payment_proof_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_plan public.subscription_plans%rowtype;
  v_existing_trial boolean;
  v_has_active boolean;
  v_result public.subscriptions;
  v_error text;
  v_provider text;
  v_provider_id text;
  v_email text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  begin
    if public.is_admin() then
      raise exception 'Admins manage subscriptions directly';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

    select *
    into v_plan
    from public.subscription_plans
    where id = p_plan_id and is_active = true
    for share;

    if not found then
      raise exception 'Subscription plan is not available';
    end if;

    if v_plan.duration_days is null or v_plan.duration_days <= 0 then
      raise exception 'Invalid plan duration';
    end if;

    if v_plan.is_free_trial then
      if p_payment_proof_path is not null then
        raise exception 'Free-trial requests must not include a payment proof';
      end if;

      select i.provider,
             coalesce(i.identity_data->>'sub', i.id::text),
             u.email
      into v_provider, v_provider_id, v_email
      from auth.identities i
      join auth.users u on u.id = i.user_id
      where i.user_id = v_user_id
        and i.provider in ('google', 'email')
      order by case when i.provider = 'google' then 0 else 1 end, i.created_at
      limit 1;

      if v_provider is null then
        raise exception 'No supported authentication identity found';
      end if;

      select exists (
        select 1
        from public.trial_claims tc
        where tc.provider = v_provider
          and tc.provider_id = v_provider_id
      )
      into v_existing_trial;

      if v_existing_trial then
        raise exception 'Free trial has already been used';
      end if;
    else
      if p_payment_proof_path is null
         or left(p_payment_proof_path, length(v_user_id::text) + 1) <> v_user_id::text || '/' then
        raise exception 'A payment proof uploaded to your own account folder is required';
      end if;

      if not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'subscription-proofs'
          and o.name = p_payment_proof_path
          and split_part(o.name, '/', 1) = v_user_id::text
      ) then
        raise exception 'Payment proof was not found in your account folder';
      end if;
    end if;

    select exists (
      select 1
      from public.subscriptions
      where user_id = v_user_id
        and is_free_trial = true
    )
    into v_existing_trial;

    if v_plan.is_free_trial and v_existing_trial then
      raise exception 'Free trial has already been used';
    end if;

    select exists (
      select 1
      from public.subscriptions
      where user_id = v_user_id
        and status = 'paid'
        and start_date <= current_date
        and expiry_date >= current_date
    )
    into v_has_active;

    if v_plan.is_free_trial and v_has_active then
      raise exception 'You already have an active subscription';
    end if;

    perform set_config('app.internal_subscription_change', 'cancel_pending', true);

    update public.subscriptions
    set status = 'canceled',
        updated_at = now()
    where user_id = v_user_id
      and status = 'pending';

    perform set_config('app.internal_subscription_change', '', true);

    if v_plan.is_free_trial then
      perform set_config('app.internal_subscription_change', 'create_free_trial', true);
    end if;

    insert into public.subscriptions (
      user_id,
      status,
      notes,
      full_name,
      plan_id,
      payment_proof_path,
      is_free_trial,
      duration_days_snapshot
    )
    values (
      v_user_id,
      case when v_plan.is_free_trial then 'paid' else 'pending' end,
      p_notes,
      p_full_name,
      v_plan.id,
      p_payment_proof_path,
      v_plan.is_free_trial,
      v_plan.duration_days
    )
    returning * into v_result;

    perform set_config('app.internal_subscription_change', '', true);

    if v_plan.is_free_trial then
      insert into public.trial_claims (
        user_id,
        provider,
        provider_id,
        email_key,
        subscription_id
      )
      values (
        v_user_id,
        v_provider,
        v_provider_id,
        null,
        v_result.id
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'subscription', to_jsonb(v_result)
    );
  exception when others then
    v_error := sqlerrm;
    perform set_config('app.internal_subscription_change', '', true);
    raise log 'create_subscription failed: user_id=% plan_id=% error=%',
      v_user_id, p_plan_id, v_error;
    return jsonb_build_object('success', false, 'error', v_error);
  end;
end;
$function$;

alter function public.create_subscription(uuid, text, text, text) owner to postgres;
revoke all on function public.create_subscription(uuid, text, text, text) from public, anon;
grant execute on function public.create_subscription(uuid, text, text, text) to authenticated, service_role;

drop policy if exists subscription_audit_admin_select on public.subscription_audit;
drop table if exists public.subscription_audit;

commit;
