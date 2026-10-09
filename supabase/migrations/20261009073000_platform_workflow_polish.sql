-- Reliable disputes, deadline extensions, ratings, and a 5% platform fee.
-- Existing settled payments keep their historical fee; only unsettled work is
-- moved to the new rate.

begin;

alter table public.jw_tasks
  add column if not exists deadline_extensions jsonb not null default '[]'::jsonb;

alter table public.jw_tasks
  alter column commission_rate set default 0.05;

alter table public.jw_commission_ledger
  alter column commission_rate set default 0.05;

-- This is a controlled owner-run migration. Temporarily suspend the browser
-- finance guard only for the bulk rate recalculation, then restore it before
-- any other workflow changes are installed.
alter table public.jw_tasks
  disable trigger trg_jw_block_non_admin_finance_changes;

update public.jw_tasks
set commission_rate = 0.05,
    commission_amount = round(coalesce(total, 0) * 0.05, 2),
    writer_payout = greatest(0, coalesce(total, 0) - round(coalesce(total, 0) * 0.05, 2))
where not coalesce(commission_paid, false);

alter table public.jw_tasks
  enable trigger trg_jw_block_non_admin_finance_changes;

update public.jw_commission_ledger
set commission_rate = 0.05,
    commission_amt = round(coalesce(order_total, 0) * 0.05, 2),
    writer_payout = greatest(0, coalesce(order_total, 0) - round(coalesce(order_total, 0) * 0.05, 2))
where coalesce(status, 'pending') <> 'released';

-- Keep the existing audited admin functions intact while changing their
-- fallback rate for legacy rows whose commission_rate is zero or null.
do $$
declare
  function_row record;
  function_definition text;
begin
  for function_row in
    select p.oid
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'jw_private'
      and p.prokind = 'f'
      and p.proname in ('admin_override_task', 'admin_resolve_wallet_transaction')
  loop
    function_definition := pg_get_functiondef(function_row.oid);
    execute replace(function_definition, '0.12', '0.05');
  end loop;
end
$$;

-- Preserve the guarded workflow, but allow the narrow dispute resolution RPC
-- below to restore legacy tasks that were previously moved to `disputed`.
create or replace function jw_private.guard_task_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_role text := lower(coalesce((select auth.jwt()) ->> 'role', ''));
  is_owner boolean := actor_email <> ''
    and actor_email = lower(coalesce(old.posted_by, ''));
  is_writer boolean := actor_email <> ''
    and actor_email = lower(coalesce(old.taken_by, ''));
  allowed boolean := false;
begin
  if actor_role = 'service_role' or (select public.is_jw_admin()) then
    return new;
  end if;

  if current_setting('jw.workflow_rpc', true) = 'resolve_dispute' then
    return new;
  end if;

  if new.client_request_id is distinct from old.client_request_id
     or new.duplicate_of is distinct from old.duplicate_of then
    raise exception 'Task identity fields are server-managed';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if is_owner then
    allowed :=
      (old.status = 'pending' and new.status in ('progress', 'late', 'cancelled', 'disputed'))
      or (old.status in ('progress', 'in_progress') and new.status in ('late', 'disputed'))
      or (old.status = 'late' and new.status = 'disputed')
      or (old.status = 'submitted' and new.status in ('revision', 'disputed'))
      or (
        old.status = 'submitted'
        and new.status = 'completed'
        and new.payment = 'paid'
      );
  end if;

  if is_writer then
    allowed := allowed
      or (old.status in ('progress', 'in_progress', 'late', 'revision')
          and new.status in ('submitted', 'disputed'))
      or (old.status in ('progress', 'in_progress') and new.status = 'late');
  end if;

  if not allowed then
    raise exception 'This task status transition is not allowed for your account';
  end if;

  return new;
end
$$;

revoke all on function jw_private.guard_task_workflow()
  from public, anon, authenticated;

