# Supabase Security Review

Audit date: 2026-07-19
Supabase project: `ughwzaowgpergpizenko`
Database: PostgreSQL 17, project status `ACTIVE_HEALTHY`

## Admin control upgrade awaiting production review

Migration `20260730084329_admin_control_system.sql` has been created locally but
has **not** been applied to production. It adds the control layer required by the
new admin operations console:

- an admin-only, append-only decision audit log;
- mandatory review notes for deposits, withdrawals, transfers, and overrides;
- row locking and a per-wallet advisory lock to prevent double approval;
- one atomic wallet decision for the request, payout, commission, linked order,
  and audit record;
- controlled task payment/status override functions; and
- removal of direct browser UPDATE/DELETE access to wallet transactions.

Compatibility risk: once applied, old admin pages or cached clients that try to
update wallet rows directly will fail closed. Deploy the matching frontend and
test the preview before applying this migration. PesaPal server callbacks continue
to use the service role and are not restricted by the browser grant change.

## Production application status

Approved and applied on 2026-07-19 as migration version
`20260719133148_security_hardening`. Post-migration assertions passed: all 29
profiles remain, 26 are Auth-linked, three legacy profiles remain preserved,
the password column is removed, anonymous user/RPC/storage access is removed,
the task-aware storage policies and guard trigger are active, and both advisor
indexes exist. Fresh Postgres logs contained no migration errors.

## Deployment gate

The migration is already applied to production. Upload this project to the
`agent/supabase-security-hardening` GitHub branch so repository migration history
matches production, configure the Vercel preview, review the code diff, and test
the preview before merging into `main`.

Before deploying the profile API, set `JW_ADMIN_EMAILS` in Vercel's Preview and
Production environments to a comma-separated list of the only accounts allowed
to be administrators. There is intentionally no hard-coded fallback. If this
variable is missing, an existing administrator who synchronizes their profile
will be demoted. This fail-closed behavior is deliberate.

## Verified findings

- `jw_users` has 29 profile rows; Supabase Auth has 28 users.
- 26 profiles match an Auth user by email. Three legacy profiles have no matching
  Auth account and cannot use the current Supabase Auth-only login flow until an
  Auth account is created with the same email.
- Nine matching profiles can have `auth_id` safely backfilled. Seventeen already
  have a valid `auth_id`; no invalid or duplicate non-null `auth_id` was found.
- Seventeen `jw_users.password` values are populated. None match the usual bcrypt
  or Argon2 prefixes. No password values were read or copied during this audit.
- The current application uses Supabase Auth for password login, signup, OAuth,
  password reset, password update, and session refresh. It does not authenticate
  against `jw_users.password`.
- Authenticated and anonymous roles currently have broad table/column grants on
  `jw_users`. RLS blocks anonymous rows, but authenticated users can currently
  update their own `role`, `is_admin`, `auth_id`, email, and privileged JSON keys.
- The private `jw-submissions` bucket has anonymous INSERT and SELECT policies.
- `jw_create_notification` is a `SECURITY DEFINER` RPC executable by `anon`.
  Several authenticated RPCs are also `SECURITY DEFINER`; their authenticated
  access is required by current workflows and their bodies perform authorization.
- The database has no tracked Supabase migrations.
- No API, Auth, Storage, Postgres, Realtime, or Edge Function log entries were
  returned for the previous 24 hours.

## Migration contents

The migration:

- backfills safe `auth_id` matches and adds an Auth foreign key;
- removes the legacy password column without `CASCADE`;
- removes email-based admin bypasses and requires both `role = 'admin'` and
  `is_admin = true` on the Auth-linked profile;
- adds a trigger that rejects browser changes to identity, role, admin, and
  privileged profile fields;
- replaces user policies with Auth-ID ownership checks;
- removes anonymous submission upload/download and permits authenticated task
  owners, assigned writers, and administrators according to the existing path
  convention;
- removes anonymous RPC execution and narrows notification authorization;
- consolidates notification policies and optimizes repeated Auth helper calls;
- adds indexes for `jw_payment_callbacks.payment_id` and `jw_payments.task_id`.

## Compatibility and destructive-change risks

1. Dropping `jw_users.password` permanently deletes 17 legacy values. The active
   application does not use them, but the three unmatched legacy profiles should
   be reviewed before approval. Do not export or expose those values.
2. Existing stored files must begin with the exact task ID, matching the current
   application paths. Nonconforming historical paths will no longer receive a
   signed URL after migration.
3. An employer/student may upload only under `<task-id>/instructions/...`; an
   assigned writer may upload completed work under `<task-id>/<writer>/...`.
4. Direct browser writes that previously changed a user's role or identity will
   fail. Profile writes must use `/api/auth/profile`.
5. `JW_ADMIN_EMAILS` must be configured before preview testing.

## Current advisor findings

Security:

- RLS enabled without policy on `jw_role_fix_backup` (addressed)
- Anonymous execution of `jw_create_notification` (addressed)
- Authenticated execution warnings for justified `SECURITY DEFINER` helpers/RPCs
- Leaked password protection disabled (dashboard setting; enable separately)

Performance:

- Missing FK indexes on `jw_payment_callbacks.payment_id` and
  `jw_payments.task_id` (addressed)
- RLS initialization-plan warnings on payments/notifications (addressed)
- Multiple permissive notification policies (addressed)
- Duplicate and unused-index notices were not changed automatically because
  dropping indexes needs workload review.

Advisor references:

- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Review sequence

1. Upload all files to the security branch, not `main`.
2. Confirm Vercel created a Preview deployment for that branch.
3. Set `JW_ADMIN_EMAILS` for Preview and test normal, writer, employer/student,
   and admin login/profile flows.
4. Run `npm run check` locally or in CI.
5. Confirm the migration filename remains `20260719133148_security_hardening.sql`
   so Git history matches the applied production version.
6. Regression-test task uploads/downloads and normal/admin profile updates.
7. Merge only after the Vercel preview is accepted. Do not reapply the migration.
8. Use `supabase/tests/security_assertions.sql` for future regression checks.

## Local verification completed

- `npm run check`: passed
- JavaScript syntax checks: all API files and seven inline scripts passed
- Authorization tests: 6 passed, 0 failed
- `npm audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: passed
- Supabase CLI: migration file created with pinned CLI `2.109.1`

`supabase migration list --local` could not connect because no local Postgres
instance is running. After explicit approval, the migration was applied through
the connected Supabase app and its production assertions and advisors were run.
