import { pathToFileURL } from 'node:url'

export function shouldAutoDeploy({
  autoDeploy,
  conclusion,
  eventName,
  headBranch,
  sourceEvent,
}) {
  return (
    eventName === 'workflow_run' &&
    conclusion === 'success' &&
    headBranch === 'master' &&
    sourceEvent === 'push' &&
    autoDeploy === 'true'
  )
}

export function assertAutomaticTarget(deploySha, currentMasterSha) {
  if (deploySha !== currentMasterSha) {
    throw new Error('Automatic deployment revision is no longer the current origin/master')
  }
}

export function hasSuccessfulMasterPushCi(workflowRuns, targetSha) {
  return workflowRuns.some(
    (run) =>
      run?.conclusion === 'success' &&
      run?.event === 'push' &&
      run?.head_branch === 'master' &&
      run?.head_sha === targetSha,
  )
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main([command, ...args]) {
  if (command === 'assert-target') {
    const [mode, deploySha, currentMasterSha] = args
    if (!['automatic', 'manual'].includes(mode) || !deploySha || !currentMasterSha) {
      throw new Error('Usage: assert-target <automatic|manual> <deploy-sha> <master-sha>')
    }
    if (mode === 'automatic') {
      assertAutomaticTarget(deploySha, currentMasterSha)
    }
    return
  }

  if (command === 'assert-ci') {
    const [targetSha] = args
    if (!targetSha) {
      throw new Error('Usage: assert-ci <target-sha>')
    }
    const body = JSON.parse(await readStdin())
    if (!hasSuccessfulMasterPushCi(body.workflow_runs ?? [], targetSha)) {
      throw new Error('The requested revision does not have a successful master push CI run')
    }
    return
  }

  throw new Error('Expected assert-target or assert-ci command')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
