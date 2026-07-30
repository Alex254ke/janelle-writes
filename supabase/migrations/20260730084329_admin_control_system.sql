-- Janelle Writes admin control system
--
-- This migration keeps production data intact. It adds an append-only audit log
-- and moves wallet reviews/task overrides into short, atomic database functions.
-- Apply only after the matching frontend has been reviewed.

begin;

create schema if not exists jw_private;
revoke all on schema jw_private from public, anon;

alter table public.jw_wallet_transactions
  add column if not exists review_note text;

create table if not exists public.jw_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_auth_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint jw_admin_audit_log_action_check
    check (action in (
      'wallet_approved',
      'wallet_rejected',
      'task_payment_overridden',
      'task_status_overridden'
    )),
  constraint jw_admin_audit_log_reason_check
    check (length(btrim(reason)) between 10 and 1000)
);

alter table public.jw_admin_audit_log enable row level security;

drop policy if exists "Admins can view admin audit log"
  on public.jw_admin_audit_log;
create policy "Admins can view admin audit log"
on public.jw_admin_audit_log for select to authenticated
using ((select public.is_jw_admin()));

revoke all on table public.jw_admin_audit_log from public, anon, authenticated;
grant select on table public.jw_admin_audit_log to authenticated;
grant all on table public.jw_admin_audit_log to service_role;

create index if not exists idx_jw_admin_audit_log_created_at
  on public.jw_admin_audit_log(created_at desc);
create index if not exists idx_jw_admin_audit_log_entity
  on public.jw_admin_audit_log(entity_type, entity_id, created_at desc);

create or replace function jw_private.admin_actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''));
$$;

revoke all on function jw_private.admin_actor_email()
  from public, anon, authenticated;

