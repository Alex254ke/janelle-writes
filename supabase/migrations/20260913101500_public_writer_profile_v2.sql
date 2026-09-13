-- Return only fields that a writer deliberately displays on their platform
-- profile. Full jw_users rows remain protected by the existing own-user/admin
-- RLS policy. No existing user or profile data is modified.

begin;

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
      'experience', account.profile -> 'experience'
    ))
  from public.jw_users as account
  where (select auth.uid()) is not null
    and lower(account.email) = lower(trim(coalesce(p_email, '')))
    and lower(coalesce(account.role, '')) = 'writer'
  limit 1;
$$;

revoke all on function public.jw_get_public_writer_profile_v2(text) from public, anon;
grant execute on function public.jw_get_public_writer_profile_v2(text) to authenticated, service_role;

commit;
