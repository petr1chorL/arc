-- Generated from apps/api/app/models.py.
-- Do not edit this migration by hand; update the models and regenerate it.
-- This baseline is schema-only and contains no connection string or row data.

CREATE TABLE agent_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	agent_id VARCHAR(36) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	snapshot JSON NOT NULL, 
	note TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE agents (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(80) NOT NULL, 
	role VARCHAR(240) NOT NULL, 
	owner VARCHAR(80) NOT NULL, 
	model VARCHAR(80) NOT NULL, 
	model_provider_id VARCHAR(36), 
	model_provider VARCHAR(80) NOT NULL, 
	model_base_url VARCHAR(500) NOT NULL, 
	temperature FLOAT NOT NULL, 
	max_output_tokens INTEGER NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	pass_rate FLOAT NOT NULL, 
	runs INTEGER NOT NULL, 
	tools JSON NOT NULL, 
	skills JSON NOT NULL, 
	tool_asset_refs JSON NOT NULL, 
	skill_asset_refs JSON NOT NULL, 
	system_prompt TEXT NOT NULL, 
	runtime_manifest JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE artifact_diffs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	human_task_id VARCHAR(36) NOT NULL, 
	from_version_id VARCHAR(36) NOT NULL, 
	to_version_id VARCHAR(36) NOT NULL, 
	old_content TEXT NOT NULL, 
	new_content TEXT NOT NULL, 
	unified_diff TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (to_version_id)
);

