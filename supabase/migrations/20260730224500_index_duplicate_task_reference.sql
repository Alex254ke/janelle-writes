-- Cover the self-referencing duplicate marker used to suppress legacy
-- duplicate orders without deleting production records.
create index if not exists idx_jw_tasks_duplicate_of
  on public.jw_tasks (duplicate_of)
  where duplicate_of is not null;