create or replace function public.jw_open_dispute(
  p_task_id text,
  p_reason text,
  p_requested_outcome text,
  p_note text
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_name text;
  actor_role text;
  task_row public.jw_tasks%rowtype;
  dispute_id text := 'DSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  reason_value text := btrim(coalesce(p_reason, ''));
  outcome_value text := btrim(coalesce(p_requested_outcome, ''));
  note_value text := btrim(coalesce(p_note, ''));
  recipient_email text;
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to open a dispute';
  end if;
  if length(reason_value) < 3 or length(reason_value) > 160 then
    raise exception 'Choose a valid dispute reason';
  end if;
  if length(outcome_value) < 3 or length(outcome_value) > 200 then
    raise exception 'Choose a valid requested outcome';
  end if;
  if length(note_value) < 10 or length(note_value) > 5000 then
    raise exception 'Dispute details must be between 10 and 5000 characters';
  end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;
  if task_row.status = 'cancelled' then
    raise exception 'Cancelled tasks cannot open a new dispute';
  end if;
  if not (
    (select public.is_jw_admin())
    or actor_email = lower(coalesce(task_row.posted_by, ''))
    or actor_email = lower(coalesce(task_row.taken_by, ''))
  ) then
    raise exception 'Only task participants can open a dispute';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(task_row.disputes, '[]'::jsonb)) as item
    where lower(coalesce(item ->> 'status', 'open')) = 'open'
  ) then
    raise exception 'This task already has an open dispute';
  end if;

  select coalesce(nullif(name, ''), actor_email), lower(coalesce(role, 'user'))
  into actor_name, actor_role
  from public.jw_users
  where auth_id = (select auth.uid())
  limit 1;

  update public.jw_tasks
  set disputes = jsonb_build_array(jsonb_build_object(
        'id', dispute_id,
        'status', 'open',
        'reason', reason_value,
        'requested_outcome', outcome_value,
        'note', note_value,
        'opened_by_role', coalesce(actor_role, 'user'),
        'opened_by_name', coalesce(actor_name, actor_email),
        'opened_by_email', actor_email,
        'created_at', now_at,
        'previous_status', status,
        'responses', '[]'::jsonb
      )) || coalesce(disputes, '[]'::jsonb)
  where id = task_row.id
  returning * into task_row;

  recipient_email := case
    when actor_email = lower(coalesce(task_row.posted_by, ''))
      then lower(coalesce(task_row.taken_by, ''))
    else lower(coalesce(task_row.posted_by, ''))
  end;

  if recipient_email <> '' then
    insert into public.jw_notifications (
      user_email, actor_email, task_id, type, title, body, event_key, metadata
    ) values (
      recipient_email,
      actor_email,
      task_row.id,
      'dispute',
      'Dispute opened',
      task_row.id || ' — ' || reason_value || '. Open the dispute center to review it.',
      'dispute-opened:' || task_row.id || ':' || dispute_id,
      jsonb_build_object('page', 'disputes', 'dispute_id', dispute_id)
    ) on conflict do nothing;
  end if;

  return task_row;
end
$$;

