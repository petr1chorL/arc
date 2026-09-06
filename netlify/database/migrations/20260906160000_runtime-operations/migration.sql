-- Additive native runtime storage. No production activation or legacy data rewrite.
CREATE TABLE runtime_operations (
  id varchar(36) PRIMARY KEY,
  workspace_id varchar(36) NOT NULL,
  kind varchar(80) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  input jsonb NOT NULL,
  target_id varchar(36),
  actor_id varchar(36),
  status varchar(32) NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','waiting_review','needs_reconciliation','succeeded','failed','dead_letter','canceled')),
  result jsonb,
  error text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  generation integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,kind,idempotency_key)
);
CREATE INDEX runtime_operations_due ON runtime_operations(status,available_at);
CREATE TABLE runtime_effects (
  operation_id varchar(36) NOT NULL REFERENCES runtime_operations(id),
  effect_key varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status varchar(32) NOT NULL CHECK (status IN ('started','succeeded','not_sent','uncertain')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operation_id,effect_key)
);
CREATE TABLE runtime_event_outbox (
  id varchar(36) PRIMARY KEY,
  operation_id varchar(36) NOT NULL REFERENCES runtime_operations(id),
  dispatch_key varchar(200) NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  event_id varchar(200),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runtime_event_outbox_due ON runtime_event_outbox(status,available_at);
CREATE TABLE runtime_operation_events (
  id varchar(36) PRIMARY KEY,
  operation_id varchar(36) NOT NULL REFERENCES runtime_operations(id),
  workspace_id varchar(36) NOT NULL,
  event_type varchar(80) NOT NULL,
  actor_id varchar(36),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE runtime_node_checkpoints (
  run_id varchar(36) NOT NULL,
  workspace_id varchar(36) NOT NULL,
  node_id varchar(120) NOT NULL,
  node_run_id varchar(36) NOT NULL,
  input_text text NOT NULL,
  output_text text NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'running',
  PRIMARY KEY (run_id,node_id)
);
