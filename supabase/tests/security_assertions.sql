-- Read-only post-migration assertions. Each row should return the expected value.

select
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jw_users'
      and column_name = 'password'
  ) as password_column_removed;

select
  not has_table_privilege('anon', 'public.jw_users', 'select')
  and not has_table_privilege('anon', 'public.jw_users', 'insert')
  and not has_table_privilege('anon', 'public.jw_users', 'update')
  and not has_table_privilege('anon', 'public.jw_users', 'delete')
  as anon_user_table_access_removed;

select
  not has_function_privilege(
    'anon',
    'public.jw_create_notification(text,text,text,text,text,text,jsonb)',
    'execute'
  ) as anonymous_notification_rpc_removed;

select
  not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles @> array['anon']::name[]
      and (qual like '%jw-submissions%' or with_check like '%jw-submissions%')
  ) as anonymous_submission_policies_removed;

select
  to_regclass('public.idx_jw_payment_callbacks_payment_id') is not null
  and to_regclass('public.idx_jw_payments_task_id') is not null
  as advisor_indexes_present;

select
  count(*) filter (where auth_id is null) as legacy_profiles_without_auth_id,
  count(*) filter (where auth_id is not null) as auth_linked_profiles
from public.jw_users;

-- Admin control system assertions (run after migration
-- 20260730084329_admin_control_system.sql is explicitly approved and applied).
select
  to_regclass('public.jw_admin_audit_log') is not null
  and exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jw_admin_audit_log'
      and policyname = 'Admins can view admin audit log'
  ) as admin_audit_log_is_protected;

select
  has_function_privilege(
    'authenticated',
    'public.jw_admin_resolve_wallet_transaction(uuid,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.jw_admin_override_task(text,text,text,text)',
    'execute'
  )
  and not has_table_privilege(
    'authenticated',
    'public.jw_wallet_transactions',
    'update'
  )
  and not has_table_privilege(
    'authenticated',
    'public.jw_wallet_transactions',
    'delete'
  ) as controlled_admin_functions_are_enforced;

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jw_wallet_transactions'
      and column_name = 'review_note'
  ) as wallet_review_note_present;