create or replace function public.jw_resolve_dispute(
  p_task_id text,
  p_action text default 'resolved',
  p_resolution_type text default 'standard',
  p_note text default '',
  p_new_deadline date default null
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_name text;
  actor_role text;
  task_row public.jw_tasks%rowtype;
  open_dispute jsonb;
  next_disputes jsonb;
  action_value text := lower(btrim(coalesce(p_action, 'resolved')));
  resolution_value text := lower(btrim(coalesce(p_resolution_type, 'standard')));
  note_value text := btrim(coalesce(p_note, ''));
  is_admin boolean := false;
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to resolve a dispute';
  end if;
  if action_value not in ('resolved', 'withdrawn') then
    raise exception 'Invalid dispute action';
  end if;
  if resolution_value not in ('standard', 'extend_deadline', 'admin_override', 'withdrawn') then
    raise exception 'Invalid dispute resolution type';
  end if;
  if length(note_value) > 5000 then
    raise exception 'Resolution note is too long';
  end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;

  select item into open_dispute
  from jsonb_array_elements(coalesce(task_row.disputes, '[]'::jsonb)) with ordinality as dispute(item, position)
  where lower(coalesce(item ->> 'status', 'open')) = 'open'
  order by position
  limit 1;

  if open_dispute is null then raise exception 'No open dispute found'; end if;
  is_admin := (select public.is_jw_admin());

  if action_value = 'withdrawn' then
    if not is_admin and actor_email <> lower(coalesce(open_dispute ->> 'opened_by_email', '')) then
      raise exception 'Only the dispute opener or admin can withdraw it';
    end if;
    resolution_value := 'withdrawn';
  elsif not (
    is_admin or actor_email = lower(coalesce(task_row.posted_by, ''))
  ) then
    raise exception 'Only the task owner or admin can resolve this dispute';
  end if;

  if resolution_value = 'extend_deadline' then
    if p_new_deadline is null then raise exception 'Choose a new deadline'; end if;
    if p_new_deadline <= greatest(coalesce(task_row.deadline, current_date), current_date) then
      raise exception 'The new deadline must be later than the current deadline';
    end if;
  end if;

  select coalesce(nullif(name, ''), actor_email), lower(coalesce(role, 'user'))
  into actor_name, actor_role
  from public.jw_users
  where auth_id = (select auth.uid())
  limit 1;

  select coalesce(jsonb_agg(
    case
      when item ->> 'id' = open_dispute ->> 'id' then
        item || jsonb_strip_nulls(jsonb_build_object(
          'status', action_value,
          'resolution_type', resolution_value,
          'resolution_note', coalesce(nullif(note_value, ''), case when action_value = 'withdrawn' then 'Withdrawn by the opener.' else 'Resolved after review.' end),
          'extended_deadline_to', case when resolution_value = 'extend_deadline' then to_jsonb(p_new_deadline) else null end,
          'resolved_by_name', coalesce(actor_name, actor_email),
          'resolved_by_email', actor_email,
          'resolved_by_role', coalesce(actor_role, 'user'),
          'resolved_at', now_at,
          'admin_override', is_admin
        ))
      else item
    end
    order by position
  ), '[]'::jsonb)
  into next_disputes
  from jsonb_array_elements(coalesce(task_row.disputes, '[]'::jsonb)) with ordinality as dispute(item, position);

  perform set_config('jw.workflow_rpc', 'resolve_dispute', true);

  update public.jw_tasks
  set disputes = next_disputes,
      deadline = case when resolution_value = 'extend_deadline' then p_new_deadline else deadline end,
      status = case
        when status = 'disputed' then
          case
            when coalesce(open_dispute ->> 'previous_status', '') in (
              'pending', 'progress', 'in_progress', 'late', 'submitted', 'completed', 'revision'
            ) then open_dispute ->> 'previous_status'
            when taken_by is null then 'pending'
            else 'progress'
          end
        else status
      end
  where id = task_row.id
  returning * into task_row;

  return task_row;
end
$$;

create or replace function public.jw_extend_task_deadline(
  p_task_id text,
  p_new_deadline date,
  p_note text default ''
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  task_row public.jw_tasks%rowtype;
  extension_id text := 'EXT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  note_value text := btrim(coalesce(p_note, ''));
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to extend a deadline';
  end if;
  if p_new_deadline is null then raise exception 'Choose a new deadline'; end if;
  if length(note_value) > 2000 then raise exception 'Extension note is too long'; end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;
  if not ((select public.is_jw_admin()) or actor_email = lower(coalesce(task_row.posted_by, ''))) then
    raise exception 'Only the task owner or admin can extend this deadline';
  end if;
  if task_row.status in ('completed', 'cancelled') then
    raise exception 'This task is already closed';
  end if;
  if p_new_deadline <= greatest(coalesce(task_row.deadline, current_date), current_date) then
    raise exception 'The new deadline must be later than the current deadline';
  end if;

  update public.jw_tasks
  set deadline = p_new_deadline,
      deadline_extensions = jsonb_build_array(jsonb_build_object(
        'id', extension_id,
        'status', 'approved',
        'requested_by_email', actor_email,
        'requested_by_role', 'owner',
        'requested_deadline', p_new_deadline,
        'previous_deadline', deadline,
        'reason', coalesce(nullif(note_value, ''), 'Deadline extended by task owner.'),
        'created_at', now_at,
        'decided_at', now_at,
        'decided_by_email', actor_email
      )) || coalesce(deadline_extensions, '[]'::jsonb)
  where id = task_row.id
  returning * into task_row;

  if lower(coalesce(task_row.taken_by, '')) <> '' then
    insert into public.jw_notifications (
      user_email, actor_email, task_id, type, title, body, event_key, metadata
    ) values (
      lower(task_row.taken_by), actor_email, task_row.id, 'general',
      'Deadline extended',
      task_row.id || ' — the deadline is now ' || p_new_deadline::text || '.',
      'deadline-extended:' || task_row.id || ':' || extension_id,
      jsonb_build_object('page', 'task-details', 'deadline', p_new_deadline)
    ) on conflict do nothing;
  end if;

  return task_row;
end
$$;

create or replace function public.jw_request_deadline_extension(
  p_task_id text,
  p_requested_deadline date,
  p_reason text
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_name text;
  task_row public.jw_tasks%rowtype;
  request_id text := 'EXT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  reason_value text := btrim(coalesce(p_reason, ''));
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to request more time';
  end if;
  if p_requested_deadline is null then raise exception 'Choose a requested deadline'; end if;
  if length(reason_value) < 10 or length(reason_value) > 2000 then
    raise exception 'Extension reason must be between 10 and 2000 characters';
  end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;
  if actor_email <> lower(coalesce(task_row.taken_by, '')) then
    raise exception 'Only the assigned writer can request a deadline extension';
  end if;
  if task_row.status not in ('progress', 'in_progress', 'late', 'revision') then
    raise exception 'This task is not open for a deadline extension request';
  end if;
  if p_requested_deadline <= greatest(coalesce(task_row.deadline, current_date), current_date) then
    raise exception 'The requested deadline must be later than the current deadline';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(task_row.deadline_extensions, '[]'::jsonb)) as item
    where lower(coalesce(item ->> 'status', '')) = 'pending'
  ) then
    raise exception 'A deadline extension request is already pending';
  end if;

  select coalesce(nullif(name, ''), actor_email)
  into actor_name
  from public.jw_users
  where auth_id = (select auth.uid())
  limit 1;

  update public.jw_tasks
  set deadline_extensions = jsonb_build_array(jsonb_build_object(
        'id', request_id,
        'status', 'pending',
        'requested_by_email', actor_email,
        'requested_by_name', coalesce(actor_name, actor_email),
        'requested_by_role', 'writer',
        'requested_deadline', p_requested_deadline,
        'previous_deadline', deadline,
        'reason', reason_value,
        'created_at', now_at
      )) || coalesce(deadline_extensions, '[]'::jsonb)
  where id = task_row.id
  returning * into task_row;

  insert into public.jw_notifications (
    user_email, actor_email, task_id, type, title, body, event_key, metadata
  ) values (
    lower(task_row.posted_by), actor_email, task_row.id, 'general',
    'Deadline extension requested',
    task_row.id || ' — ' || coalesce(actor_name, 'The writer') || ' requested a new deadline of ' || p_requested_deadline::text || '.',
    'deadline-requested:' || task_row.id || ':' || request_id,
    jsonb_build_object('page', 'task-details', 'request_id', request_id, 'requested_deadline', p_requested_deadline)
  ) on conflict do nothing;

  return task_row;
end
$$;

create or replace function public.jw_respond_deadline_extension(
  p_task_id text,
  p_request_id text,
  p_decision text,
  p_new_deadline date default null,
  p_note text default ''
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  task_row public.jw_tasks%rowtype;
  request_row jsonb;
  next_extensions jsonb;
  decision_value text := lower(btrim(coalesce(p_decision, '')));
  chosen_deadline date;
  note_value text := btrim(coalesce(p_note, ''));
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to review this request';
  end if;
  if decision_value not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if length(note_value) > 2000 then raise exception 'Decision note is too long'; end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;
  if not ((select public.is_jw_admin()) or actor_email = lower(coalesce(task_row.posted_by, ''))) then
    raise exception 'Only the task owner or admin can review this request';
  end if;

  select item into request_row
  from jsonb_array_elements(coalesce(task_row.deadline_extensions, '[]'::jsonb)) as item
  where item ->> 'id' = p_request_id
    and lower(coalesce(item ->> 'status', '')) = 'pending'
  limit 1;

  if request_row is null then raise exception 'Pending extension request not found'; end if;

  if decision_value = 'approved' then
    chosen_deadline := coalesce(p_new_deadline, (request_row ->> 'requested_deadline')::date);
    if chosen_deadline <= greatest(coalesce(task_row.deadline, current_date), current_date) then
      raise exception 'The approved deadline must be later than the current deadline';
    end if;
  end if;

  select coalesce(jsonb_agg(
    case
      when item ->> 'id' = p_request_id then
        item || jsonb_strip_nulls(jsonb_build_object(
          'status', decision_value,
          'approved_deadline', case when decision_value = 'approved' then to_jsonb(chosen_deadline) else null end,
          'decision_note', nullif(note_value, ''),
          'decided_at', now_at,
          'decided_by_email', actor_email
        ))
      else item
    end
    order by position
  ), '[]'::jsonb)
  into next_extensions
  from jsonb_array_elements(coalesce(task_row.deadline_extensions, '[]'::jsonb)) with ordinality as ext(item, position);

  update public.jw_tasks
  set deadline_extensions = next_extensions,
      deadline = case when decision_value = 'approved' then chosen_deadline else deadline end
  where id = task_row.id
  returning * into task_row;

  insert into public.jw_notifications (
    user_email, actor_email, task_id, type, title, body, event_key, metadata
  ) values (
    lower(coalesce(request_row ->> 'requested_by_email', task_row.taken_by)),
    actor_email,
    task_row.id,
    'general',
    case when decision_value = 'approved' then 'Deadline extension approved' else 'Deadline extension declined' end,
    task_row.id || ' — your deadline extension request was ' || decision_value || '.',
    'deadline-decision:' || task_row.id || ':' || p_request_id || ':' || decision_value,
    jsonb_build_object('page', 'task-details', 'request_id', p_request_id, 'decision', decision_value)
  ) on conflict do nothing;

  return task_row;
end
$$;

create or replace function public.jw_rate_task(
  p_task_id text,
  p_score integer,
  p_comment text default ''
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_name text;
  actor_role text;
  task_row public.jw_tasks%rowtype;
  rating_key text;
  target_email text;
  target_name text;
  target_type text;
  comment_value text := btrim(coalesce(p_comment, ''));
  rating_value jsonb;
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to rate a completed task';
  end if;
  if p_score < 1 or p_score > 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if length(comment_value) > 2000 then raise exception 'Rating comment is too long'; end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id and duplicate_of is null
  for update;

  if not found then raise exception 'Task not found'; end if;
  if task_row.status <> 'completed' then raise exception 'Ratings are available after completion'; end if;

  select coalesce(nullif(name, ''), actor_email), lower(coalesce(role, 'user'))
  into actor_name, actor_role
  from public.jw_users
  where auth_id = (select auth.uid())
  limit 1;

  if actor_email = lower(coalesce(task_row.posted_by, '')) then
    if lower(coalesce(task_row.taken_by, '')) = '' then raise exception 'This task has no assigned writer'; end if;
    rating_key := 'writer_by_employer';
    target_email := lower(task_row.taken_by);
    target_name := task_row.taken_by_name;
    target_type := 'writer';
  elsif actor_email = lower(coalesce(task_row.taken_by, '')) then
    rating_key := 'employer_by_writer';
    target_email := lower(task_row.posted_by);
    target_name := task_row.posted_by_name;
    target_type := 'employer';
  else
    raise exception 'Only task participants can rate this task';
  end if;

  rating_value := jsonb_strip_nulls(jsonb_build_object(
    'score', p_score,
    'comment', nullif(comment_value, ''),
    'by_email', actor_email,
    'by_name', coalesce(actor_name, actor_email),
    'by_role', coalesce(actor_role, 'user'),
    'for_email', target_email,
    'for_name', target_name,
    'target_type', target_type,
    'at', now()
  ));

  update public.jw_tasks
  set ratings = jsonb_set(coalesce(ratings, '{}'::jsonb), array[rating_key], rating_value, true)
  where id = task_row.id
  returning * into task_row;

  return task_row;
end
$$;

-- Include an aggregate reputation summary in the deliberately public writer
-- profile payload. No task subjects, counterparties, comments, or private
-- contact fields are exposed.
create or replace function public.jw_get_public_writer_profile_v2(p_email text)
returns table (
  email text,
  name text,
  role text,
  profile jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with account as (
    select u.email, u.name, u.role, u.profile
    from public.jw_users as u
    where (select auth.uid()) is not null
      and lower(u.email) = lower(trim(coalesce(p_email, '')))
      and lower(coalesce(u.role, '')) = 'writer'
    limit 1
  ), rating_rows as (
    select (task.ratings -> 'writer_by_employer' ->> 'score')::numeric as score
    from public.jw_tasks as task
    join account on lower(coalesce(task.taken_by, '')) = lower(account.email)
    where task.ratings -> 'writer_by_employer' ->> 'score' ~ '^[1-5]([.][0-9]+)?$'
  ), rating_summary as (
    select coalesce(round(avg(score), 2), 0) as average, count(*)::integer as count
    from rating_rows
  )
  select
    lower(account.email),
    account.name,
    'writer'::text,
    jsonb_strip_nulls(jsonb_build_object(
      'name', account.profile -> 'name',
      'title', account.profile -> 'title',
      'bio', account.profile -> 'bio',
      'photo', account.profile -> 'photo',
      'location', account.profile -> 'location',
      'timezone', account.profile -> 'timezone',
      'languages', account.profile -> 'languages',
      'availability', account.profile -> 'availability',
      'rate', account.profile -> 'rate',
      'skills', account.profile -> 'skills',
      'education', account.profile -> 'education',
      'experience', account.profile -> 'experience',
      'rating_summary', jsonb_build_object(
        'average', rating_summary.average,
        'count', rating_summary.count
      )
    ))
  from account
  cross join rating_summary;
$$;

revoke all on function public.jw_open_dispute(text, text, text, text) from public, anon;
revoke all on function public.jw_resolve_dispute(text, text, text, text, date) from public, anon;
revoke all on function public.jw_extend_task_deadline(text, date, text) from public, anon;
revoke all on function public.jw_request_deadline_extension(text, date, text) from public, anon;
revoke all on function public.jw_respond_deadline_extension(text, text, text, date, text) from public, anon;
revoke all on function public.jw_rate_task(text, integer, text) from public, anon;
revoke all on function public.jw_get_public_writer_profile_v2(text) from public, anon;

grant execute on function public.jw_open_dispute(text, text, text, text) to authenticated, service_role;
grant execute on function public.jw_resolve_dispute(text, text, text, text, date) to authenticated, service_role;
grant execute on function public.jw_extend_task_deadline(text, date, text) to authenticated, service_role;
grant execute on function public.jw_request_deadline_extension(text, date, text) to authenticated, service_role;
grant execute on function public.jw_respond_deadline_extension(text, text, text, date, text) to authenticated, service_role;
grant execute on function public.jw_rate_task(text, integer, text) to authenticated, service_role;
grant execute on function public.jw_get_public_writer_profile_v2(text) to authenticated, service_role;

commit;
