-- Supplemental runtime closure state; historical data is retained.
ALTER TABLE review_decisions ADD COLUMN request_body JSONB;
ALTER TABLE review_decisions DROP CONSTRAINT uq_review_decision_idempotency;
ALTER TABLE review_decisions ADD CONSTRAINT uq_review_decision_workspace_key UNIQUE(workspace_id,idempotency_key);
ALTER TABLE evaluations ADD COLUMN operation_id VARCHAR(36);
ALTER TABLE evaluations ADD COLUMN trace_id VARCHAR(80);
ALTER TABLE evaluations ADD COLUMN cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE evaluations ADD COLUMN usage JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX uq_native_evaluation_operation ON evaluations (workspace_id, operation_id) WHERE operation_id IS NOT NULL;
ALTER TABLE regression_runs ALTER COLUMN completed_at DROP NOT NULL;
CREATE TABLE runtime_regression_items (
  id VARCHAR(36) PRIMARY KEY, workspace_id VARCHAR(36) NOT NULL,
  regression_run_id VARCHAR(36) NOT NULL, position INTEGER NOT NULL,
  sample_id VARCHAR(120), artifact_text TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued', evaluation_id VARCHAR(36),
  UNIQUE (workspace_id, regression_run_id, position)
);
-- Same intentionally limited V1 Lite object validation, usable before pagination.
CREATE FUNCTION runtime_artifact_schema_status(content TEXT, snapshot JSON) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE schema JSONB; data JSONB; field TEXT; definition JSONB; kind TEXT;
BEGIN
 schema := snapshot::jsonb->'schema';
 IF schema IS NULL OR jsonb_typeof(schema)<>'object' OR schema->>'type' IS DISTINCT FROM 'object' THEN RETURN 'unchecked'; END IF;
 BEGIN data := content::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN 'failed'; END;
 IF jsonb_typeof(data)<>'object' THEN RETURN 'failed'; END IF;
 IF jsonb_typeof(schema->'required')='array' THEN
   FOR field IN SELECT value #>> '{}' FROM jsonb_array_elements(schema->'required') WHERE jsonb_typeof(value)='string' LOOP
     IF NOT data ? field THEN RETURN 'failed'; END IF;
   END LOOP;
 END IF;
 IF jsonb_typeof(schema->'properties')='object' THEN
   FOR field,definition IN SELECT key,value FROM jsonb_each(schema->'properties') LOOP
     IF data ? field AND jsonb_typeof(definition)='object' THEN
       kind := definition->>'type';
       IF kind IN ('string','number','boolean','object') AND jsonb_typeof(data->field) IS DISTINCT FROM kind THEN RETURN 'failed'; END IF;
       IF kind='integer' THEN
         IF jsonb_typeof(data->field)<>'number' THEN RETURN 'failed'; END IF;
         IF (data->>field)::numeric <> trunc((data->>field)::numeric) THEN RETURN 'failed'; END IF;
       END IF;
     END IF;
   END LOOP;
 END IF;
 RETURN 'passed';
END $$;
