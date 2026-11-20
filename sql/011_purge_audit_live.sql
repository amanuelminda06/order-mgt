-- ONE-TIME, OWNER-RUN, IMMEDIATELY BEFORE HANDOVER.
-- Never run as part of setup/migration and never expose to the app/API.
-- The append-only rule stays in 001_schema.sql; the two guards are removed
-- only inside this transaction and restored with their exact definitions.
-- The purge itself is recorded in the audit_log it cleans.

begin;

insert into audit_log (action, entity_type, entity_id, after)
values (
  'audit.purge', 'audit_log', 'live',
  jsonb_build_object(
    'reason', 'one-time pre-handover cleanup',
    'rows_before', (select count(*) from audit_log)
  )
);

drop trigger audit_log_no_update on audit_log;
drop trigger audit_log_no_delete on audit_log;

delete from audit_log where action <> 'audit.purge';

create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_append_only();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_append_only();

commit;

-- Verify afterwards: 2 triggers, 1 surviving purge row.
select count(*) as triggers from pg_trigger
 where tgrelid='audit_log'::regclass and not tgisinternal;  -- expect 2
select action, created_at from audit_log order by id;       -- expect audit.purge
