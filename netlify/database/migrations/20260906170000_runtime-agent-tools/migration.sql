-- Internal frozen tool requests are not public audit/event payloads.
CREATE TABLE runtime_agent_tool_inputs (
  node_run_id varchar(36) PRIMARY KEY,
  workspace_id varchar(36) NOT NULL,
  run_id varchar(36) NOT NULL,
  agent_id varchar(36) NOT NULL,
  agent_version varchar(20) NOT NULL,
  input_hash varchar(64) NOT NULL,
  input_text text NOT NULL,
  tool_snapshots jsonb NOT NULL,
  enriched_input text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runtime_agent_tool_inputs_run ON runtime_agent_tool_inputs(workspace_id,run_id);
ALTER TABLE tool_skill_asset_invocations ADD COLUMN effect_operation_id varchar(36);
