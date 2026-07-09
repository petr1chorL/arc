import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const requiredFiles = [
  '.env.example',
  '.github/dependabot.yml',
  '.github/workflows/deploy-pages.yml',
  'SECURITY.md',
  'apps/api/.env.example',
  'docs/DEPLOYMENT.md',
  'docs/DEPLOYMENT_VALUES.template.md',
  'docs/SECURITY.md',
  'public/_headers',
  'public/_redirects',
  'render.yaml',
  'scripts/write-cloudflare-headers.mjs',
  'wrangler.toml',
]

const checks = [
  {
    name: 'GitHub security policy points to the prototype security checklist',
    file: 'SECURITY.md',
    patterns: [
      /Security Policy/,
      /docs\/SECURITY\.md/,
      /Cloudflare Access/,
      /Known Prototype Limitations/,
      /Do not place secrets/,
    ],
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
    name: 'GitHub Actions can deploy the frontend to Cloudflare Pages',
    file: '.github/workflows/deploy-pages.yml',
    patterns: [
      /name: Deploy Cloudflare Pages/,
      /workflow_dispatch:/,
      /vars\.CLOUDFLARE_PAGES_AUTO_DEPLOY == 'true'/,
      /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/,
      /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/,
      /VITE_API_BASE_URL: \$\{\{ vars\.VITE_API_BASE_URL \}\}/,
      /npm run build:pages/,
      /npx wrangler@4 pages project create/,
      /npx wrangler@4 pages deploy dist/,
    ],
  },
  {
    name: 'Cloudflare Pages Wrangler config points at the Vite build output',
    file: 'wrangler.toml',
    patterns: [
      /name = "arc-one"/,
      /pages_build_output_dir = "\.\/dist"/,
      /compatibility_date = "2026-07-09"/,
    ],
  },
  {
    name: 'Package scripts include a Cloudflare Pages build that tightens CSP',
    file: 'package.json',
    patterns: [
      /"build:pages": "npm run build && node scripts\/write-cloudflare-headers\.mjs"/,
    ],
  },
  {
    name: 'Cloudflare Pages build script can narrow connect-src to the API origin',
    file: 'scripts/write-cloudflare-headers.mjs',
    patterns: [
      /process\.env\.VITE_API_BASE_URL/,
      /new URL\(apiBaseUrl\)\.origin/,
      /connect-src 'self' \$\{connectSource\}/,
    ],
  },
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
      /MAX_REQUEST_BODY_BYTES=1048576/,
      /RATE_LIMIT_ENABLED=true/,
      /RATE_LIMIT_REQUESTS=120/,
      /RATE_LIMIT_WINDOW_SECONDS=60/,
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
      /key: MAX_REQUEST_BODY_BYTES\s+value: "1048576"/s,
      /key: RATE_LIMIT_ENABLED\s+value: "true"/s,
      /key: RATE_LIMIT_REQUESTS\s+value: "120"/s,
      /key: RATE_LIMIT_WINDOW_SECONDS\s+value: "60"/s,
    ],
  },
  {
    name: 'Deployment values template keeps platform settings in one place',
    file: 'docs/DEPLOYMENT_VALUES.template.md',
    patterns: [
      /Repository: https:\/\/github\.com\/petr1chorL\/arc/,
      /Project name: arc-one/,
      /VITE_API_BASE_URL=https:\/\/<render-api-host>/,
      /ALLOWED_ORIGINS=https:\/\/<cloudflare-pages-host>/,
      /RATE_LIMIT_ENABLED=true/,
      /MODEL_API_KEY=<set in Render secret manager>/,
      /npm run deploy:check:live/,
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
      /npm run build:pages/,
      /deploy-pages\.yml/,
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
