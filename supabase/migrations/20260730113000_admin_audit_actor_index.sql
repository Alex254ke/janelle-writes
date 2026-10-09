-- Cover the audit log's auth.users foreign key for efficient user cleanup and
-- administrator activity lookups.
create index if not exists idx_jw_admin_audit_log_actor_auth_id
  on public.jw_admin_audit_log(actor_auth_id);
