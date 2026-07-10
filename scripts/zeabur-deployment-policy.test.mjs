import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  assertAutomaticTarget,
  hasSuccessfulMasterPushCi,
  shouldAutoDeploy,
} from './zeabur-deployment-policy.mjs'

describe('shouldAutoDeploy', () => {
  const approvedEvent = {
    autoDeploy: 'true',
    conclusion: 'success',
    eventName: 'workflow_run',
    headBranch: 'master',
    sourceEvent: 'push',
  }

  it('accepts only successful master push CI when auto deploy is enabled', () => {
    expect(shouldAutoDeploy(approvedEvent)).toBe(true)
    expect(shouldAutoDeploy({ ...approvedEvent, sourceEvent: 'pull_request' })).toBe(false)
    expect(shouldAutoDeploy({ ...approvedEvent, conclusion: 'failure' })).toBe(false)
    expect(shouldAutoDeploy({ ...approvedEvent, headBranch: 'feature' })).toBe(false)
    expect(shouldAutoDeploy({ ...approvedEvent, autoDeploy: 'false' })).toBe(false)
  })
})

describe('assertAutomaticTarget', () => {
  it('rejects a late CI run for an older master commit', () => {
    expect(() => assertAutomaticTarget('same-sha', 'same-sha')).not.toThrow()
    expect(() => assertAutomaticTarget('older-sha', 'newer-sha')).toThrow(
      'Automatic deployment revision is no longer the current origin/master',
    )
  })
})

describe('hasSuccessfulMasterPushCi', () => {
  const targetSha = 'a'.repeat(40)

  it('requires an exact successful push CI on master', () => {
    expect(
      hasSuccessfulMasterPushCi(
        [
          {
            conclusion: 'success',
            event: 'push',
            head_branch: 'master',
            head_sha: targetSha,
          },
        ],
        targetSha,
      ),
    ).toBe(true)

    for (const candidate of [
      { conclusion: 'success', event: 'pull_request', head_branch: 'master', head_sha: targetSha },
      { conclusion: 'success', event: 'push', head_branch: 'feature', head_sha: targetSha },
      { conclusion: 'failure', event: 'push', head_branch: 'master', head_sha: targetSha },
      { conclusion: 'success', event: 'push', head_branch: 'master', head_sha: 'b'.repeat(40) },
    ]) {
      expect(hasSuccessfulMasterPushCi([candidate], targetSha)).toBe(false)
    }
  })
})

describe('Deploy Zeabur workflow security boundaries', () => {
  const workflow = readFileSync('.github/workflows/deploy-zeabur.yml', 'utf8')

  it('limits the token to the deploy step and removes CLI credentials afterwards', () => {
    const jobHeader = workflow.slice(workflow.indexOf('jobs:'), workflow.indexOf('    steps:'))
    expect(jobHeader).not.toContain('ZEABUR_TOKEN')
    expect(workflow.match(/secrets\.ZEABUR_TOKEN/g)).toHaveLength(1)
    expect(workflow).toContain('npx --yes "zeabur@${ZEABUR_CLI_VERSION}" auth logout')
  })

  it('uses the current automation policy and a separate target checkout', () => {
    expect(workflow).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow).toContain('path: .delivery')
    expect(workflow).toContain('path: source')
    expect(workflow).toContain('zeabur-deployment-policy.mjs assert-target')
    expect(workflow).toContain('zeabur-deployment-policy.mjs assert-ci')
  })
})
