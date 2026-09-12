-- Janelle Writes: set the platform commission for newly created orders to 5%.
--
-- Compatibility and data-preservation rules:
--   * Existing tasks are not updated.
--   * Existing commission-ledger rows are not updated.
--   * Completed and historical payments retain their recorded commission rate.
--   * The trigger stamps only newly inserted tasks, keeping the server as the
--     authority even if an older browser client submits a stale rate.

begin;

alter table public.jw_tasks
  alter column commission_rate set default 0.05;

create or replace function jw_private.set_new_task_commission_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rate constant numeric := 0.05;
  v_total numeric := greatest(0, coalesce(new.total, 0));
begin
  new.commission_rate := v_rate;
  new.commission_amount := round(v_total * v_rate, 2);
  new.writer_payout := greatest(0, v_total - new.commission_amount);
  return new;
end;
$$;

revoke all on function jw_private.set_new_task_commission_rate()
  from public, anon, authenticated;

drop trigger if exists jw_tasks_set_new_commission_rate on public.jw_tasks;
create trigger jw_tasks_set_new_commission_rate
before insert on public.jw_tasks
for each row
execute function jw_private.set_new_task_commission_rate();

comment on function jw_private.set_new_task_commission_rate() is
  'Stamps newly inserted Janelle Writes tasks with the current 5% platform fee without changing historical tasks.';

commit;
