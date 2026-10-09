-- Janelle Writes realtime task and submission-review workflow
--
-- This migration preserves production records. The known duplicate order is
-- retained and marked as a duplicate so admins can still audit it, while normal
-- workspaces see only the richer canonical record.

begin;

create schema if not exists jw_private;
revoke all on schema jw_private from public, anon;

alter table public.jw_tasks
  add column if not exists client_request_id uuid,
  add column if not exists duplicate_of text,
  add column if not exists instruction_link text not null default '',
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists review_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jw_tasks_duplicate_of_fkey'
      and conrelid = 'public.jw_tasks'::regclass
  ) then
    alter table public.jw_tasks
      add constraint jw_tasks_duplicate_of_fkey
      foreign key (duplicate_of)
      references public.jw_tasks(id)
      on delete restrict;
  end if;
end
$$;

create unique index if not exists uq_jw_tasks_client_request_id
  on public.jw_tasks(client_request_id)
  where client_request_id is not null;

create index if not exists idx_jw_tasks_visible_created_at
  on public.jw_tasks(created_at desc)
  where duplicate_of is null;

create index if not exists idx_jw_tasks_owner_visible
  on public.jw_tasks(lower(posted_by), created_at desc)
  where duplicate_of is null;

create index if not exists idx_jw_tasks_writer_visible
  on public.jw_tasks(lower(taken_by), created_at desc)
  where duplicate_of is null and taken_by is not null;

create index if not exists idx_jw_tasks_status_visible
  on public.jw_tasks(status, created_at desc)
  where duplicate_of is null;

alter table public.jw_tasks
  drop constraint if exists jw_tasks_status_check;
alter table public.jw_tasks
  add constraint jw_tasks_status_check
  check (status in (
    'pending',
    'progress',
    'in_progress',
    'late',
    'submitted',
    'completed',
    'revision',
    'cancelled',
    'disputed'
  ));

alter table public.jw_notifications
  drop constraint if exists jw_notifications_type_check;
alter table public.jw_notifications
  add constraint jw_notifications_type_check
  check (type in (
    'revision',
    'bid',
    'assigned',
    'paid',
    'submitted',
    'message',
    'wallet',
    'dispute',
    'review',
    'general'
  ));

-- Preserve both production rows. The suffixed row contains the fuller
-- submission, more messages, and the posted review, so it is canonical.
update public.jw_tasks
set duplicate_of = 'JW-DM-RHL-0001-8XV4'
where id = 'JW-DM-RHL-0001'
  and duplicate_of is null
  and exists (
    select 1
    from public.jw_tasks canonical
    where canonical.id = 'JW-DM-RHL-0001-8XV4'
      and lower(canonical.posted_by) = lower(public.jw_tasks.posted_by)
      and lower(canonical.subject) = lower(public.jw_tasks.subject)
  );

