# Security Policy

ARC.ONE is currently a deployable prototype. Do not expose real business data unless the deployment is protected by an external access layer such as Cloudflare Access, VPN, or an equivalent identity gateway.

The full deployment security checklist is maintained in:

- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `docs/DEPLOYMENT_VALUES.template.md`

## Supported Scope

Security expectations currently covered by the repository:

- Cloudflare Pages security headers and SPA redirects.
- Production API origin configuration through `VITE_API_BASE_URL`.
- FastAPI CORS allowlist, trusted host allowlist, security headers, HSTS switch, and `/api/health`.
- Production startup guardrails for PostgreSQL, HTTPS origins, public API hosts, secure cookies, and model API key presence.
- CI checks for frontend tests, backend tests, lint, build, and deployment configuration.
- Dependabot monitoring for npm, Python/pip, and GitHub Actions.

## Known Prototype Limitations

The following are not complete yet:

- Login and session lifecycle.
- CSRF flow.
- User, Organization, Workspace, Membership, and RBAC.
- API-level authorization checks.
- Request rate limiting and quota enforcement.

Until these are implemented, protect both frontend and backend behind an external access control layer.

## Reporting

Do not place secrets, tokens, keys, logs with credentials, or private customer data in GitHub issues or pull requests. Share sensitive details only through a private channel controlled by the repository owner.
