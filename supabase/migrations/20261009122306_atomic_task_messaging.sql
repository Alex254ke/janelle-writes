-- Keep the existing jw_tasks.messages JSONB history, but mutate it atomically.
-- This prevents a stale browser from replacing messages sent by another user.

create or replace function public.jw_send_task_message(
  p_task_id text,
  p_body text,
  p_channel text default null,
  p_client_id text default null
)
returns public.jw_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_name text;
  actor_role text;
  requested_channel text := lower(coalesce(p_channel, ''));
  resolved_channel text;
  clean_body text := btrim(coalesce(p_body, ''));
  task_row public.jw_tasks%rowtype;
  message_row jsonb;
begin
  if auth.uid() is null or actor_email = '' then
    raise exception 'Authentication required';
  end if;

  if length(clean_body) = 0 then
    raise exception 'Message cannot be empty';
  end if;
  if length(clean_body) > 5000 then
    raise exception 'Message is too long';
  end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id
  for update;

  if not found then raise exception 'Task not found'; end if;

  if not public.is_jw_admin()
     and actor_email <> lower(coalesce(task_row.posted_by, ''))
     and actor_email <> lower(coalesce(task_row.taken_by, '')) then
    raise exception 'Only task participants can send messages';
  end if;

  select nullif(btrim(u.name), ''), lower(nullif(btrim(u.role), ''))
  into actor_name, actor_role
  from public.jw_users u
  where lower(u.email) = actor_email
  limit 1;

  if public.is_jw_admin() then
    actor_role := 'admin';
    actor_name := coalesce(actor_name, 'Janelle Writes Admin');
  elsif actor_email = lower(coalesce(task_row.taken_by, '')) then
    actor_role := 'writer';
    actor_name := coalesce(actor_name, nullif(task_row.taken_by_name, ''), actor_email);
  elsif coalesce(task_row.student_order, false) or task_row.order_type = 'international_student' then
    actor_role := 'student';
    actor_name := coalesce(actor_name, nullif(task_row.posted_by_name, ''), actor_email);
  else
    actor_role := 'employer';
    actor_name := coalesce(actor_name, nullif(task_row.posted_by_name, ''), actor_email);
  end if;

  if coalesce(task_row.student_order, false) or task_row.order_type = 'international_student' then
    if actor_role = 'writer' then
      resolved_channel := 'writer';
    elsif actor_role = 'admin' and requested_channel in ('student', 'writer') then
      resolved_channel := requested_channel;
    else
      resolved_channel := 'student';
    end if;
  else
    resolved_channel := 'standard';
  end if;

  -- A browser may retry after a slow network response. Treat its message ID as
  -- an idempotency key so a retry cannot create duplicate chat bubbles.
  if nullif(btrim(p_client_id), '') is not null and exists (
    select 1
    from jsonb_array_elements(coalesce(task_row.messages, '[]'::jsonb)) as existing(message)
    where existing.message ->> 'id' = btrim(p_client_id)
  ) then
    return task_row;
  end if;

  message_row := jsonb_build_object(
    'id', coalesce(nullif(btrim(p_client_id), ''), 'MSG-' || gen_random_uuid()::text),
    'task_id', task_row.id,
    'sender_email', actor_email,
    'sender_name', actor_name,
    'sender_role', actor_role,
    'channel', resolved_channel,
    'body', clean_body,
    'at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'read_by', jsonb_build_array(actor_email)
  );

  update public.jw_tasks
  set messages = coalesce(messages, '[]'::jsonb) || jsonb_build_array(message_row)
  where id = task_row.id
  returning * into task_row;

  return task_row;
end;
$$;

create or replace function public.jw_mark_task_messages_read(p_task_id text)
returns public.jw_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_channel text := 'standard';
  task_row public.jw_tasks%rowtype;
begin
  if auth.uid() is null or actor_email = '' then
    raise exception 'Authentication required';
  end if;

  select * into task_row
  from public.jw_tasks
  where id = p_task_id
  for update;

  if not found then raise exception 'Task not found'; end if;

  if not public.is_jw_admin()
     and actor_email <> lower(coalesce(task_row.posted_by, ''))
     and actor_email <> lower(coalesce(task_row.taken_by, '')) then
    raise exception 'Only task participants can read messages';
  end if;

  if coalesce(task_row.student_order, false) or task_row.order_type = 'international_student' then
    actor_channel := case
      when actor_email = lower(coalesce(task_row.taken_by, '')) then 'writer'
      else 'student'
    end;
  end if;

  update public.jw_tasks t
  set messages = coalesce((
    select jsonb_agg(
      case
        when lower(coalesce(message ->> 'sender_email', '')) <> actor_email
          and (public.is_jw_admin()
            or not (coalesce(task_row.student_order, false) or task_row.order_type = 'international_student')
            or coalesce(message ->> 'channel', case when message ->> 'sender_role' = 'student' then 'student' else 'writer' end) = actor_channel)
          and not (coalesce(message -> 'read_by', '[]'::jsonb) ? actor_email)
        then jsonb_set(
          message,
          '{read_by}',
          coalesce(message -> 'read_by', '[]'::jsonb) || jsonb_build_array(actor_email),
          true
        )
        else message
      end
      order by ordinal
    )
    from jsonb_array_elements(coalesce(task_row.messages, '[]'::jsonb)) with ordinality as item(message, ordinal)
  ), '[]'::jsonb)
  where t.id = task_row.id
  returning * into task_row;

  return task_row;
end;
$$;

revoke all on function public.jw_send_task_message(text, text, text, text) from public, anon;
revoke all on function public.jw_mark_task_messages_read(text) from public, anon;
grant execute on function public.jw_send_task_message(text, text, text, text) to authenticated;
grant execute on function public.jw_mark_task_messages_read(text) to authenticated;
