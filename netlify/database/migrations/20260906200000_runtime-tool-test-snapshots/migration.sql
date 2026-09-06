-- Standalone Tool tests have no synthetic Agent, Run or NodeRun association.
CREATE TABLE runtime_tool_test_snapshots (
  operation_id varchar(36) PRIMARY KEY,
  workspace_id varchar(36) NOT NULL,
  asset_id varchar(36) NOT NULL,
  asset_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(asset_snapshot) = 'object')
);
CREATE INDEX runtime_tool_test_snapshots_asset ON runtime_tool_test_snapshots(workspace_id,asset_id);
