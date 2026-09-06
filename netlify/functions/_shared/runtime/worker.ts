import type { SqlClient, SqlPool } from '../identity-workspace/postgres.ts'
import { appendOperationEvent, requestHash, runtimeWithTransaction, wakeOperation } from './ledger.ts'
import { ContinueOperation, LostLeaseError, NotSentError, RetryableOperationError, UncertainEffectError, WaitingReview,
  type Operation, type OperationExecutor, type RuntimeContext, type OperationStatus } from './types.ts'

export type OperationTransition = (client: SqlClient, operation: Operation) => Promise<void>

/** Expired in-flight effects are not replayable merely because a worker lease expired. */
export async function claimOperation(pool: SqlPool, id: string, onTransition?: OperationTransition): Promise<Operation | null> {
  return runtimeWithTransaction(pool, async client => {
    const row = (await client.query<Operation>('SELECT * FROM runtime_operations WHERE id=$1 FOR UPDATE', [id])).rows[0]
    if (!row || !['queued', 'running'].includes(row.status)) return null
    const eligible = (await client.query(`SELECT id FROM runtime_operations WHERE id=$1 AND
      ((status='queued' AND available_at<=clock_timestamp()) OR (status='running' AND locked_until<=clock_timestamp()))`, [id])).rows.length
    if (!eligible) return null
    const uncertain = (await client.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain') LIMIT 1", [id])).rows.length
    if (uncertain) {
      const next = (await client.query<Operation>("UPDATE runtime_operations SET status='needs_reconciliation',error='外部调用结果待核对',generation=generation+1,locked_until=NULL,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0]
      await appendOperationEvent(client, next, 'needs_reconciliation')
      await onTransition?.(client, next)
      return null
    }
    if (row.attempts >= row.max_attempts) {
      const next = (await client.query<Operation>("UPDATE runtime_operations SET status='dead_letter',error='任务重试次数已耗尽',locked_until=NULL,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0]
      await appendOperationEvent(client, next, 'dead_letter')
      await onTransition?.(client, next)
      return null
    }
    const claimed = (await client.query<Operation>(`UPDATE runtime_operations SET status='running',attempts=attempts+1,
      generation=generation+1,locked_until=clock_timestamp()+interval '120 seconds',updated_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0]
    await appendOperationEvent(client, claimed, 'claimed', { generation: claimed.generation })
    return claimed
  })
}

/** Lock and compare generation before every business write or external send intention. */
export async function requireLease(client: SqlClient, operation: Operation) {
  const row = (await client.query(`SELECT id FROM runtime_operations WHERE id=$1 AND workspace_id=$2 AND generation=$3
    AND status='running' AND locked_until>clock_timestamp() FOR UPDATE`, [operation.id, operation.workspace_id, operation.generation])).rows[0]
  if (!row) throw new LostLeaseError('任务已取消或执行权已转移')
  const runId = ['workflow.run','agent.run'].includes(operation.kind) ? operation.target_id
    : ['human.resume','workflow.resume'].includes(operation.kind) ? operation.input.runId : null
  if (runId) {
    const run = (await client.query('SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR SHARE', [operation.workspace_id, runId])).rows[0]
    if (run?.status === '已取消') throw new Error('关联运行已取消')
  }
}

function createContext(pool: SqlPool, operation: Operation): RuntimeContext {
  const transaction = <T>(fn: (client: SqlClient) => Promise<T>) => runtimeWithTransaction(pool, async client => {
    await requireLease(client, operation)
    return fn(client)
  })
  return { pool, transaction, async effect<T>(key: string, input: unknown, send: () => Promise<T>, beforeIntent?: (client: SqlClient) => Promise<void>): Promise<T> {
    if (!key || key.length > 200) throw new Error('无效副作用键')
    const hash = requestHash(input)
    const intent = await transaction(async client => {
      const old = (await client.query('SELECT * FROM runtime_effects WHERE operation_id=$1 AND effect_key=$2 FOR UPDATE', [operation.id, key])).rows[0]
      if (old) {
        if (old.request_hash !== hash) throw new Error('恢复请求与固定输入不一致')
        if (old.status === 'succeeded') return { cached: true, result: old.result as T, attempt: Number(old.attempt) }
        if (old.status !== 'not_sent') throw new UncertainEffectError('外部调用结果待核对')
        await beforeIntent?.(client)
        await client.query("UPDATE runtime_effects SET status='started',updated_at=now() WHERE operation_id=$1 AND effect_key=$2", [operation.id, key])
      } else {
        await beforeIntent?.(client)
        await client.query(`INSERT INTO runtime_effects(operation_id,effect_key,request_hash,status) VALUES($1,$2,$3,'started')`, [operation.id, key, hash])
      }
      return { cached: false, result: undefined, attempt: old ? Number(old.attempt) : 1 }
    })
    if (intent.cached) return intent.result as T
    let result: T
    try { result = await send() }
    catch (error) {
      // Independent effect evidence survives a canceled/expired owner, but cannot advance business state.
      await runtimeWithTransaction(pool, client => client.query(`UPDATE runtime_effects SET status=$3,updated_at=now()
        WHERE operation_id=$1 AND effect_key=$2 AND status='started' AND attempt=$4`, [operation.id, key, error instanceof NotSentError ? 'not_sent' : 'uncertain', intent.attempt]))
      if (error instanceof NotSentError) throw error
      throw new UncertainEffectError('外部调用结果待核对')
    }
    // JSON serialization and commit failures leave 'started'; subsequent recovery stops for reconciliation.
    await runtimeWithTransaction(pool, client => client.query(`UPDATE runtime_effects SET status='succeeded',result=$3,updated_at=now()
      WHERE operation_id=$1 AND effect_key=$2 AND status='started' AND attempt=$4`, [operation.id, key, JSON.stringify(result ?? null), intent.attempt]))
    return result
  } }
}

/** One bounded invocation, not an unbounded loop spanning a whole workflow. */
export async function executeOperation(pool: SqlPool, id: string, execute: OperationExecutor, onTransition?: OperationTransition): Promise<Operation | null> {
  const op = await claimOperation(pool, id, onTransition)
  if (!op) return null
  let status: OperationStatus = 'succeeded', result: unknown = null, error = ''
  try { result = await execute(op, createContext(pool, op)) }
  catch (failure) {
    if (failure instanceof LostLeaseError) return null
    if (failure instanceof WaitingReview) status = 'waiting_review'
    else if (failure instanceof ContinueOperation) status = 'queued'
    else if (failure instanceof UncertainEffectError) { status = 'needs_reconciliation'; error = '外部调用结果待核对' }
    else if (failure instanceof NotSentError || failure instanceof RetryableOperationError) {
      status = op.attempts >= op.max_attempts ? 'dead_letter' : 'queued'; error = '任务暂时无法执行'
    } else { status = 'failed'; error = '任务执行失败' }
  }
  return runtimeWithTransaction(pool, async client => {
    const unsettled = (await client.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain') LIMIT 1", [id])).rows.length
    if (unsettled) { status = 'needs_reconciliation'; error = '外部调用结果待核对' }
    const next = (await client.query<Operation>(`UPDATE runtime_operations SET status=$3,result=$4,error=$5,locked_until=NULL,
      available_at=clock_timestamp()+($6 * interval '1 second'),updated_at=now()
      WHERE id=$1 AND generation=$2 AND status='running' AND locked_until>clock_timestamp() RETURNING *`,
    [id, op.generation, status, JSON.stringify(result ?? null), error, status === 'queued' && error ? Math.min(300, 2 ** op.attempts) : 0])).rows[0]
    if (!next) return null
    await appendOperationEvent(client, next, status)
    if (status === 'queued') {
      // Successful node checkpoint continuation does not consume the failure retry budget.
      if (!error) await client.query('UPDATE runtime_operations SET attempts=0 WHERE id=$1', [id])
      await wakeOperation(client, id, `generation:${op.generation}`, new Date(Date.now() + (error ? Math.min(300, 2 ** op.attempts) * 1000 : 0)))
    }
    // Business projections and operation state share a commit; neither can get stranded alone.
    await onTransition?.(client, next)
    return next
  })
}

/** AWL is at-least-once; only an explicit send success acknowledges an outbox row. */
export async function dispatchOperationEvents(pool: SqlPool,
  send: (id: string) => Promise<{ sendStatus: string; eventId?: string }>, limit = 20,
  options:{sendTimeoutMs?:number;batchTimeoutMs?:number}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('唤醒批次上限无效')
  const sendTimeout=options.sendTimeoutMs??5000,batchTimeout=options.batchTimeoutMs??20000
  if(!Number.isInteger(sendTimeout)||sendTimeout<1||sendTimeout>5000||!Number.isInteger(batchTimeout)||batchTimeout<1||batchTimeout>20000)throw new Error('唤醒时限无效')
  const deadline=Date.now()+batchTimeout
  await recoverOperationWakeups(pool,limit)
  const client = await pool.connect()
  try {
    const pending = (await client.query(`SELECT id,operation_id FROM runtime_event_outbox
      WHERE status='pending' AND available_at<=clock_timestamp() ORDER BY created_at LIMIT $1`, [Math.max(1, Math.min(100, limit))])).rows
    let sent = 0,considered=0
    for (const row of pending) {
      if(Date.now()>=deadline)break
      considered++
      let response: { sendStatus: string; eventId?: string }
      let timeout:ReturnType<typeof setTimeout>|undefined
      try { response = await Promise.race([send(String(row.operation_id)),new Promise<{sendStatus:string}>(resolve=>{timeout=setTimeout(()=>resolve({sendStatus:'failed'}),Math.min(sendTimeout,Math.max(1,deadline-Date.now())))})]) }
      catch { response = { sendStatus: 'failed' } }
      finally{if(timeout)clearTimeout(timeout)}
      await client.query(`UPDATE runtime_event_outbox SET attempts=attempts+1,status=$2,event_id=$3 WHERE id=$1 AND status='pending'`,
        [row.id, response.sendStatus === 'succeeded' ? 'sent' : 'pending', response.eventId ?? null])
      if (response.sendStatus === 'succeeded') sent++
    }
    return { considered, sent }
  } finally { client.release() }
}

/** A platform send acknowledgement is not proof that a worker ran the business task. */
export async function recoverOperationWakeups(pool:SqlPool,limit=20) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('恢复批次上限无效')
  return runtimeWithTransaction(pool,async client=>{
    const stale=(await client.query(`SELECT o.id,o.generation,floor(extract(epoch FROM clock_timestamp())/60)::bigint slot
      FROM runtime_operations o WHERE
      ((o.status='queued' AND o.available_at<=clock_timestamp() AND o.updated_at<=clock_timestamp()-interval '60 seconds')
       OR (o.status='running' AND o.locked_until<=clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM runtime_event_outbox e WHERE e.operation_id=o.id AND e.status='pending')
      AND NOT EXISTS(SELECT 1 FROM runtime_event_outbox e WHERE e.dispatch_key=o.id||':recovery:'||o.generation||':'||floor(extract(epoch FROM clock_timestamp())/60)::bigint)
      ORDER BY o.updated_at,o.id LIMIT $1 FOR UPDATE OF o SKIP LOCKED`,[limit])).rows
    for(const row of stale)await wakeOperation(client,String(row.id),`recovery:${row.generation}:${row.slot}`)
    return stale.length
  })
}
