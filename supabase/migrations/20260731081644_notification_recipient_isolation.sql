begin;

-- A signed-in account must only read and mutate its own notification rows.
-- Administrators use the audit/control tables for platform-wide review; the
-- personal notification drawer is not a platform-wide data browser.
drop policy if exists "Users can view own notifications" on public.jw_notifications;
drop policy if exists "Users can update own notifications" on public.jw_notifications;
drop policy if exists "Users can delete own notifications" on public.jw_notifications;

create policy "Users can view own notifications"
on public.jw_notifications
for select
to authenticated
using (
  (select auth.uid()) is not null
  and lower(btrim(user_email)) =
      lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
);

create policy "Users can update own notifications"
on public.jw_notifications
for update
to authenticated
using (
  (select auth.uid()) is not null
  and lower(btrim(user_email)) =
      lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
)
with check (
  (select auth.uid()) is not null
  and lower(btrim(user_email)) =
      lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
);

create policy "Users can delete own notifications"
on public.jw_notifications
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and lower(btrim(user_email)) =
      lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
);

-- Older clients generated some submission/bid notifications for the account
-- performing the historical scan instead of the task owner. Preserve the
-- records by moving them to the actual owner and mark these old repaired rows
-- read so they do not create a stale badge flood.
create temporary table jw_notification_recipient_repairs
on commit drop
as
select
  n.id,
  lower(btrim(t.posted_by)) as correct_user_email,
  n.event_key
from public.jw_notifications as n
join public.jw_tasks as t
  on t.id = n.task_id
where n.type in ('submitted', 'bid')
  and nullif(btrim(t.posted_by), '') is not null
  and lower(btrim(n.user_email)) <> lower(btrim(t.posted_by));

-- If the correct recipient already has the same event, retain that copy and
-- remove only the misaddressed duplicate.
delete from public.jw_notifications as wrong
using jw_notification_recipient_repairs as repair
where wrong.id = repair.id
  and repair.event_key is not null
  and exists (
    select 1
    from public.jw_notifications as correct
    where correct.id <> wrong.id
      and lower(btrim(correct.user_email)) = repair.correct_user_email
      and correct.event_key = repair.event_key
  );

update public.jw_notifications as notification
set
  user_email = repair.correct_user_email,
  read_at = coalesce(notification.read_at, now()),
  metadata = coalesce(notification.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'recipient_repaired', true,
      'recipient_repaired_at', now()
    )
from jw_notification_recipient_repairs as repair
where notification.id = repair.id;

-- Keep the RPC convenient for legitimate workflow events but enforce the
-- recipient dictated by each task event type for every non-admin caller.
create or replace function public.jw_create_notification(
  p_user_email text,
  p_type text,
  p_title text,
  p_body text default '',
  p_task_id text default null,
  p_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text := lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')));
  target_email text := lower(btrim(coalesce(p_user_email, '')));
  actor_role text;
  task public.jw_tasks%rowtype;
  notification_id uuid;
  allowed boolean := false;
  owner_email text;
  writer_email text;
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'Not authenticated';
  end if;
  if target_email = '' then
    raise exception 'Notification recipient email is required';
  end if;
  if p_type not in (
    'revision', 'bid', 'assigned', 'paid', 'submitted', 'message',
    'wallet', 'dispute', 'review', 'general'
  ) then
    raise exception 'Invalid notification type';
  end if;
  if length(coalesce(p_title, '')) > 160
     or length(coalesce(p_body, '')) > 2000 then
    raise exception 'Notification content is too long';
  end if;

  allowed := (select public.is_jw_admin());

  if nullif(btrim(coalesce(p_task_id, '')), '') is null then
    if target_email = actor_email and p_type in ('general', 'wallet') then
      allowed := true;
    end if;
  else
    select *
    into task
    from public.jw_tasks
    where id = p_task_id
    limit 1;

    if not found then
      raise exception 'Task not found';
    end if;

    owner_email := lower(btrim(coalesce(task.posted_by, '')));
    writer_email := lower(btrim(coalesce(task.taken_by, '')));

    select lower(coalesce(profile.role, ''))
    into actor_role
    from public.jw_users as profile
    where profile.auth_id = (select auth.uid())
    limit 1;

    if p_type = 'bid'
       and actor_role = 'writer'
       and lower(coalesce(task.status, '')) = 'pending'
       and target_email = owner_email then
      allowed := true;
    elsif p_type = 'submitted'
          and actor_email = writer_email
          and target_email = owner_email then
      allowed := true;
    elsif p_type in ('revision', 'assigned', 'paid', 'review')
          and actor_email = owner_email
          and target_email = writer_email then
      allowed := true;
    elsif p_type in ('message', 'dispute', 'general')
          and actor_email in (owner_email, writer_email)
          and target_email in (owner_email, writer_email)
          and target_email <> actor_email then
      allowed := true;
    end if;
  end if;

  if not allowed then
    raise exception 'Not allowed to create this notification';
  end if;

  insert into public.jw_notifications (
    user_email, actor_email, task_id, type, title, body, event_key, metadata
  ) values (
    target_email,
    actor_email,
    nullif(btrim(coalesce(p_task_id, '')), ''),
    p_type,
    left(coalesce(p_title, ''), 160),
    left(coalesce(p_body, ''), 2000),
    nullif(p_event_key, ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (lower(user_email), event_key)
  where event_key is not null
  do update set
    title = excluded.title,
    body = excluded.body,
    metadata = excluded.metadata,
    created_at = now()
  returning id into notification_id;

  return notification_id;
end;
$$;

revoke all on function public.jw_create_notification(
  text, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.jw_create_notification(
  text, text, text, text, text, text, jsonb
) to authenticated, service_role;

commit;
