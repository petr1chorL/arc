-- Preview-only correction for the synthetic rehearsal row.
UPDATE workflow_runs
SET status = 'completed'
WHERE id = '00000000-0000-4000-8000-000000000005';
