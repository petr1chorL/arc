-- Run in a fresh, already authenticated session with the ARC database/schema selected.
-- No connection strings, environment reads, exports, business writes or production activation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '20s';
SET LOCAL client_min_messages = 'notice';

DO $arc_inventory$
DECLARE
  arc_schema text := current_schema();
  arc_tables text[] := ARRAY[
    'agent_versions','agents','artifact_diffs','artifact_versions','artifacts','audit_events',
    'data_object_definitions','data_object_versions','evaluations','execution_jobs',
    'feedback_candidates','golden_samples','human_reviews','human_tasks','invitations','model_providers',
    'node_runs','notification_channels','notification_outbox','organizations','regression_runs',
    'regression_sample_sets','regression_samples','remediation_task_activities','remediation_tasks',
    'resume_requests','review_decisions','review_group_members','review_groups','reviewers',
    'rubric_versions','rubrics','schedule_dispatches','sessions','tool_skill_asset_invocations',
    'tool_skill_assets','users','workflow_runs','workflow_schedules','workflow_versions','workflows',
    'workspace_memberships','workspaces'
  ];
  table_name text;
  row_total bigint;
  row_counts jsonb := '{}'::jsonb;
  task_counts jsonb := '{}'::jsonb;
  status_counts jsonb;
  terminal_states text[];
  nonterminal_total bigint;
BEGIN
  IF current_setting('transaction_read_only') <> 'on'
     OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'ARC inventory requires a fresh read-only repeatable-read transaction';
  END IF;
  IF arc_schema IS NULL THEN RAISE EXCEPTION 'ARC source schema is not selected'; END IF;
  -- Validate every required physical table before scanning or printing any success result.
  FOREACH table_name IN ARRAY arc_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=arc_schema AND c.relname=table_name AND c.relkind IN ('r','p')) THEN
      RAISE EXCEPTION 'ARC source table missing: %.%', arc_schema, table_name;
    END IF;
    IF pg_catalog.row_security_active(format('%I.%I',arc_schema,table_name)::regclass) THEN
      RAISE EXCEPTION 'ARC source table is row-filtered for this session: %.%', arc_schema, table_name;
    END IF;
  END LOOP;
  FOREACH table_name IN ARRAY arc_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', arc_schema, table_name) INTO row_total;
    row_counts := row_counts || jsonb_build_object(table_name, row_total);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['workflow_runs','node_runs','execution_jobs','human_tasks','resume_requests','notification_outbox'] LOOP
    terminal_states := CASE
      WHEN table_name IN ('workflow_runs','node_runs') THEN ARRAY['已完成','完成','失败','已取消','已驳回','已退回']
      WHEN table_name='human_tasks' THEN ARRAY['已通过','修改后通过','已驳回','已退回','已取消']
      WHEN table_name='notification_outbox' THEN ARRAY['sent','failed']
      ELSE ARRAY['succeeded','failed','dead_letter','canceled'] END;
    EXECUTE format('SELECT COALESCE(jsonb_object_agg(state,n),''{}''::jsonb) FROM
      (SELECT COALESCE(status,''<NULL>'') state,count(*) n FROM %I.%I GROUP BY status) counts', arc_schema, table_name)
      INTO status_counts;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE status IS NULL OR NOT (status=ANY($1))', arc_schema, table_name)
      INTO nonterminal_total USING terminal_states;
    task_counts := task_counts || jsonb_build_object(table_name, jsonb_build_object(
      'total', row_counts->table_name, 'nonterminal', nonterminal_total, 'statusCounts', status_counts,
      'knownTerminalStates', to_jsonb(terminal_states)));
  END LOOP;
  -- The only data-bearing output: no row bodies, identity fields, hashes, URLs or secret references.
  RAISE NOTICE 'ARC_SOURCE_INVENTORY %', jsonb_build_object(
    'database',current_database(),'schema',arc_schema,'serverVersion',current_setting('server_version'),
    'snapshotAt',transaction_timestamp(),'readOnly',true,'isolation',current_setting('transaction_isolation'),
    'tableCount',array_length(arc_tables,1),'rowCounts',row_counts,'tasks',task_counts,
    'scope','43 ARC baseline tables; unknown task states count as nonterminal; failed terminal tasks still require review');
END
$arc_inventory$;

ROLLBACK;
