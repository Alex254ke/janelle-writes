-- Janelle Writes security hardening
--
-- IMPORTANT: review the compatibility notes in SECURITY_REVIEW.md before applying.
-- This migration intentionally does not use CASCADE. If an unexpected dependency
-- exists, the transaction fails instead of silently deleting dependent objects.

begin;

-- Link legacy profile rows to existing Supabase Auth users where the email is an
-- unambiguous match. Profiles without an Auth user are preserved with a null auth_id.
update public.jw_users as profile
set auth_id = auth_user.id,
    updated_at = now()
from auth.users as auth_user
where profile.auth_id is null
  and lower(profile.email) = lower(auth_user.email);

do $$
begin
  if exists (
    select 1
    from public.jw_users as profile
    left join auth.users as auth_user on auth_user.id = profile.auth_id
    where profile.auth_id is not null
      and auth_user.id is null
  ) then
    raise exception 'jw_users contains auth_id values that do not reference auth.users';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.jw_users'::regclass
      and conname = 'jw_users_auth_id_fkey'
  ) then
    alter table public.jw_users
      add constraint jw_users_auth_id_fkey
      foreign key (auth_id) references auth.users(id) on delete set null;
  end if;
end
$$;

-- The application signs in, signs up, and resets passwords exclusively through
-- Supabase Auth. The legacy values are populated and do not resemble bcrypt or
-- Argon2 hashes, so retain no application-readable password column.
alter table public.jw_users drop column if exists password;

-- Admin authorization is based only on a server-maintained profile row linked to
-- the current Auth user. Email addresses and user_metadata are not authorization.
create or replace function public.is_jw_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jw_users as profile
    where profile.auth_id = (select auth.uid())
      and profile.role = 'admin'
      and profile.is_admin is true
  );
$$;

revoke all on function public.is_jw_admin() from public, anon;
grant execute on function public.is_jw_admin() to authenticated, service_role;

-- RLS decides which row may be touched; this trigger separately protects columns
-- that must never be controlled by an authenticated browser client.
create or replace function public.jw_guard_user_security_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  jwt jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  caller_uid uuid := (select auth.uid());
  caller_email text := lower(coalesce(jwt ->> 'email', ''));
  privileged_key text;
  privileged_keys constant text[] := array[
    '__proto__', 'prototype', 'constructor', 'admin', 'app_metadata',
    'auth_id', 'auth_provider', 'claims', 'email', 'id', 'is_admin',
    'permissions', 'role', 'role_label', 'user_id', 'user_metadata',
    'updated_at'
  ];
begin
  -- Service-role API routes and database owners remain able to perform reviewed
  -- administrative writes. Normal authenticated clients never take this branch.
  if current_user in ('postgres', 'service_role', 'supabase_admin')
     or coalesce(jwt ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if caller_uid is null or caller_email = '' then
    raise exception 'A verified Supabase Auth session is required';
  end if;

  new.profile := coalesce(new.profile, '{}'::jsonb);

  if tg_op = 'INSERT' then
    if new.auth_id is distinct from caller_uid
       or lower(coalesce(new.email, '')) is distinct from caller_email then
      raise exception 'User identity fields must match the authenticated user';
    end if;

    if new.role not in ('student', 'employer', 'writer')
       or coalesce(new.is_admin, false) then
      raise exception 'Role and administrator fields are server-managed';
    end if;

    if new.profile ?| privileged_keys then
      raise exception 'Privileged profile properties are server-managed';
    end if;
  else
    if new.id is distinct from old.id
       or lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, ''))
       or new.auth_id is distinct from old.auth_id
       or new.role is distinct from old.role
       or new.is_admin is distinct from old.is_admin then
      raise exception 'Identity, role, and administrator fields are server-managed';
    end if;

    foreach privileged_key in array privileged_keys loop
      if (new.profile -> privileged_key) is distinct from (coalesce(old.profile, '{}'::jsonb) -> privileged_key) then
        raise exception 'Privileged profile property "%" is server-managed', privileged_key;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.jw_guard_user_security_fields() from public, anon, authenticated;

drop trigger if exists trg_jw_guard_user_security_fields on public.jw_users;
create trigger trg_jw_guard_user_security_fields
before insert or update on public.jw_users
for each row execute function public.jw_guard_user_security_fields();

-- Replace email-only ownership policies with Auth identity checks. The API server
-- uses service_role and is still responsible for allowlisting admin accounts.
drop policy if exists "jw_users_delete_admin_only" on public.jw_users;
drop policy if exists "jw_users_insert_own_or_admin" on public.jw_users;
drop policy if exists "jw_users_select_own_or_admin" on public.jw_users;
drop policy if exists "jw_users_update_own_or_admin" on public.jw_users;

create policy "jw_users_select_own_or_admin"
on public.jw_users for select to authenticated
using (auth_id = (select auth.uid()) or (select public.is_jw_admin()));

create policy "jw_users_insert_own"
on public.jw_users for insert to authenticated
with check (
  auth_id = (select auth.uid())
  and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  and role in ('student', 'employer', 'writer')
  and coalesce(is_admin, false) is false
);

create policy "jw_users_update_own_or_admin"
on public.jw_users for update to authenticated
using (auth_id = (select auth.uid()) or (select public.is_jw_admin()))
with check (auth_id = (select auth.uid()) or (select public.is_jw_admin()));

create policy "jw_users_delete_admin_only"
on public.jw_users for delete to authenticated
using ((select public.is_jw_admin()));

revoke all on table public.jw_users from anon;
revoke all on table public.jw_users from authenticated;
grant select, insert, update, delete on table public.jw_users to authenticated;
grant all on table public.jw_users to service_role;

