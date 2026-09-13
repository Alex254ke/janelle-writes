-- Allow authenticated writers to inspect instruction materials for tasks that
-- are genuinely available to bid on, without exposing submissions or private
-- files from assigned/completed tasks.
--
-- This migration is intentionally additive and preserves existing rows/files.

begin;

-- Older projects may predate the profile feature. This is a no-op when the
-- existing JSONB column is already present.
alter table public.jw_users
  add column if not exists profile jsonb not null default '{}'::jsonb;

drop policy if exists "Task participants can download jw submissions" on storage.objects;
drop policy if exists "Task participants and browsing writers can read task files" on storage.objects;

create policy "Task participants and browsing writers can read task files"
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
        or (
          (storage.foldername(name))[2] = 'instructions'
          and lower(coalesce(task.status, '')) = 'pending'
          and nullif(trim(coalesce(task.taken_by, '')), '') is null
          and exists (
            select 1
            from public.jw_users as viewer
            where viewer.auth_id = (select auth.uid())
              and lower(coalesce(viewer.role, '')) = 'writer'
          )
        )
      )
  )
);

commit;
