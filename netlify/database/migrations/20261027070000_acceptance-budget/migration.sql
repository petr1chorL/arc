-- Permanent one-off acceptance allowance; never reset this row in a later deployment.
CREATE TABLE native_acceptance_budget (
  id TEXT PRIMARY KEY CHECK (id = 'qwen-flash-1cny-20261027'),
  reserved_calls INTEGER NOT NULL CHECK (reserved_calls BETWEEN 1 AND 20)
);
