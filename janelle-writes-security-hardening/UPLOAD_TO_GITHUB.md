# Manual GitHub Upload

Target repository: `Alex254ke/janelle-writes`  
Target branch: `agent/supabase-security-hardening`

1. In GitHub, create `agent/supabase-security-hardening` from `main` if it does
   not already exist.
2. Upload the contents of this folder to that branch, preserving directories.
   Important new directories are `scripts/`, `test/`, and `supabase/`.
3. Confirm the branch contains `index.html`, `api/auth/profile.js`,
   `supabase/migrations/20260719133148_security_hardening.sql`, and
   `package.json`.
4. Commit with a message such as `Harden Supabase authorization and storage`.
5. Open a draft pull request from the security branch into `main`.
6. Wait for the Vercel Preview deployment. Do not merge and do not run the
   production migration until the preview and migration diff are approved.

Do not upload local environment files, credentials, tokens, or service-role keys.
