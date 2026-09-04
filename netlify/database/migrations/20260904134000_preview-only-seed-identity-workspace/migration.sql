-- PREVIEW ONLY: synthetic identities for the temporary Deploy Preview rehearsal.
-- This migration must be removed before promoting the implementation to Production.
INSERT INTO organizations
    (id, name, slug, status, created_at, updated_at)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'ARC.ONE Preview Organization',
     'arc-one-preview', 'active', '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z');

INSERT INTO users
    (id, organization_id, email, normalized_email, display_name, password_hash, status,
     is_organization_admin, failed_login_count, locked_until, password_changed_at,
     last_login_at, last_workspace_id, created_at, updated_at)
VALUES
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
     'netlify-preview-admin@arc-one.invalid', 'netlify-preview-admin@arc-one.invalid',
     'Preview Admin',
     '$argon2id$v=19$m=65536,t=3,p=4$aDyKH1F/wTEq5XGUlnqKUw$XuDAaTrn2LTNBU6GQ9FGKxkTRNTUpUeZZQWFMDQV/Ks',
     'active', TRUE, 0, NULL, NULL, NULL, '44444444-4444-4444-8444-444444444444',
     '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z'),
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
     'netlify-preview-viewer@arc-one.invalid', 'netlify-preview-viewer@arc-one.invalid',
     'Preview Viewer',
     '$argon2id$v=19$m=65536,t=3,p=4$oAEEw2sye3OeTr+12H9E+w$JOhr+doisOVImjVdBxun1+Y4uODJ1rLTfYQDDd9U/E0',
     'active', FALSE, 0, NULL, NULL, NULL, '44444444-4444-4444-8444-444444444444',
     '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z');

INSERT INTO workspaces
    (id, organization_id, name, slug, status, created_by, created_at, updated_at)
VALUES
    ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
     'ARC.ONE Preview Workspace', 'arc-one-preview', 'active',
     '22222222-2222-4222-8222-222222222222', '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z');

INSERT INTO workspace_memberships
    (id, workspace_id, user_id, role, status, invited_by, activated_at, created_at, updated_at)
VALUES
    ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
     '22222222-2222-4222-8222-222222222222', 'workspace_admin', 'active',
     '22222222-2222-4222-8222-222222222222', '2026-09-04T00:00:00Z',
     '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z'),
    ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
     '33333333-3333-4333-8333-333333333333', 'viewer', 'active',
     '22222222-2222-4222-8222-222222222222', '2026-09-04T00:00:00Z',
     '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z');
