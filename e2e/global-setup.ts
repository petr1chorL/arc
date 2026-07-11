import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const apiPort = 48100
const webPort = 48173

async function cleanupE2eDatabase(runId: string) {
  const databasePath = resolve(process.cwd(), '.scratch', 'e2e', `arc-one-e2e-${runId}.db`)
  for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await rm(path, { force: true })
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const isRetryable = code === 'EPERM' || code === 'EBUSY'
        if (!isRetryable || attempt === 29) throw error
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      }
    }
  }
}

function stopProcessTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    })
    return
  }
  child.kill('SIGTERM')
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return true
  return new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit(true)
    })
  })
}

async function stopApi(api: ChildProcess) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/__e2e__/shutdown`, {
      method: 'POST',
    })
    if (response.ok && await waitForExit(api, 10_000)) return
  } catch {
    // API 未完成启动时回退到进程树终止。
  }
  stopProcessTree(api)
}

async function waitForUrl(child: ChildProcess, url: string, label: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} 提前退出，退出码 ${child.exitCode}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 服务尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label} 在 120 秒内未就绪`)
}

export default async function globalSetup() {
  const runId = `${Date.now()}-${process.pid}`
  const python = process.env.ARC_ONE_E2E_PYTHON ?? (
    process.platform === 'win32'
      ? '.\\apps\\api\\.venv\\Scripts\\python.exe'
      : './apps/api/.venv/bin/python'
  )
  const api = spawn(python, ['-m', 'app.e2e_server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ARC_ONE_E2E_API_PORT: String(apiPort),
      ARC_ONE_E2E_RUN_ID: runId,
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  let web: ChildProcess | null = null
  try {
    await waitForUrl(api, `http://127.0.0.1:${apiPort}/api/health`, 'E2E API')
    api.unref()

    web = spawn(process.execPath, [
      './node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ARC_ONE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
      stdio: 'ignore',
      windowsHide: true,
    })
    await waitForUrl(web, `http://127.0.0.1:${webPort}`, 'E2E Web')
    web.unref()
  } catch (error) {
    if (web) stopProcessTree(web)
    await stopApi(api)
    await cleanupE2eDatabase(runId)
    throw error
  }

  return async () => {
    if (web) stopProcessTree(web)
    await stopApi(api)
    await cleanupE2eDatabase(runId)
  }
}