-- The two recent unpaid records were auto-completed by the old client. Move
-- them to the new review state without changing files, messages, bids, or data.
update public.jw_tasks
set status = 'submitted',
    submitted_at = coalesce(
      submitted_at,
      nullif(ratings #>> '{__timing,submitted_at}', '')::timestamptz,
      created_at
    ),
    reviewed_at = null,
    reviewed_by = null,
    review_note = null
where status = 'completed'
  and payment <> 'paid'
  and (
    coalesce(jsonb_array_length(submitted_files), 0) > 0
    or coalesce(submitted_link, '') <> ''
    or coalesce(submitted_text, '') <> ''
  );

drop policy if exists jw_tasks_select_relevant on public.jw_tasks;
create policy jw_tasks_select_relevant
on public.jw_tasks
for select
to authenticated
using (
  (select public.is_jw_admin())
  or (
    duplicate_of is null
    and (
      lower(coalesce(posted_by, '')) =
        lower(coalesce((select auth.jwt()) ->> 'email', ''))
      or lower(coalesce(taken_by, '')) =
        lower(coalesce((select auth.jwt()) ->> 'email', ''))
      or (taken_by is null and status = 'pending')
    )
  )
);

create or replace function jw_private.guard_task_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  actor_role text := lower(coalesce((select auth.role()), ''));
  is_owner boolean := actor_email <> ''
    and actor_email = lower(coalesce(old.posted_by, ''));
  is_writer boolean := actor_email <> ''
    and actor_email = lower(coalesce(old.taken_by, ''));
  allowed boolean := false;
begin
  if actor_role = 'service_role' or (select public.is_jw_admin()) then
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

drop trigger if exists trg_jw_tasks_workflow_guard on public.jw_tasks;
create trigger trg_jw_tasks_workflow_guard
before update of status, client_request_id, duplicate_of
on public.jw_tasks
for each row
execute function jw_private.guard_task_workflow();

create or replace function public.jw_submit_task(
  p_task_id text,
  p_submitted_files jsonb default '[]'::jsonb,
  p_submitted_link text default '',
  p_submitted_text text default '',
  p_submitted_notes text default ''
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  task_row public.jw_tasks%rowtype;
  now_at timestamptz := now();
  files jsonb := coalesce(p_submitted_files, '[]'::jsonb);
  link_value text := btrim(coalesce(p_submitted_link, ''));
  text_value text := btrim(coalesce(p_submitted_text, ''));
  notes_value text := btrim(coalesce(p_submitted_notes, ''));
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to submit work';
  end if;

  select *
  into task_row
  from public.jw_tasks
  where id = p_task_id
    and duplicate_of is null
  for update;

  if not found then
    raise exception 'Task not found';
  end if;
  if lower(coalesce(task_row.taken_by, '')) <> actor_email then
    raise exception 'Only the assigned writer can submit this task';
  end if;
  if task_row.status not in ('progress', 'in_progress', 'late', 'revision') then
    raise exception 'This task is not ready for submission';
  end if;
  if jsonb_typeof(files) <> 'array' then
    raise exception 'Submitted files must be an array';
  end if;
  if jsonb_array_length(files) = 0 and link_value = '' and text_value = '' then
    raise exception 'Attach a file, link, or pasted work before submitting';
  end if;
  if length(link_value) > 4000
     or length(text_value) > 200000
     or length(notes_value) > 10000 then
    raise exception 'Submitted content is too long';
  end if;
  if link_value <> '' and link_value !~* '^https?://' then
    raise exception 'Submitted links must start with http:// or https://';
  end if;

  update public.jw_tasks
  set submitted_files = files,
      submitted_link = link_value,
      submitted_text = text_value,
      submitted_notes = notes_value,
      submitted_at = now_at,
      status = 'submitted',
      reviewed_at = null,
      reviewed_by = null,
      review_note = null,
      revision_notes = '',
      ratings = jsonb_set(
        coalesce(ratings, '{}'::jsonb),
        '{__timing}',
        coalesce(ratings -> '__timing', '{}'::jsonb)
          || jsonb_build_object(
            'submitted_at', now_at,
            'submitted_late',
              (deadline is not null and now_at > deadline::timestamptz),
            'late',
              (deadline is not null and now_at > deadline::timestamptz),
            'late_minutes',
              case
                when deadline is not null and now_at > deadline::timestamptz
                  then floor(extract(epoch from (now_at - deadline::timestamptz)) / 60)
                else 0
              end
          ),
        true
      )
  where id = p_task_id
  returning * into task_row;

  insert into public.jw_notifications (
    user_email,
    actor_email,
    task_id,
    type,
    title,
    body,
    event_key,
    metadata
  ) values (
    lower(task_row.posted_by),
    actor_email,
    task_row.id,
    'submitted',
    'Task ready for review',
    task_row.id || ' — ' || coalesce(task_row.subject, 'Task')
      || ' has been submitted. Review the work before completing, revising, or disputing it.',
    'task-submitted:' || task_row.id || ':' || extract(epoch from now_at)::bigint,
    jsonb_build_object('page', 'task-details', 'status', 'submitted')
  )
  on conflict do nothing;

  return task_row;
end
$$;

revoke all on function public.jw_submit_task(text, jsonb, text, text, text)
  from public, anon;
grant execute on function public.jw_submit_task(text, jsonb, text, text, text)
  to authenticated, service_role;

create or replace function public.jw_review_task_submission(
  p_task_id text,
  p_action text,
  p_note text default ''
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  action_value text := lower(btrim(coalesce(p_action, '')));
  note_value text := btrim(coalesce(p_note, ''));
  task_row public.jw_tasks%rowtype;
  now_at timestamptz := now();
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'You must be signed in to review a submission';
  end if;
  if action_value not in ('complete', 'revision') then
    raise exception 'Review action must be complete or revision';
  end if;

  select *
  into task_row
  from public.jw_tasks
  where id = p_task_id
    and duplicate_of is null
  for update;

  if not found then
    raise exception 'Task not found';
  end if;
  if not (
    (select public.is_jw_admin())
    or lower(coalesce(task_row.posted_by, '')) = actor_email
  ) then
    raise exception 'Only the task owner or admin can review this submission';
  end if;
  if task_row.status <> 'submitted' then
    raise exception 'This task is not waiting for review';
  end if;

  if action_value = 'complete' then
    if task_row.payment <> 'paid' and not (select public.is_jw_admin()) then
      raise exception 'Confirm payment before completing this task';
    end if;

    update public.jw_tasks
    set status = 'completed',
        reviewed_at = now_at,
        reviewed_by = actor_email,
        review_note = nullif(note_value, '')
    where id = p_task_id
    returning * into task_row;
  else
    if length(note_value) < 10 or length(note_value) > 10000 then
      raise exception 'Revision instructions must be between 10 and 10000 characters';
    end if;

    update public.jw_tasks
    set status = 'revision',
        revision_notes = note_value,
        revision_at = now_at,
        reviewed_at = now_at,
        reviewed_by = actor_email,
        review_note = note_value
    where id = p_task_id
    returning * into task_row;
  end if;

  insert into public.jw_notifications (
    user_email,
    actor_email,
    task_id,
    type,
    title,
    body,
    event_key,
    metadata
  ) values (
    lower(task_row.taken_by),
    actor_email,
    task_row.id,
    case when action_value = 'complete' then 'review' else 'revision' end,
    case when action_value = 'complete'
      then 'Submission approved'
      else 'Revision requested'
    end,
    case when action_value = 'complete'
      then task_row.id || ' — your submitted work was approved and marked complete.'
      else task_row.id || ' — the task owner requested a revision. Open the task to review the instructions.'
    end,
    'submission-review:' || task_row.id || ':' || action_value || ':'
      || extract(epoch from now_at)::bigint,
    jsonb_build_object(
      'page', 'task-details',
      'action', action_value,
      'review_note', note_value
    )
  )
  on conflict do nothing;

  return task_row;
end
$$;

revoke all on function public.jw_review_task_submission(text, text, text)
  from public, anon;
grant execute on function public.jw_review_task_submission(text, text, text)
  to authenticated, service_role;

create or replace function jw_private.notify_rating_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  rating jsonb;
  target_email text;
  target_label text;
  event_key_value text;
begin
  if new.ratings -> 'writer_by_employer'
     is distinct from old.ratings -> 'writer_by_employer' then
    rating := new.ratings -> 'writer_by_employer';
    target_email := lower(coalesce(new.taken_by, ''));
    target_label := 'writer';
  elsif new.ratings -> 'employer_by_writer'
        is distinct from old.ratings -> 'employer_by_writer' then
    rating := new.ratings -> 'employer_by_writer';
    target_email := lower(coalesce(new.posted_by, ''));
    target_label := 'task owner';
  else
    return new;
  end if;

  if target_email = '' or rating is null then
    return new;
  end if;

  event_key_value := 'rating-posted:' || new.id || ':' || target_label || ':'
    || coalesce(rating ->> 'at', md5(rating::text));

  insert into public.jw_notifications (
    user_email,
    actor_email,
    task_id,
    type,
    title,
    body,
    event_key,
    metadata
  ) values (
    target_email,
    actor_email,
    new.id,
    'review',
    'New review received',
    new.id || ' — a ' || coalesce(rating ->> 'score', '0')
      || '-star review was posted for your account.',
    event_key_value,
    jsonb_build_object(
      'page', 'task-details',
      'score', coalesce((rating ->> 'score')::numeric, 0),
      'target', target_label
    )
  )
  on conflict (lower(user_email), event_key)
  where event_key is not null
  do nothing;

  return new;
end
$$;

revoke all on function jw_private.notify_rating_review()
  from public, anon, authenticated;

drop trigger if exists trg_jw_tasks_notify_rating_review on public.jw_tasks;
create trigger trg_jw_tasks_notify_rating_review
after update of ratings
on public.jw_tasks
for each row
execute function jw_private.notify_rating_review();

-- Realtime was already enabled in production. These guarded statements make
-- fresh environments consistent without failing when the tables are present.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jw_tasks'
  ) then
    alter publication supabase_realtime add table public.jw_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jw_notifications'
  ) then
    alter publication supabase_realtime add table public.jw_notifications;
  end if;
end
$$;

commit;
