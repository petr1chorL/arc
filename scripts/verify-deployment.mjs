import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const requiredFiles = [
  '.env.example',
  'apps/api/.env.example',
  'docs/DEPLOYMENT.md',
  'docs/SECURITY.md',
  'public/_headers',
  'public/_redirects',
  'render.yaml',
]

const checks = [
  {
    name: 'Cloudflare Pages security headers include CSP and frame protection',
    file: 'public/_headers',
    patterns: [
      /Content-Security-Policy:/,
      /frame-ancestors 'none'/,
      /X-Frame-Options: DENY/,
      /X-Content-Type-Options: nosniff/,
    ],
  },
  {
    name: 'Cloudflare Pages redirects support SPA routes',
    file: 'public/_redirects',
    patterns: [/\/\*\s+\/index\.html\s+200/],
  },
  {
    name: 'Frontend environment example points at a public API origin',
    file: '.env.example',
    patterns: [/VITE_API_BASE_URL=https:\/\/your-api\.example\.com/],
  },
  {
    name: 'Backend environment example requires production-safe settings',
    file: 'apps/api/.env.example',
    patterns: [
      /ENVIRONMENT=production/,
      /DATABASE_URL=postgresql\+psycopg:\/\//,
      /ALLOWED_ORIGINS=https:\/\//,
      /ALLOWED_HOSTS=/,
      /HSTS_ENABLED=true/,
      /COOKIE_SECURE=true/,
      /MODEL_API_KEY=/,
    ],
  },
  {
    name: 'Render blueprint configures API, Postgres, health check, and required secrets',
    file: 'render.yaml',
    patterns: [
      /name: arc-one-api/,
      /rootDir: apps\/api/,
      /healthCheckPath: \/api\/health/,
      /name: arc-one-postgres/,
      /key: ENVIRONMENT\s+value: production/s,
      /key: DATABASE_URL\s+fromDatabase:/s,
      /key: ALLOWED_ORIGINS\s+sync: false/s,
      /key: ALLOWED_HOSTS\s+sync: false/s,
      /key: MODEL_API_KEY\s+sync: false/s,
    ],
  },
  {
    name: 'Security documentation states public prototype access control requirements',
    file: 'docs/SECURITY.md',
    patterns: [
      /Cloudflare Access/,
      /CORS 不等于保护 API/,
      /ENVIRONMENT=production/,
      /生产启动保护/,
    ],
  },
  {
    name: 'Deployment documentation includes frontend, backend, and CI steps',
    file: 'docs/DEPLOYMENT.md',
    patterns: [
      /Cloudflare Pages/,
      /render\.yaml/,
      /VITE_API_BASE_URL/,
      /ALLOWED_ORIGINS/,
      /GitHub Actions CI/,
    ],
  },
]

const failures = []

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing required deployment file: ${file}`)
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
}

if (failures.length > 0) {
  console.error('Deployment verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Deployment verification passed.')