create or replace function jw_private.admin_resolve_wallet_transaction(
  p_tx_id uuid,
  p_decision text,
  p_review_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text := jw_private.admin_actor_email();
  wallet_tx public.jw_wallet_transactions%rowtype;
  task_row public.jw_tasks%rowtype;
  recipient public.jw_users%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_review_note text := btrim(coalesce(p_review_note, ''));
  available_balance numeric := 0;
  gross numeric := 0;
  v_commission_rate numeric := 0.12;
  v_commission_amount numeric := 0;
  v_writer_payout numeric := 0;
  recipient_email text := '';
  v_task_id text := '';
  is_order_payment boolean := false;
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null
     or v_actor_email = ''
     or not (select public.is_jw_admin()) then
    raise exception 'Admin access required';
  end if;

  if v_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if length(v_review_note) < 10 or length(v_review_note) > 1000 then
    raise exception 'Review note must be between 10 and 1000 characters';
  end if;

  select *
  into wallet_tx
  from public.jw_wallet_transactions
  where id = p_tx_id
  for update;

  if not found then
    raise exception 'Wallet request not found';
  end if;
  if wallet_tx.status <> 'pending_review' then
    raise exception 'Wallet request has already been reviewed';
  end if;

  -- Serialize all balance-changing decisions for one wallet. This prevents two
  -- simultaneous approvals from spending the same available balance.
  perform pg_advisory_xact_lock(
    hashtextextended(lower(wallet_tx.user_email), 731104)
  );

  if v_decision = 'approved'
     and wallet_tx.type in ('withdrawal', 'transfer_out') then
    select coalesce(sum(
      case
        when status = 'approved'
             and type in ('topup', 'transfer_in', 'admin_credit')
          then amount
        when status = 'approved'
             and type in ('withdrawal', 'transfer_out', 'admin_debit')
          then -amount
        else 0
      end
    ), 0)
    into available_balance
    from public.jw_wallet_transactions
    where lower(user_email) = lower(wallet_tx.user_email);

    if available_balance < wallet_tx.amount then
      raise exception 'Wallet balance is not enough for this request';
    end if;
  end if;

  if v_decision = 'approved' and wallet_tx.type = 'transfer_out' then
    is_order_payment :=
      lower(coalesce(wallet_tx.metadata ->> 'order_payment', 'false')) = 'true';
    v_task_id := nullif(btrim(coalesce(wallet_tx.metadata ->> 'task_id', '')), '');
    recipient_email := lower(coalesce(
      nullif(wallet_tx.metadata ->> 'writer_email', ''),
      nullif(wallet_tx.to_email, ''),
      ''
    ));

    if recipient_email = '' then
      raise exception 'Transfer recipient is required';
    end if;

    select *
    into recipient
    from public.jw_users
    where lower(email) = recipient_email
    limit 1;

    if not found then
      raise exception 'Transfer recipient account was not found';
    end if;

    gross := wallet_tx.amount;
    v_writer_payout := gross;

    if is_order_payment then
      if v_task_id is null then
        raise exception 'Order payment is missing its task reference';
      end if;

      select *
      into task_row
      from public.jw_tasks
      where id = v_task_id
      for update;

      if not found then
        raise exception 'Order linked to this wallet request was not found';
      end if;
      if lower(coalesce(task_row.posted_by, '')) <> lower(wallet_tx.user_email) then
        raise exception 'Wallet owner does not match the order owner';
      end if;
      if lower(coalesce(task_row.taken_by, '')) <> recipient_email then
        raise exception 'Transfer recipient does not match the assigned writer';
      end if;
      if task_row.status = 'cancelled' then
        raise exception 'A cancelled order cannot be paid';
      end if;
      if task_row.payment = 'paid' then
        raise exception 'The linked order is already paid';
      end if;

      v_commission_rate := coalesce(nullif(task_row.commission_rate, 0), 0.12);
      v_commission_amount := round(gross * v_commission_rate, 2);
      v_writer_payout := greatest(0, gross - v_commission_amount);
    end if;

    insert into public.jw_wallet_transactions (
      tx_ref,
      user_email,
      type,
      amount,
      from_email,
      source_tx,
      note,
      status,
      reviewed_by,
      reviewed_at,
      review_note,
      metadata
    ) values (
      'WAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
      lower(recipient.email),
      'transfer_in',
      v_writer_payout,
      lower(wallet_tx.user_email),
      wallet_tx.id::text,
      case
        when is_order_payment then 'Writer payout for order ' || v_task_id
        else 'Wallet transfer'
      end,
      'approved',
      v_actor_email,
      now_at,
      v_review_note,
      jsonb_build_object('source_type', 'admin_wallet_review')
    );

    if is_order_payment and v_commission_amount > 0 then
      insert into public.jw_wallet_transactions (
        tx_ref,
        user_email,
        type,
        amount,
        from_email,
        source_tx,
        note,
        status,
        reviewed_by,
        reviewed_at,
        review_note,
        metadata
      ) values (
        'WAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
        v_actor_email,
        'admin_credit',
        v_commission_amount,
        lower(wallet_tx.user_email),
        wallet_tx.id::text,
        'Platform fee for order ' || v_task_id,
        'approved',
        v_actor_email,
        now_at,
        v_review_note,
        jsonb_build_object('source_type', 'admin_wallet_review')
      );

      update public.jw_tasks
      set payment = 'paid',
          mpesa_code = wallet_tx.tx_ref,
          paid_at = now_at,
          commission_rate = v_commission_rate,
          commission_amount = v_commission_amount,
          writer_payout = v_writer_payout,
          commission_paid = true,
          admin_override_at = now_at,
          admin_override_by = v_actor_email
      where id = v_task_id;

      update public.jw_commission_ledger
      set order_total = gross,
          commission_rate = v_commission_rate,
          commission_amt = v_commission_amount,
          writer_payout = v_writer_payout,
          writer_email = task_row.taken_by,
          writer_name = task_row.taken_by_name,
          employer_email = task_row.posted_by,
          employer_name = task_row.posted_by_name,
          status = 'released',
          released_at = now_at
      where task_id = task_row.id;

      if not found then
        insert into public.jw_commission_ledger (
          task_id,
          order_total,
          commission_rate,
          commission_amt,
          writer_payout,
          writer_email,
          writer_name,
          employer_email,
          employer_name,
          status,
          released_at
        ) values (
          task_row.id,
          gross,
          v_commission_rate,
          v_commission_amount,
          v_writer_payout,
          task_row.taken_by,
          task_row.taken_by_name,
          task_row.posted_by,
          task_row.posted_by_name,
          'released',
          now_at
        );
      end if;
    end if;
  end if;

  update public.jw_wallet_transactions
  set status = v_decision,
      reviewed_by = v_actor_email,
      reviewed_at = now_at,
      review_note = v_review_note
  where id = wallet_tx.id;

  insert into public.jw_admin_audit_log (
    actor_auth_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    reason,
    before_state,
    after_state,
    metadata
  ) values (
    (select auth.uid()),
    v_actor_email,
    case when v_decision = 'approved' then 'wallet_approved' else 'wallet_rejected' end,
    'wallet_transaction',
    wallet_tx.id::text,
    v_review_note,
    jsonb_build_object(
      'status', wallet_tx.status,
      'type', wallet_tx.type,
      'amount', wallet_tx.amount
    ),
    jsonb_build_object(
      'status', v_decision,
      'reviewed_at', now_at
    ),
    jsonb_build_object(
      'tx_ref', wallet_tx.tx_ref,
      'user_email', lower(wallet_tx.user_email),
      'task_id', nullif(v_task_id, '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', wallet_tx.id,
    'decision', v_decision,
    'type', wallet_tx.type,
    'amount', wallet_tx.amount
  );
end;
$$;

revoke all on function jw_private.admin_resolve_wallet_transaction(uuid, text, text)
  from public, anon;
grant usage on schema jw_private to authenticated, service_role;
grant execute on function jw_private.admin_resolve_wallet_transaction(uuid, text, text)
  to authenticated, service_role;

create or replace function public.jw_admin_resolve_wallet_transaction(
  p_tx_id uuid,
  p_decision text,
  p_review_note text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jw_private.admin_resolve_wallet_transaction(
    p_tx_id,
    p_decision,
    p_review_note
  );
$$;

revoke all on function public.jw_admin_resolve_wallet_transaction(uuid, text, text)
  from public, anon;
grant execute on function public.jw_admin_resolve_wallet_transaction(uuid, text, text)
  to authenticated, service_role;

create or replace function jw_private.admin_override_task(
  p_task_id text,
  p_field text,
  p_value text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text := jw_private.admin_actor_email();
  task_row public.jw_tasks%rowtype;
  override_field text := lower(btrim(coalesce(p_field, '')));
  override_value text := lower(btrim(coalesce(p_value, '')));
  override_reason text := btrim(coalesce(p_reason, ''));
  previous_value text;
  now_at timestamptz := now();
  v_commission_rate numeric;
  v_commission_amount numeric;
  v_writer_payout numeric;
begin
  if (select auth.uid()) is null
     or v_actor_email = ''
     or not (select public.is_jw_admin()) then
    raise exception 'Admin access required';
  end if;
  if override_field not in ('payment', 'status') then
    raise exception 'This override field is not allowed';
  end if;
  if length(override_reason) < 10 or length(override_reason) > 1000 then
    raise exception 'Override reason must be between 10 and 1000 characters';
  end if;
  if override_field = 'payment' and override_value <> 'paid' then
    raise exception 'Payment overrides may only confirm a paid order';
  end if;
  if override_field = 'status'
     and override_value not in (
       'pending', 'progress', 'submitted', 'revision',
       'completed', 'cancelled', 'disputed', 'late'
     ) then
    raise exception 'Invalid task status value';
  end if;

  select *
  into task_row
  from public.jw_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'Task not found';
  end if;
  if task_row.status = 'cancelled'
     and (override_field = 'payment' or override_value = 'completed') then
    raise exception 'Cancelled orders cannot be marked paid or completed';
  end if;

  previous_value := case
    when override_field = 'payment' then task_row.payment
    else task_row.status
  end;
  if previous_value = override_value then
    raise exception 'The task already has this value';
  end if;

  if override_field = 'payment' then
    update public.jw_tasks
    set payment = override_value,
        paid_at = case when override_value = 'paid' then now_at else paid_at end,
        admin_override_at = now_at,
        admin_override_by = v_actor_email
    where id = task_row.id;

    if override_value = 'paid' and not coalesce(task_row.commission_paid, false) then
      v_commission_rate := coalesce(nullif(task_row.commission_rate, 0), 0.12);
      v_commission_amount := round(coalesce(task_row.total, 0) * v_commission_rate, 2);
      v_writer_payout := greatest(0, coalesce(task_row.total, 0) - v_commission_amount);

      update public.jw_tasks
      set commission_rate = v_commission_rate,
          commission_amount = v_commission_amount,
          writer_payout = v_writer_payout,
          commission_paid = true
      where id = task_row.id;

      update public.jw_commission_ledger
      set order_total = coalesce(task_row.total, 0),
          commission_rate = v_commission_rate,
          commission_amt = v_commission_amount,
          writer_payout = v_writer_payout,
          writer_email = task_row.taken_by,
          writer_name = task_row.taken_by_name,
          employer_email = task_row.posted_by,
          employer_name = task_row.posted_by_name,
          status = 'released',
          released_at = now_at
      where task_id = task_row.id;

      if not found then
        insert into public.jw_commission_ledger (
          task_id,
          order_total,
          commission_rate,
          commission_amt,
          writer_payout,
          writer_email,
          writer_name,
          employer_email,
          employer_name,
          status,
          released_at
        ) values (
          task_row.id,
          coalesce(task_row.total, 0),
          v_commission_rate,
          v_commission_amount,
          v_writer_payout,
          task_row.taken_by,
          task_row.taken_by_name,
          task_row.posted_by,
          task_row.posted_by_name,
          'released',
          now_at
        );
      end if;
    end if;
  else
    update public.jw_tasks
    set status = override_value,
        admin_override_at = now_at,
        admin_override_by = v_actor_email
    where id = task_row.id;
  end if;

  insert into public.jw_admin_audit_log (
    actor_auth_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    reason,
    before_state,
    after_state
  ) values (
    (select auth.uid()),
    v_actor_email,
    case
      when override_field = 'payment' then 'task_payment_overridden'
      else 'task_status_overridden'
    end,
    'task',
    task_row.id,
    override_reason,
    jsonb_build_object(override_field, previous_value),
    jsonb_build_object(override_field, override_value)
  );

  return jsonb_build_object(
    'ok', true,
    'task_id', task_row.id,
    'field', override_field,
    'previous_value', previous_value,
    'value', override_value
  );
end;
$$;

revoke all on function jw_private.admin_override_task(text, text, text, text)
  from public, anon;
grant execute on function jw_private.admin_override_task(text, text, text, text)
  to authenticated, service_role;

create or replace function public.jw_admin_override_task(
  p_task_id text,
  p_field text,
  p_value text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jw_private.admin_override_task(
    p_task_id,
    p_field,
    p_value,
    p_reason
  );
$$;

revoke all on function public.jw_admin_override_task(text, text, text, text)
  from public, anon;
grant execute on function public.jw_admin_override_task(text, text, text, text)
  to authenticated, service_role;

-- Browser clients can create their own pending requests and read their ledger,
-- but only the reviewed RPC may change or delete wallet records.
revoke update, delete on table public.jw_wallet_transactions from authenticated;
grant select, insert on table public.jw_wallet_transactions to authenticated;

commit;
