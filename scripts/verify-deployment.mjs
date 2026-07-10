import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const requiredFiles = [
  '.env.example',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy-zeabur.yml',
  'SECURITY.md',
  'apps/api/.dockerignore',
  'apps/api/.env.example',
  'apps/api/Dockerfile',
  'docs/CURRENT_IMPLEMENTATION.md',
  'docs/DEPLOYMENT.md',
  'docs/DEPLOYMENT_VALUES.template.md',
  'docs/SECURITY.md',
  'docs/ZEABUR_DEPLOYMENT.md',
  'Dockerfile',
  'nginx.conf.template',
  'scripts/check-live-deployment.mjs',
]

const forbiddenFiles = [
  '.github/workflows/deploy-pages.yml',
  'public/_headers',
  'public/_redirects',
  'render.yaml',
  'scripts/write-cloudflare-headers.mjs',
  'scripts/write-cloudflare-headers.test.mjs',
  'wrangler.toml',
]

const checks = [
  {
    name: 'GitHub security policy points to the Zeabur prototype checklist',
    file: 'SECURITY.md',
    patterns: [
      /Security Policy/,
      /GitHub \+ Zeabur \+ Zeabur PostgreSQL/,
      /docs\/SECURITY\.md/,
      /Known Prototype Limitations/,
      /不要在.*放入密钥/s,
    ],
    forbiddenPatterns: [/Cloudflare Pages/, /Render Blueprint/, /wrangler/i],
  },
  {
    name: 'Dependabot watches npm, pip, and GitHub Actions updates',
    file: '.github/dependabot.yml',
    patterns: [
      /package-ecosystem: npm/,
      /package-ecosystem: pip/,
      /directory: \/apps\/api/,
      /package-ecosystem: github-actions/,
      /interval: weekly/,
    ],
  },
  {
    name: 'CI verifies tests, lint, deployment config, and production build',
    file: '.github/workflows/ci.yml',
    patterns: [
      /name: CI/,
      /branches: \[master, main\]/,
      /npm test -- --run/,
      /python -m pytest apps\/api\/tests -q/,
      /npm run lint/,
      /npm run deploy:check/,
      /npm run build/,
    ],
  },
  {
    name: 'Package scripts expose deployment verification entrypoints',
    file: 'package.json',
    patterns: [
      /"deploy:check": "node scripts\/verify-deployment\.mjs"/,
      /"deploy:check:live": "node scripts\/check-live-deployment\.mjs"/,
    ],
    forbiddenPatterns: [/build:pages/],
  },
  {
    name: 'GitHub Actions deploys the exact CI-approved commit to Zeabur',
    file: '.github/workflows/deploy-zeabur.yml',
    patterns: [
      /name: Deploy Zeabur/,
      /workflow_run:/,
      /workflows: \[CI\]/,
      /workflow_dispatch:/,
      /vars\.ZEABUR_AUTO_DEPLOY == 'true'/,
      /secrets\.ZEABUR_TOKEN/,
      /vars\.ZEABUR_PROJECT_ID/,
      /vars\.ZEABUR_SERVICE_ID/,
      /vars\.ZEABUR_ENVIRONMENT_ID/,
      /vars\.ZEABUR_PRODUCTION_URL/,
      /ZEABUR_CLI_VERSION: 0\.19\.0/,
      /npx --yes "zeabur@\$\{ZEABUR_CLI_VERSION\}" auth login/,
      /npx --yes "zeabur@\$\{ZEABUR_CLI_VERSION\}" deploy/,
      /url\.pathname !== '\/'/,
      /public\/deployment\.json/,
      /deployment\.json\?sha=/,
      /npm run deploy:check:live/,
      /node scripts\/check-live-deployment\.mjs/,
      /cancel-in-progress: false/,
    ],
  },
  {
    name: 'Zeabur Docker image serves the frontend and API together',
    file: 'Dockerfile',
    patterns: [
      /FROM node:22-alpine AS web-build/,
      /RUN VITE_API_BASE_URL= npm run build\s/,
      /FROM python:3\.12-slim/,
      /python -m pip install --no-cache-dir -e "\.\[postgres\]"/,
      /uvicorn app\.main:app --app-dir \/app\/api --host 127\.0\.0\.1 --port 8000/,
      /nginx -g 'daemon off;'/,
    ],
    forbiddenPatterns: [/build:pages/],
  },
  {
    name: 'Zeabur Nginx config proxies API requests to local FastAPI',
    file: 'nginx.conf.template',
    patterns: [
      /listen \$\{PORT\}/,
      /X-Content-Type-Options "nosniff"/,
      /X-Frame-Options "DENY"/,
      /Content-Security-Policy "default-src 'self'/,
      /frame-ancestors 'none'/,
      /connect-src 'self';/,
      /location \/api\//,
      /proxy_pass http:\/\/127\.0\.0\.1:8000/,
      /try_files \$uri \$uri\/ \/index\.html/,
    ],
  },
  {
    name: 'Compose backend Dockerfile remains available for API and worker',
    file: 'apps/api/Dockerfile',
    patterns: [
      /FROM python:3\.12-slim/,
      /python -m pip install --no-cache-dir -e "\.\[postgres\]"/,
      /EXPOSE 8080/,
      /uvicorn app\.main:app --host 0\.0\.0\.0 --port \$\{PORT:-8080\}/,
    ],
  },
  {
    name: 'Frontend environment example documents same-origin production API',
    file: '.env.example',
    patterns: [/VITE_API_BASE_URL=/, /same-origin \/api/],
    forbiddenPatterns: [/pages\.dev/, /your-api\.example\.com/],
  },
  {
    name: 'Backend environment example requires production-safe Zeabur settings',
    file: 'apps/api/.env.example',
    patterns: [
      /ENVIRONMENT=production/,
      /DATABASE_URL=postgresql\+psycopg:\/\//,
      /ALLOWED_ORIGINS=https:\/\//,
      /ALLOWED_HOSTS=/,
      /HSTS_ENABLED=true/,
      /MAX_REQUEST_BODY_BYTES=1048576/,
      /RATE_LIMIT_ENABLED=true/,
      /COOKIE_SECURE=true/,
      /MODEL_ALLOWED_HOSTS=api\.deepseek\.com/,
    ],
    forbiddenPatterns: [/pages\.dev/],
  },
  {
    name: 'Deployment entrypoint describes the single CI-gated Zeabur flow',
    file: 'docs/DEPLOYMENT.md',
    patterns: [
      /GitHub \+ Zeabur \+ Zeabur PostgreSQL/,
      /worktree.*Pull Request.*CI.*master.*Zeabur/s,
      /ZEABUR_AUTO_DEPLOY/,
      /deployment\.json/,
      /npm run deploy:check:live/,
    ],
    forbiddenPatterns: [/Cloudflare Pages/, /Render Blueprint/, /wrangler/i, /render\.yaml/],
  },
  {
    name: 'Deployment values template contains only Zeabur delivery settings',
    file: 'docs/DEPLOYMENT_VALUES.template.md',
    patterns: [
      /ZEABUR_TOKEN=<set in GitHub Actions secret>/,
      /ZEABUR_PROJECT_ID=/,
      /ZEABUR_SERVICE_ID=/,
      /ZEABUR_ENVIRONMENT_ID=/,
      /ZEABUR_PRODUCTION_URL=/,
      /ZEABUR_AUTO_DEPLOY=/,
      /MODEL_ALLOWED_HOSTS=api\.deepseek\.com/,
    ],
    forbiddenPatterns: [/Cloudflare Pages/, /Render/, /wrangler/i, /pages\.dev/],
  },
  {
    name: 'Zeabur runbook describes same-origin service and CI automation',
    file: 'docs/ZEABUR_DEPLOYMENT.md',
    patterns: [
      /同源应用服务/,
      /Zeabur PostgreSQL/,
      /根目录 `Dockerfile`/,
      /deploy-zeabur\.yml/,
      /ZEABUR_TOKEN/,
      /deployment\.json/,
      /\/api\/health/,
    ],
    forbiddenPatterns: [/arc-web/, /arc-api-live/, /前后端拆分/],
  },
  {
    name: 'Security documentation covers same-origin and deployment provenance',
    file: 'docs/SECURITY.md',
    patterns: [
      /Nginx/,
      /FastAPI/,
      /ZEABUR_TOKEN/,
      /commit SHA/,
      /deployment\.json/,
      /ENVIRONMENT=production/,
    ],
    forbiddenPatterns: [/Cloudflare Pages/, /wrangler/i, /render\.yaml/],
  },
  {
    name: 'Current implementation records the Zeabur-only delivery boundary',
    file: 'docs/CURRENT_IMPLEMENTATION.md',
    patterns: [
      /GitHub \+ Zeabur \+ Zeabur PostgreSQL/,
      /CI.*master.*Zeabur/s,
      /deployment\.json/,
    ],
  },
  {
    name: 'Live deployment check validates homepage, health, headers, and CORS',
    file: 'scripts/check-live-deployment.mjs',
    patterns: [
      /FRONTEND_URL/,
      /API_URL/,
      /\/api\/health/,
      /x-content-type-options/,
      /x-frame-options/,
      /access-control-allow-origin/,
      /Live deployment check passed/,
    ],
  },
]

const failures = []

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing required deployment file: ${file}`)
  }
}

for (const file of forbiddenFiles) {
  if (existsSync(join(root, file))) {
    failures.push(`Legacy deployment file must be removed: ${file}`)
  }
}

for (const check of checks) {
  const path = join(root, check.file)
  if (!existsSync(path)) {
    continue
  }
  const content = readFileSync(path, 'utf8')
  for (const pattern of check.patterns) {
    if (!pattern.test(content)) {
      failures.push(`${check.name}: ${check.file} does not match ${pattern}`)
    }
  }
  for (const pattern of check.forbiddenPatterns ?? []) {
    if (pattern.test(content)) {
      failures.push(`${check.name}: ${check.file} must not match ${pattern}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Deployment verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Deployment verification passed.')