-- The private bucket previously had policies explicitly granting anonymous upload
-- and download. Paths use <task-id>/instructions/... for owner instructions and
-- <task-id>/<writer>/... for completed work.
drop policy if exists "Allow downloads from jw-submissions" on storage.objects;
drop policy if exists "Allow uploads to jw-submissions" on storage.objects;

create policy "Task participants can download jw submissions"
on storage.objects for select to authenticated
using (
  bucket_id = 'jw-submissions'
  and exists (
    select 1
    from public.jw_tasks as task
    where task.id = (storage.foldername(name))[1]
      and (
        (select public.is_jw_admin())
        or lower(coalesce(task.posted_by, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        or lower(coalesce(task.taken_by, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      )
  )
);

create policy "Task participants can upload jw submissions"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'jw-submissions'
  and (select auth.uid()) is not null
  and exists (
    select 1
    from public.jw_tasks as task
    where task.id = (storage.foldername(name))[1]
      and (
        (select public.is_jw_admin())
        or (
          (storage.foldername(name))[2] = 'instructions'
          and lower(coalesce(task.posted_by, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        )
        or (
          (storage.foldername(name))[2] <> 'instructions'
          and lower(coalesce(task.taken_by, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        )
      )
  )
);

-- Keep the notification RPC authenticated and ensure task notifications can only
-- cross between actual task participants. Bids remain a narrow pending-task case.
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
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  target_email text := lower(coalesce(p_user_email, ''));
  actor_role text;
  task public.jw_tasks%rowtype;
  notification_id uuid;
  allowed boolean := false;
  actor_is_participant boolean := false;
  target_is_participant boolean := false;
begin
  if (select auth.uid()) is null or actor_email = '' then
    raise exception 'Not authenticated';
  end if;
  if target_email = '' then
    raise exception 'Notification recipient email is required';
  end if;
  if p_type not in ('revision', 'bid', 'assigned', 'paid', 'submitted', 'message', 'wallet', 'dispute', 'general') then
    raise exception 'Invalid notification type';
  end if;
  if length(coalesce(p_title, '')) > 160 or length(coalesce(p_body, '')) > 2000 then
    raise exception 'Notification content is too long';
  end if;

  allowed := (select public.is_jw_admin());
  if target_email = actor_email and p_type = 'general' then
    allowed := true;
  end if;

  if nullif(p_task_id, '') is not null then
    select * into task
    from public.jw_tasks
    where id = p_task_id
    limit 1;
    if not found then
      raise exception 'Task not found';
    end if;

    actor_is_participant := actor_email in (
      lower(coalesce(task.posted_by, '')),
      lower(coalesce(task.taken_by, ''))
    );
    target_is_participant := target_email in (
      lower(coalesce(task.posted_by, '')),
      lower(coalesce(task.taken_by, ''))
    );

    if actor_is_participant and target_is_participant then
      allowed := true;
    end if;

    if p_type = 'bid'
       and lower(coalesce(task.status, '')) = 'pending'
       and target_email = lower(coalesce(task.posted_by, '')) then
      select lower(coalesce(profile.role, '')) into actor_role
      from public.jw_users as profile
      where profile.auth_id = (select auth.uid())
      limit 1;
      if actor_role = 'writer' then
        allowed := true;
      end if;
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
    nullif(p_task_id, ''),
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

revoke all on function public.jw_create_notification(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.jw_create_notification(text, text, text, text, text, text, jsonb) to authenticated, service_role;

-- Other RPCs are intentionally authenticated. Trigger helpers do not need direct
-- client execution rights.
revoke all on function public.jw_add_task_bid(text, text) from public, anon;
revoke all on function public.jw_assign_task_to_bidder(text, text) from public, anon;
revoke all on function public.jw_get_public_writer_profile(text) from public, anon;
grant execute on function public.jw_add_task_bid(text, text) to authenticated, service_role;
grant execute on function public.jw_assign_task_to_bidder(text, text) to authenticated, service_role;
grant execute on function public.jw_get_public_writer_profile(text) to authenticated, service_role;

revoke all on function public.jw_block_non_admin_finance_changes() from public, anon, authenticated;
revoke all on function public.jw_block_non_admin_paid() from public, anon, authenticated;
revoke all on function public.jw_block_non_admin_task_identity_changes() from public, anon, authenticated;
revoke all on function public.jw_prevent_role_downgrade_to_student() from public, anon, authenticated;

-- Consolidate notification policies and cache authorization helpers once per query.
drop policy if exists "Admin can manage all notifications" on public.jw_notifications;
drop policy if exists "Users can delete own notifications" on public.jw_notifications;
drop policy if exists "Users can update own notifications" on public.jw_notifications;
drop policy if exists "Users can view own notifications" on public.jw_notifications;

create policy "Users can view own notifications"
on public.jw_notifications for select to authenticated
using (
  (select public.is_jw_admin())
  or lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "Users can update own notifications"
on public.jw_notifications for update to authenticated
using (
  (select public.is_jw_admin())
  or lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
)
with check (
  (select public.is_jw_admin())
  or lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "Users can delete own notifications"
on public.jw_notifications for delete to authenticated
using (
  (select public.is_jw_admin())
  or lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "Admins can insert notifications directly"
on public.jw_notifications for insert to authenticated
with check ((select public.is_jw_admin()));

alter policy "Employers can view own payments"
on public.jw_payments
using (
  (select public.is_jw_admin())
  or lower(employer_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "Admins can view role fix backups"
on public.jw_role_fix_backup for select to authenticated
using ((select public.is_jw_admin()));

-- Safe advisor-reported foreign-key indexes. No existing indexes cover these keys.
create index if not exists idx_jw_payment_callbacks_payment_id
  on public.jw_payment_callbacks(payment_id);
create index if not exists idx_jw_payments_task_id
  on public.jw_payments(task_id);

commit;