CREATE TABLE artifact_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	artifact_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	parent_version_id VARCHAR(36), 
	content TEXT NOT NULL, 
	data_object_definition_id VARCHAR(36), 
	data_object_version_id VARCHAR(36), 
	data_object_snapshot JSON, 
	created_by VARCHAR(80) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE artifacts (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	run_id VARCHAR(36) NOT NULL, 
	source_node_run_id VARCHAR(36) NOT NULL, 
	artifact_type VARCHAR(80) NOT NULL, 
	content TEXT NOT NULL, 
	score INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE audit_events (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	organization_id VARCHAR(36), 
	human_task_id VARCHAR(36), 
	actor_user_id VARCHAR(36), 
	session_id VARCHAR(36), 
	action VARCHAR(120), 
	target_type VARCHAR(80), 
	target_id VARCHAR(120), 
	outcome VARCHAR(32), 
	request_id VARCHAR(120), 
	ip_address VARCHAR(64), 
	metadata JSON, 
	event_type VARCHAR(64), 
	actor_id VARCHAR(80), 
	reason TEXT NOT NULL, 
	before_status VARCHAR(32) NOT NULL, 
	after_status VARCHAR(32) NOT NULL, 
	payload JSON NOT NULL, 
	trace_id VARCHAR(80) NOT NULL, 
	span_id VARCHAR(80), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE data_object_definitions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	schema JSON NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_data_object_definition_workspace_name UNIQUE (workspace_id, name)
);

CREATE TABLE data_object_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	definition_id VARCHAR(36) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	snapshot JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE evaluations (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	rubric_id VARCHAR(36) NOT NULL, 
	rubric_version VARCHAR(32) NOT NULL, 
	rubric_snapshot JSON NOT NULL, 
	subject_type VARCHAR(80) NOT NULL, 
	subject_id VARCHAR(120), 
	artifact_text TEXT NOT NULL, 
	dimension_scores JSON NOT NULL, 
	score INTEGER NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	rationale TEXT NOT NULL, 
	evaluator_type VARCHAR(32) NOT NULL, 
	evaluator_model VARCHAR(120) NOT NULL, 
	evaluator_input JSON NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE execution_jobs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	run_id VARCHAR(36) NOT NULL, 
	workflow_id VARCHAR(36), 
	workflow_version VARCHAR(20), 
	job_type VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	input_text TEXT NOT NULL, 
	attempts INTEGER NOT NULL, 
	max_attempts INTEGER NOT NULL, 
	error TEXT NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	locked_by VARCHAR(120) NOT NULL, 
	locked_until TIMESTAMP WITH TIME ZONE, 
	last_heartbeat_at TIMESTAMP WITH TIME ZONE, 
	next_attempt_at TIMESTAMP WITH TIME ZONE, 
	started_at TIMESTAMP WITH TIME ZONE, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	dead_lettered_at TIMESTAMP WITH TIME ZONE, 
	canceled_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE TABLE feedback_candidates (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	human_task_id VARCHAR(36) NOT NULL, 
	decision_id VARCHAR(36) NOT NULL, 
	original_version_id VARCHAR(36) NOT NULL, 
	modified_version_id VARCHAR(36) NOT NULL, 
	diff_id VARCHAR(36) NOT NULL, 
	reason TEXT NOT NULL, 
	tags JSON NOT NULL, 
	workflow_run_id VARCHAR(36) NOT NULL, 
	workflow_id VARCHAR(36), 
	agent_id VARCHAR(36), 
	source_node_id VARCHAR(120) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	confirmed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_feedback_candidate_decision UNIQUE (decision_id)
);

CREATE TABLE golden_samples (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	candidate_id VARCHAR(36) NOT NULL, 
	input_text TEXT NOT NULL, 
	expected_output TEXT NOT NULL, 
	reviewer_id VARCHAR(36) NOT NULL, 
	reason TEXT NOT NULL, 
	idempotency_key VARCHAR(160) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_golden_sample_candidate UNIQUE (candidate_id), 
	CONSTRAINT uq_golden_sample_idempotency UNIQUE (idempotency_key)
);

CREATE TABLE human_reviews (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	run_id VARCHAR(36) NOT NULL, 
	node_run_id VARCHAR(36) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	reason TEXT NOT NULL, 
	score INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE human_tasks (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	workflow_run_id VARCHAR(36) NOT NULL, 
	node_run_id VARCHAR(36) NOT NULL, 
	human_node_id VARCHAR(120) NOT NULL, 
	source_node_id VARCHAR(120) NOT NULL, 
	artifact_version_id VARCHAR(36) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	assignment_type VARCHAR(32) NOT NULL, 
	assignee_reviewer_id VARCHAR(36), 
	assignee_group_id VARCHAR(36), 
	review_policy VARCHAR(32) NOT NULL, 
	required_approvals INTEGER NOT NULL, 
	participant_snapshot JSON NOT NULL, 
	due_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	escalation_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	sla_status VARCHAR(32) NOT NULL, 
	escalation_group_id VARCHAR(36), 
	due_reminder_sent_at TIMESTAMP WITH TIME ZONE, 
	overdue_recorded_at TIMESTAMP WITH TIME ZONE, 
	escalated_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (node_run_id)
);

CREATE TABLE invitations (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	role VARCHAR(32) NOT NULL, 
	token_digest VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	created_by VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_invitation_token_digest UNIQUE (token_digest)
);

CREATE TABLE model_providers (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	provider_type VARCHAR(80) NOT NULL, 
	base_url VARCHAR(500) NOT NULL, 
	default_model VARCHAR(120) NOT NULL, 
	secret_ref VARCHAR(160) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_model_provider_workspace_name UNIQUE (workspace_id, name)
);

CREATE TABLE node_runs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	run_id VARCHAR(36) NOT NULL, 
	node_id VARCHAR(120) NOT NULL, 
	node_type VARCHAR(40) NOT NULL, 
	node_name VARCHAR(160) NOT NULL, 
	agent_id VARCHAR(36), 
	agent_version VARCHAR(20), 
	status VARCHAR(20) NOT NULL, 
	input_text TEXT NOT NULL, 
	output_text TEXT NOT NULL, 
	model VARCHAR(120) NOT NULL, 
	prompt_tokens INTEGER NOT NULL, 
	completion_tokens INTEGER NOT NULL, 
	total_tokens INTEGER NOT NULL, 
	cost_usd FLOAT NOT NULL, 
	duration_ms INTEGER NOT NULL, 
	attempts INTEGER NOT NULL, 
	score INTEGER, 
	error TEXT NOT NULL, 
	trace_id VARCHAR(80) NOT NULL, 
	span_id VARCHAR(80) NOT NULL, 
	parent_span_id VARCHAR(80), 
	started_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE TABLE notification_channels (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(120) NOT NULL, 
	channel_type VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	config JSON NOT NULL, 
	secret_ref VARCHAR(160) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_notification_channel_workspace_name UNIQUE (workspace_id, name)
);

CREATE TABLE notification_outbox (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	event_key VARCHAR(160) NOT NULL, 
	human_task_id VARCHAR(36) NOT NULL, 
	event_type VARCHAR(64) NOT NULL, 
	recipient_type VARCHAR(32) NOT NULL, 
	recipient_id VARCHAR(80) NOT NULL, 
	payload JSON NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_notification_event_key UNIQUE (event_key)
);

CREATE TABLE organizations (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	slug VARCHAR(120) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (slug)
);

CREATE TABLE regression_runs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	sample_set_id VARCHAR(36), 
	sample_set_name VARCHAR(160) NOT NULL, 
	rubric_id VARCHAR(36) NOT NULL, 
	rubric_name VARCHAR(160) NOT NULL, 
	rubric_version VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	total_samples INTEGER NOT NULL, 
	passed_samples INTEGER NOT NULL, 
	failed_samples INTEGER NOT NULL, 
	pass_rate INTEGER NOT NULL, 
	evaluation_ids JSON NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE regression_sample_sets (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(160) NOT NULL, 
	description TEXT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_regression_sample_set_workspace_name UNIQUE (workspace_id, name)
);

CREATE TABLE regression_samples (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	sample_set_id VARCHAR(36) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	input_text TEXT NOT NULL, 
	expected_output TEXT NOT NULL, 
	tags JSON NOT NULL, 
	source_type VARCHAR(80) NOT NULL, 
	source_id VARCHAR(120), 
	status VARCHAR(32) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE remediation_task_activities (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	task_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(32) NOT NULL, 
	body TEXT NOT NULL, 
	attachment_refs JSON NOT NULL, 
	actor_user_id VARCHAR(36) NOT NULL, 
	actor_display_name VARCHAR(160) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE remediation_tasks (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	source_run_id VARCHAR(36) NOT NULL, 
	cluster_key VARCHAR(120) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	priority VARCHAR(8) NOT NULL, 
	sample_ids JSON NOT NULL, 
	action TEXT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	owner VARCHAR(120), 
	due_date TIMESTAMP WITH TIME ZONE, 
	retest_run_id VARCHAR(36), 
	created_by VARCHAR(36) NOT NULL, 
	updated_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_remediation_task_workspace_run_cluster UNIQUE (workspace_id, source_run_id, cluster_key)
);

CREATE TABLE resume_requests (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	human_task_id VARCHAR(36) NOT NULL, 
	decision_id VARCHAR(36) NOT NULL, 
	action VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	error TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_task_decision_resume UNIQUE (human_task_id, decision_id)
);

CREATE TABLE review_decisions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	human_task_id VARCHAR(36) NOT NULL, 
	reviewer_id VARCHAR(36) NOT NULL, 
	decision VARCHAR(32) NOT NULL, 
	reason TEXT NOT NULL, 
	artifact_version_id VARCHAR(36) NOT NULL, 
	idempotency_key VARCHAR(160) NOT NULL, 
	tags JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_task_reviewer_decision UNIQUE (human_task_id, reviewer_id), 
	CONSTRAINT uq_review_decision_idempotency UNIQUE (idempotency_key)
);

CREATE TABLE review_group_members (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	group_id VARCHAR(36) NOT NULL, 
	reviewer_id VARCHAR(36) NOT NULL, 
	role VARCHAR(80) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_review_group_member UNIQUE (group_id, reviewer_id)
);

CREATE TABLE review_groups (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(100) NOT NULL, 
	assignment_mode VARCHAR(32) NOT NULL, 
	rotation_cursor INTEGER NOT NULL, 
	is_escalation_group BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (name)
);

CREATE TABLE reviewers (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	user_id VARCHAR(36), 
	name VARCHAR(80) NOT NULL, 
	role VARCHAR(80) NOT NULL, 
	is_expert BOOLEAN NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE rubric_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	rubric_id VARCHAR(36) NOT NULL, 
	version VARCHAR(32) NOT NULL, 
	snapshot JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE rubrics (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(160) NOT NULL, 
	artifact VARCHAR(160) NOT NULL, 
	dimensions JSON NOT NULL, 
	gate TEXT NOT NULL, 
	pass_score INTEGER NOT NULL, 
	judge_type VARCHAR(32) NOT NULL, 
	judge_model VARCHAR(120) NOT NULL, 
	model_provider_id VARCHAR(36), 
	version VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	sort_order INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_rubric_workspace_name_version UNIQUE (workspace_id, name, version)
);

CREATE TABLE schedule_dispatches (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	schedule_id VARCHAR(36) NOT NULL, 
	scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	run_id VARCHAR(36), 
	reason TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_schedule_dispatch_scheduled_for UNIQUE (schedule_id, scheduled_for)
);

CREATE TABLE sessions (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	token_digest VARCHAR(64) NOT NULL, 
	csrf_digest VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	absolute_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	revoked_reason VARCHAR(120), 
	ip_address VARCHAR(64), 
	user_agent VARCHAR(512), 
	PRIMARY KEY (id), 
	CONSTRAINT uq_session_token_digest UNIQUE (token_digest)
);

CREATE TABLE tool_skill_asset_invocations (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	asset_id VARCHAR(36) NOT NULL, 
	asset_type VARCHAR(20) NOT NULL, 
	asset_name VARCHAR(120) NOT NULL, 
	agent_id VARCHAR(36), 
	agent_version VARCHAR(20) NOT NULL, 
	run_id VARCHAR(36), 
	node_run_id VARCHAR(36), 
	status VARCHAR(20) NOT NULL, 
	input_summary TEXT NOT NULL, 
	output_summary TEXT NOT NULL, 
	error TEXT NOT NULL, 
	duration_ms INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE tool_skill_assets (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	asset_type VARCHAR(20) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	parameter_schema JSON NOT NULL, 
	adapter_type VARCHAR(20) NOT NULL, 
	adapter_config JSON NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_tool_skill_asset_workspace_type_name UNIQUE (workspace_id, asset_type, name)
);

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	email VARCHAR(320), 
	normalized_email VARCHAR(320), 
	display_name VARCHAR(160) NOT NULL, 
	password_hash TEXT, 
	status VARCHAR(32) NOT NULL, 
	is_organization_admin BOOLEAN NOT NULL, 
	failed_login_count INTEGER NOT NULL, 
	locked_until TIMESTAMP WITH TIME ZONE, 
	password_changed_at TIMESTAMP WITH TIME ZONE, 
	last_login_at TIMESTAMP WITH TIME ZONE, 
	last_workspace_id VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_user_org_email UNIQUE (organization_id, normalized_email)
);

CREATE TABLE workflow_runs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	kind VARCHAR(20) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	workflow_id VARCHAR(36), 
	workflow_version VARCHAR(20), 
	agent_id VARCHAR(36), 
	agent_version VARCHAR(20), 
	status VARCHAR(20) NOT NULL, 
	input_text TEXT NOT NULL, 
	output_text TEXT NOT NULL, 
	score INTEGER, 
	model VARCHAR(120) NOT NULL, 
	prompt_tokens INTEGER NOT NULL, 
	completion_tokens INTEGER NOT NULL, 
	total_tokens INTEGER NOT NULL, 
	cost_usd FLOAT NOT NULL, 
	duration_ms INTEGER NOT NULL, 
	current_node VARCHAR(160) NOT NULL, 
	error TEXT NOT NULL, 
	trace_id VARCHAR(80) NOT NULL, 
	started_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE TABLE workflow_schedules (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	workflow_id VARCHAR(36) NOT NULL, 
	workflow_version_id VARCHAR(36) NOT NULL, 
	workflow_version VARCHAR(20) NOT NULL, 
	cron_expression VARCHAR(120) NOT NULL, 
	timezone VARCHAR(120) NOT NULL, 
	input_text TEXT NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	next_run_at TIMESTAMP WITH TIME ZONE, 
	last_scheduled_for TIMESTAMP WITH TIME ZONE, 
	last_run_id VARCHAR(36), 
	created_by VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_workflow_schedule_workspace_name UNIQUE (workspace_id, name)
);

CREATE TABLE workflow_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	workflow_id VARCHAR(36) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	snapshot JSON NOT NULL, 
	note TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE workflows (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36), 
	name VARCHAR(120) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	version VARCHAR(20) NOT NULL, 
	nodes JSON NOT NULL, 
	edges JSON NOT NULL, 
	input_schema JSON NOT NULL, 
	output_schema JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE workspace_memberships (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	role VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	invited_by VARCHAR(36), 
	activated_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_workspace_membership UNIQUE (workspace_id, user_id)
);

CREATE TABLE workspaces (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	slug VARCHAR(120) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_by VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_workspace_org_slug UNIQUE (organization_id, slug)
);

CREATE INDEX ix_agent_versions_agent_id ON agent_versions (agent_id);

CREATE INDEX ix_agent_versions_workspace_id ON agent_versions (workspace_id);

CREATE INDEX ix_agents_workspace_id ON agents (workspace_id);

CREATE INDEX ix_artifact_diffs_human_task_id ON artifact_diffs (human_task_id);

CREATE INDEX ix_artifact_diffs_workspace_id ON artifact_diffs (workspace_id);

CREATE INDEX ix_artifact_versions_artifact_id ON artifact_versions (artifact_id);

CREATE INDEX ix_artifact_versions_workspace_id ON artifact_versions (workspace_id);

CREATE INDEX ix_artifacts_run_id ON artifacts (run_id);

CREATE INDEX ix_artifacts_workspace_id ON artifacts (workspace_id);

CREATE INDEX ix_audit_events_action ON audit_events (action);

CREATE INDEX ix_audit_events_actor_user_id ON audit_events (actor_user_id);

CREATE INDEX ix_audit_events_human_task_id ON audit_events (human_task_id);

CREATE INDEX ix_audit_events_organization_id ON audit_events (organization_id);

CREATE INDEX ix_audit_events_outcome ON audit_events (outcome);

CREATE INDEX ix_audit_events_request_id ON audit_events (request_id);

CREATE INDEX ix_audit_events_session_id ON audit_events (session_id);

CREATE INDEX ix_audit_events_span_id ON audit_events (span_id);

CREATE INDEX ix_audit_events_target_id ON audit_events (target_id);

CREATE INDEX ix_audit_events_target_type ON audit_events (target_type);

CREATE INDEX ix_audit_events_trace_id ON audit_events (trace_id);

CREATE INDEX ix_audit_events_workspace_id ON audit_events (workspace_id);

CREATE INDEX ix_data_object_definitions_workspace_id ON data_object_definitions (workspace_id);

CREATE INDEX ix_data_object_versions_definition_id ON data_object_versions (definition_id);

CREATE INDEX ix_data_object_versions_workspace_id ON data_object_versions (workspace_id);

CREATE INDEX ix_evaluations_rubric_id ON evaluations (rubric_id);

CREATE INDEX ix_evaluations_workspace_id ON evaluations (workspace_id);

CREATE INDEX ix_execution_jobs_run_id ON execution_jobs (run_id);

CREATE INDEX ix_execution_jobs_status ON execution_jobs (status);

CREATE INDEX ix_execution_jobs_workflow_id ON execution_jobs (workflow_id);

CREATE INDEX ix_execution_jobs_workspace_id ON execution_jobs (workspace_id);

CREATE INDEX ix_feedback_candidates_human_task_id ON feedback_candidates (human_task_id);

CREATE INDEX ix_feedback_candidates_workflow_run_id ON feedback_candidates (workflow_run_id);

CREATE INDEX ix_feedback_candidates_workspace_id ON feedback_candidates (workspace_id);

CREATE INDEX ix_golden_samples_candidate_id ON golden_samples (candidate_id);

CREATE INDEX ix_golden_samples_workspace_id ON golden_samples (workspace_id);

CREATE INDEX ix_human_reviews_run_id ON human_reviews (run_id);

CREATE INDEX ix_human_reviews_workspace_id ON human_reviews (workspace_id);

CREATE INDEX ix_human_tasks_workflow_run_id ON human_tasks (workflow_run_id);

CREATE INDEX ix_human_tasks_workspace_id ON human_tasks (workspace_id);

CREATE INDEX ix_invitations_organization_id ON invitations (organization_id);

CREATE INDEX ix_invitations_user_id ON invitations (user_id);

CREATE INDEX ix_invitations_workspace_id ON invitations (workspace_id);

CREATE INDEX ix_model_providers_workspace_id ON model_providers (workspace_id);

CREATE INDEX ix_node_runs_parent_span_id ON node_runs (parent_span_id);

CREATE INDEX ix_node_runs_run_id ON node_runs (run_id);

CREATE INDEX ix_node_runs_span_id ON node_runs (span_id);

CREATE INDEX ix_node_runs_trace_id ON node_runs (trace_id);

CREATE INDEX ix_node_runs_workspace_id ON node_runs (workspace_id);

CREATE INDEX ix_notification_channels_channel_type ON notification_channels (channel_type);

CREATE INDEX ix_notification_channels_status ON notification_channels (status);

CREATE INDEX ix_notification_channels_workspace_id ON notification_channels (workspace_id);

CREATE INDEX ix_notification_outbox_human_task_id ON notification_outbox (human_task_id);

CREATE INDEX ix_notification_outbox_workspace_id ON notification_outbox (workspace_id);

CREATE INDEX ix_regression_runs_rubric_id ON regression_runs (rubric_id);

CREATE INDEX ix_regression_runs_sample_set_id ON regression_runs (sample_set_id);

CREATE INDEX ix_regression_runs_workspace_id ON regression_runs (workspace_id);

CREATE INDEX ix_regression_sample_sets_workspace_id ON regression_sample_sets (workspace_id);

CREATE INDEX ix_regression_samples_sample_set_id ON regression_samples (sample_set_id);

CREATE INDEX ix_regression_samples_workspace_id ON regression_samples (workspace_id);

CREATE INDEX ix_remediation_task_activities_task_id ON remediation_task_activities (task_id);

CREATE INDEX ix_remediation_task_activities_workspace_id ON remediation_task_activities (workspace_id);

CREATE INDEX ix_remediation_tasks_due_date ON remediation_tasks (due_date);

CREATE INDEX ix_remediation_tasks_owner ON remediation_tasks (owner);

CREATE INDEX ix_remediation_tasks_retest_run_id ON remediation_tasks (retest_run_id);

CREATE INDEX ix_remediation_tasks_source_run_id ON remediation_tasks (source_run_id);

CREATE INDEX ix_remediation_tasks_workspace_id ON remediation_tasks (workspace_id);

CREATE INDEX ix_resume_requests_human_task_id ON resume_requests (human_task_id);

CREATE INDEX ix_resume_requests_workspace_id ON resume_requests (workspace_id);

CREATE INDEX ix_review_decisions_human_task_id ON review_decisions (human_task_id);

CREATE INDEX ix_review_decisions_reviewer_id ON review_decisions (reviewer_id);

CREATE INDEX ix_review_decisions_workspace_id ON review_decisions (workspace_id);

CREATE INDEX ix_review_group_members_group_id ON review_group_members (group_id);

CREATE INDEX ix_review_group_members_reviewer_id ON review_group_members (reviewer_id);

CREATE INDEX ix_review_group_members_workspace_id ON review_group_members (workspace_id);

CREATE INDEX ix_review_groups_workspace_id ON review_groups (workspace_id);

CREATE INDEX ix_reviewers_user_id ON reviewers (user_id);

CREATE INDEX ix_reviewers_workspace_id ON reviewers (workspace_id);

CREATE INDEX ix_rubric_versions_rubric_id ON rubric_versions (rubric_id);

CREATE INDEX ix_rubric_versions_workspace_id ON rubric_versions (workspace_id);

CREATE INDEX ix_rubrics_workspace_id ON rubrics (workspace_id);

CREATE INDEX ix_schedule_dispatches_run_id ON schedule_dispatches (run_id);

CREATE INDEX ix_schedule_dispatches_schedule_id ON schedule_dispatches (schedule_id);

CREATE INDEX ix_schedule_dispatches_scheduled_for ON schedule_dispatches (scheduled_for);

CREATE INDEX ix_schedule_dispatches_status ON schedule_dispatches (status);

CREATE INDEX ix_schedule_dispatches_workspace_id ON schedule_dispatches (workspace_id);

CREATE INDEX ix_sessions_user_id ON sessions (user_id);

CREATE INDEX ix_tool_skill_asset_invocations_agent_id ON tool_skill_asset_invocations (agent_id);

CREATE INDEX ix_tool_skill_asset_invocations_asset_id ON tool_skill_asset_invocations (asset_id);

CREATE INDEX ix_tool_skill_asset_invocations_asset_type ON tool_skill_asset_invocations (asset_type);

CREATE INDEX ix_tool_skill_asset_invocations_node_run_id ON tool_skill_asset_invocations (node_run_id);

CREATE INDEX ix_tool_skill_asset_invocations_run_id ON tool_skill_asset_invocations (run_id);

CREATE INDEX ix_tool_skill_asset_invocations_status ON tool_skill_asset_invocations (status);

CREATE INDEX ix_tool_skill_asset_invocations_workspace_id ON tool_skill_asset_invocations (workspace_id);

CREATE INDEX ix_tool_skill_assets_asset_type ON tool_skill_assets (asset_type);

CREATE INDEX ix_tool_skill_assets_workspace_id ON tool_skill_assets (workspace_id);

CREATE INDEX ix_users_organization_id ON users (organization_id);

CREATE INDEX ix_workflow_runs_agent_id ON workflow_runs (agent_id);

CREATE INDEX ix_workflow_runs_trace_id ON workflow_runs (trace_id);

CREATE INDEX ix_workflow_runs_workflow_id ON workflow_runs (workflow_id);

CREATE INDEX ix_workflow_runs_workspace_id ON workflow_runs (workspace_id);

CREATE INDEX ix_workflow_schedules_last_run_id ON workflow_schedules (last_run_id);

CREATE INDEX ix_workflow_schedules_next_run_at ON workflow_schedules (next_run_at);

CREATE INDEX ix_workflow_schedules_status ON workflow_schedules (status);

CREATE INDEX ix_workflow_schedules_workflow_id ON workflow_schedules (workflow_id);

CREATE INDEX ix_workflow_schedules_workflow_version_id ON workflow_schedules (workflow_version_id);

CREATE INDEX ix_workflow_schedules_workspace_id ON workflow_schedules (workspace_id);

CREATE INDEX ix_workflow_versions_workflow_id ON workflow_versions (workflow_id);

CREATE INDEX ix_workflow_versions_workspace_id ON workflow_versions (workspace_id);

CREATE INDEX ix_workflows_workspace_id ON workflows (workspace_id);

CREATE INDEX ix_workspace_memberships_user_id ON workspace_memberships (user_id);

CREATE INDEX ix_workspace_memberships_workspace_id ON workspace_memberships (workspace_id);

CREATE INDEX ix_workspaces_organization_id ON workspaces (organization_id);
