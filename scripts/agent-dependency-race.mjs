import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createAgentsHandler } from '../netlify/functions/_shared/agents/handler.ts'
import { createPostgresAgentsBackend } from '../netlify/functions/_shared/agents/postgres.ts'

/** Controlled SQL-writer race in the caller's exact synthetic schema; no production endpoints. */
export async function testAgentDependencyRaces({ pool, admin, schema, cookie, csrf, equal }) {
  const normal = createAgentsHandler(createPostgresAgentsBackend(pool), { clientAddress: '192.0.2.30' })
  const invoke = (handler, path, method, body) => handler(new Request(`https://synthetic.invalid/api/workspaces/a/agents${path}`, {
    method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  for (const kind of ['provider', 'tool', 'skill']) {
    const id = randomUUID()
    const name = `Synthetic race ${kind}`
    const now = new Date()
    const table = kind === 'provider' ? 'model_providers' : 'tool_skill_assets'
    if (kind === 'provider') await pool.query(`INSERT INTO model_providers
      (id,workspace_id,name,provider_type,base_url,default_model,secret_ref,status,created_by,created_at,updated_at)
      VALUES ($1,'a',$2,'openai-compatible','https://models.example.invalid','synthetic','SYNTHETIC_KEY','draft','actor',$3,$3)`, [id, name, now])
    else await pool.query(`INSERT INTO tool_skill_assets
      (id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at)
      VALUES ($1,'a',$2,$3,'','{}','manual','{}','active','actor',$4,$4)`, [id, kind, name, now])
    const created = await invoke(normal, '', 'POST', { name, role: 'Synthetic', owner: 'Synthetic', model: 'synthetic',
      ...(kind === 'provider' ? { modelProviderId: id } : {}) })
    equal(created.status, 201, `${kind} race draft created`)
    const agent = await created.json()
    if (kind !== 'provider') equal((await invoke(normal, `/${agent.id}`, 'PATCH', { [`${kind}s`]: [name] })).status,
      200, `${kind} race dependency bound`)
    let resume, signalReady, publisherPid
    const released = new Promise(resolve => { resume = resolve })
    const ready = new Promise(resolve => { signalReady = resolve })
    const gatedPool = {
      async connect() {
        const client = await pool.connect()
        publisherPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        return {
          async query(sql, values) {
            if (sql.startsWith('SELECT count(*)::int AS n FROM agent_versions') && values?.includes(agent.id)) {
              signalReady()
              await released
            }
            return client.query(sql, values)
          },
          release() { client.release() },
        }
      },
    }
    const publisher = createAgentsHandler(createPostgresAgentsBackend(gatedPool), { clientAddress: '192.0.2.31' })
    const publishing = invoke(publisher, `/${agent.id}/publish`, 'POST')
    const disablingClient = await admin.connect()
    let disabling
    try {
      const abort = new AbortController()
      try {
        await Promise.race([ready, publishing.then(response => { throw new Error(`Publish ended before lock gate: ${response.status}`) }),
          delay(5000, undefined, { signal: abort.signal }).then(() => { throw new Error('Publish did not reach dependency gate') })])
      } finally { abort.abort() }
      const disablingPid = (await disablingClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      disabling = disablingClient.query(`UPDATE ${schema}.${table} SET status='disabled' WHERE id=$1`, [id])
      let blocked = false
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && !blocked) {
        const blockers = (await admin.query('SELECT pg_blocking_pids($1) AS pids', [disablingPid])).rows[0].pids
        blocked = blockers.includes(publisherPid)
        if (!blocked) await delay(20)
      }
      equal(blocked, true, `${kind} disable waits on publisher dependency lock`)
      resume()
      const published = await publishing
      equal(published.status, 201, `${kind} publish commits before waiting disable`)
      await disabling
      equal((await invoke(normal, `/${agent.id}/publish`, 'POST')).status, 422, `${kind} disabled first rejects later publish`)
      equal((await pool.query('SELECT count(*)::int AS n FROM agent_versions WHERE agent_id=$1', [agent.id])).rows[0].n,
        1, `${kind} failed publish leaves no partial version`)
      equal((await invoke(normal, `/${agent.id}/versions`, 'GET')).status, 200, `${kind} disable preserves historical readability`)
    } finally {
      resume()
      await Promise.allSettled([publishing, ...(disabling ? [disabling] : [])])
      disablingClient.release()
    }
  }
}
