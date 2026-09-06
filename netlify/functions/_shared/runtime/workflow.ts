import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient } from '../identity-workspace/postgres.ts'
import { object, type WorkflowNode, type WorkflowEdge } from '../workflows/policy.ts'
import { structuralErrors } from '../workflows/validation.ts'
import { enqueueOperation, appendOperationEvent } from './ledger.ts'
import { ContinueOperation, WaitingReview, type Operation, type OperationExecutor, type RuntimeContext } from './types.ts'
import type { ModelOutput, ModelRequest } from './gateway.ts'
import { prepareAgentToolInput, type AgentToolOptions } from './agent-tools.ts'

type Row = Record<string, unknown>
type Snapshot = { id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export type SubmitWorkflowInput = { workspaceId: string; workflowId: string; version?: string;
  inputText: string; idempotencyKey: string; actorId: string }
export type WorkflowDependencies = {
  toolOptions?: AgentToolOptions
  complete(request: ModelRequest): Promise<ModelOutput>
  remote?: ReturnType<typeof import('./gateway.ts').createRuntimeGateway>['remote']
  pauseForReview?: (client: SqlClient, input: { workspaceId: string; runId: string; nodeRunId: string; nodeId: string;
    sourceNodeId: string; config: Record<string, unknown>; artifactVersionId: string; actorId: string }) => Promise<unknown>
  evaluateNode?: (op: Operation, ctx: RuntimeContext, input: { rubricRef: unknown; artifactText: string;
    subjectId: string; runId: string; nodeRunId: string }) => Promise<ModelOutput & { score?: number }>
}

function parseSnapshot(value: unknown): Snapshot {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length > 500 || value.edges.length > 2000 || value.nodes.some(node => !object(node) || typeof node.id !== 'string' || typeof node.type !== 'string' || !object(node.data))) throw new ApiError(409, '工作流历史结构无效')
  const snapshot = value as unknown as Snapshot
  if (structuralErrors(snapshot.nodes, snapshot.edges).length) throw new ApiError(409, '工作流历史图结构无效')
  return snapshot
}

/** Fixed publication identity + operation + run are committed together by the caller. */
export async function submitWorkflow(client: SqlClient, args: SubmitWorkflowInput) {
  if (typeof args.inputText !== 'string' || args.inputText.length > 100000) throw new ApiError(422, '运行输入无效')
  const definition = (await client.query("SELECT * FROM workflows WHERE id=$1 AND workspace_id=$2 AND status<>'已删除' FOR SHARE", [args.workflowId, args.workspaceId])).rows[0]
  if (!definition) throw new ApiError(404, '工作流不存在')
  const version = (await client.query(`SELECT * FROM workflow_versions WHERE workflow_id=$1 AND workspace_id=$2
    AND ($3::text IS NULL OR version=$3) ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE`, [args.workflowId, args.workspaceId, args.version ?? null])).rows[0]
  if (!version) throw new ApiError(409, '工作流尚未发布该版本')
  const snapshot = parseSnapshot(version.snapshot)
  if (snapshot.id !== args.workflowId) throw new ApiError(409, '历史版本归属无效')
  const runId = randomUUID()
  const operation = await enqueueOperation(client, { workspaceId: args.workspaceId, kind: 'workflow.run',
    idempotencyKey: args.idempotencyKey, actorId: args.actorId, targetId: runId,
    input: { workflowId: args.workflowId, versionId: version.id, inputText: args.inputText } })
  if (operation.target_id === runId) await client.query(`INSERT INTO workflow_runs
    (id,workspace_id,kind,name,workflow_id,workflow_version,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
    VALUES($1,$2,'workflow',$3,$4,$5,'排队中',$6,'','',0,0,0,0,0,'','','trace-'||$1::varchar,now())`, [runId, args.workspaceId, snapshot.name, args.workflowId, version.version, args.inputText])
  return { operation, run: await readRun(client, args.workspaceId, operation.target_id!) }
}

/** Legacy run shape remains readable while operation status carries the async lifecycle. */
export async function readRun(client: SqlClient, workspaceId: string, runId: string) {
  const row = (await client.query('SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2', [workspaceId, runId])).rows[0]
  if (!row) throw new ApiError(404, 'Run 不存在')
  const nodes = (await client.query('SELECT * FROM node_runs WHERE workspace_id=$1 AND run_id=$2 ORDER BY started_at,id LIMIT 1000', [workspaceId, runId])).rows
  const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null
  const metrics = (r: Row) => ({ model: r.model, promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens, costUsd: r.cost_usd, durationMs: r.duration_ms, score: r.score ?? null, error: r.error })
  return { id: String(row.id), kind: row.kind, name: row.name, workflowId: row.workflow_id, workflowVersion: row.workflow_version,
    agentId: row.agent_id ?? null, agentVersion: row.agent_version ?? null, status: row.status, input: row.input_text, output: row.output_text,
    ...metrics(row), currentNode: row.current_node, startedAt: iso(row.started_at), completedAt: iso(row.completed_at),
    nodes: nodes.map(node => ({ id: node.id, nodeId: node.node_id, nodeType: node.node_type, nodeName: node.node_name,
      agentId: node.agent_id, agentVersion: node.agent_version, status: node.status, input: node.input_text, output: node.output_text,
      ...metrics(node), attempts: node.attempts, traceId: node.trace_id, spanId: node.span_id, parentSpanId: node.parent_span_id,
      startedAt: iso(node.started_at), completedAt: iso(node.completed_at) })) }
}

function order(snapshot: Snapshot): WorkflowNode[] {
  const result: WorkflowNode[] = [], done = new Set<string>()
  while (result.length < snapshot.nodes.length) {
    const next = snapshot.nodes.find(node => !done.has(node.id) && snapshot.edges.filter(edge => edge.target === node.id).every(edge => done.has(edge.source)))
    if (!next) throw Error('工作流有环或缺失节点')
    result.push(next); done.add(next.id)
  }
  return result
}

/** Preserve the existing mapping fallback, while disallowing prototype path mutation. */
function nodeInput(snapshot: Snapshot, node: WorkflowNode, checkpoints: Row[], fallback: string) {
  const incoming = snapshot.edges.filter(edge => edge.target === node.id)
  const outputs = new Map(checkpoints.filter(row => row.status === 'succeeded').map(row => [row.node_id, String(row.output_text)]))
  const mapped: Record<string, unknown> = {}; let any = false
  for (const edge of incoming) for (const mapping of (edge.data?.mappings ?? []) as { sourcePath: string; targetPath: string }[]) {
    try {
      let value: unknown = JSON.parse(outputs.get(edge.source) ?? '')
      const segments = (path: string) => path === '$' ? [] : path.slice(2).split('.').filter(Boolean)
      for (const segment of segments(mapping.sourcePath)) {
        if (!object(value) || !Object.hasOwn(value, segment)) throw Error('mapping missing')
        value = value[segment]
      }
      const target = segments(mapping.targetPath)
      if (target.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw Error('unsafe mapping')
      if (!target.length) { if (object(value)) { Object.assign(mapped, value); any = true } }
      else {
        let at = mapped
        for (const key of target.slice(0, -1)) { if (!object(at[key])) at[key] = {}; at = at[key] as Record<string, unknown> }
        at[target.at(-1)!] = value; any = true
      }
    } catch { /* Existing runtime falls back when source JSON/path is unavailable. */ }
  }
  return any ? JSON.stringify(mapped) : incoming.map(edge => outputs.get(edge.source)).filter(Boolean).join('\n') || fallback
}

async function createNode(client: SqlClient, workspaceId: string, runId: string, node: WorkflowNode, input: string, parent: string | null) {
  const id = randomUUID()
  await client.query(`INSERT INTO node_runs(id,workspace_id,run_id,node_id,node_type,node_name,agent_id,agent_version,status,input_text,output_text,
    model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,attempts,error,trace_id,span_id,parent_span_id,started_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'运行中',$9,'','',0,0,0,0,0,1,'','trace-'||$3::varchar,'span-'||$1::varchar,$10,now())`,
  [id, workspaceId, runId, node.id, node.type, String(node.data.label ?? node.id), node.data.agentId ?? null, node.data.agentVersion ?? null, input, parent])
  await client.query('INSERT INTO runtime_node_checkpoints(run_id,workspace_id,node_id,node_run_id,input_text) VALUES($1,$2,$3,$4,$5)', [runId, workspaceId, node.id, id, input])
  return id
}

/** Immutable artifact versions are created in the same fenced transaction as a node outcome. */
async function finishNode(client: SqlClient, op: Operation, runId: string, node: WorkflowNode, nodeRunId: string, result: ModelOutput & { score?: number }) {
  const workspaceId = op.workspace_id
  const currentRun=(await client.query('SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,runId])).rows[0]
  if(!currentRun||currentRun.status==='已取消')throw new ApiError(409,'运行已取消，禁止继续写入结果')
  await client.query(`UPDATE node_runs SET status='已完成',output_text=$3,model=$4,prompt_tokens=$5,completion_tokens=$6,total_tokens=$5::integer+$6::integer,
    cost_usd=$7,score=$8,completed_at=now(),duration_ms=greatest(0,extract(epoch FROM now()-started_at)*1000)::int WHERE id=$1 AND workspace_id=$2`,
  [nodeRunId, workspaceId, result.content, result.model, result.promptTokens, result.completionTokens, result.costUsd, result.score ?? null])
  await client.query("UPDATE runtime_node_checkpoints SET status='succeeded',output_text=$4 WHERE run_id=$1 AND workspace_id=$2 AND node_id=$3", [runId, workspaceId, node.id, result.content])
  const artifactId = randomUUID(), versionId = randomUUID()
  const ref = object(node.data.outputDataObjectRef) ? node.data.outputDataObjectRef : {}
  await client.query(`INSERT INTO artifacts(id,workspace_id,run_id,source_node_run_id,artifact_type,content,score,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now())`, [artifactId, workspaceId, runId, nodeRunId, 'text', result.content, result.score ?? null])
  await client.query(`INSERT INTO artifact_versions(id,workspace_id,artifact_id,version,content,data_object_definition_id,data_object_version_id,data_object_snapshot,created_by,created_at)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,now())`, [versionId, workspaceId, artifactId, result.content,
    ref.definitionId ?? null, ref.versionId ?? null, ref.snapshot ? JSON.stringify(ref.snapshot) : null, op.actor_id ?? 'runtime'])
  await appendOperationEvent(client, op, 'node.succeeded', { nodeId: node.id, nodeRunId, artifactId, artifactVersionId: versionId, traceId: `trace-${runId}` })
}

async function agentResult(deps: WorkflowDependencies, op: Operation, ctx: RuntimeContext, runId: string, node: WorkflowNode, nodeRunId: string, input: string) {
  const snapshot = await ctx.transaction(async client => {
    const version = (await client.query('SELECT snapshot FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2 AND version=$3', [op.workspace_id, node.data.agentId, node.data.agentVersion])).rows[0]
    if (!version || !object(version.snapshot)) throw Error('Agent 固定版本不存在')
    return version.snapshot
  })
  const enriched = await prepareAgentToolInput(op,ctx,snapshot,input,nodeRunId,{...deps.toolOptions,allowedBindings:deps.toolOptions?.allowedBindings??[],agentId:String(node.data.agentId),agentVersion:String(node.data.agentVersion)})
  const names=(refs:unknown,fallback:unknown)=>{const bound=Array.isArray(refs)?refs.filter(object).map(r=>r.name).filter((v):v is string=>typeof v==='string'&&!!v):[];return(bound.length?bound:Array.isArray(fallback)?fallback:[]).join('、')||'无'}
  const effectivePrompt=`${String(snapshot.systemPrompt??'').trim()}\n\n职责：${String(snapshot.role??'')}\n可用工具：${names(snapshot.toolAssetRefs,snapshot.tools)}\n可用技能：${names(snapshot.skillAssetRefs,snapshot.skills)}`.trim()
  const request = await ctx.transaction(async client => {
    const manifest = snapshot.runtimeManifest
    if (object(manifest) && Object.keys(manifest).length) {
      if (manifest.runtime !== 'remote_http' || !deps.remote) throw Error('远程 Agent 配置不可执行')
      return { remote: { workspaceId: op.workspace_id, endpointUrl: String(manifest.endpointUrl), secretRef: String(manifest.secretRef),
        invocationId: `${runId}:${nodeRunId}`, runId, timeoutSeconds: Number(manifest.timeoutSeconds),
        payload: { protocolVersion: 'arc-agent-v1', invocationId: `${runId}:${nodeRunId}`, agent: { id: node.data.agentId, version: node.data.agentVersion },
          run: { id: runId, nodeRunId, nodeId: node.id }, input:enriched,
          context: { workspaceId: op.workspace_id, nodeName: String(node.data.label ?? node.id), systemPrompt: effectivePrompt, tools: snapshot.tools ?? [], skills: snapshot.skills ?? [] } } } }
    }
    const provider = (await client.query("SELECT * FROM model_providers WHERE workspace_id=$1 AND id=$2 AND status='active'", [op.workspace_id, snapshot.modelProviderId])).rows[0]
    if (!provider) throw Error('模型 Provider 不存在或已停用')
    return { model: { workspaceId: op.workspace_id, baseUrl: String(snapshot.modelBaseUrl || provider.base_url), secretRef: String(provider.secret_ref),
      model: String(snapshot.model || provider.default_model), systemPrompt: effectivePrompt,
      userInput: enriched, temperature: Number(snapshot.temperature ?? 0.2), maxOutputTokens: Number(snapshot.maxOutputTokens ?? 2000) } }
  })
  return request.remote ? ctx.effect(`node:${node.id}:remote`, request.remote, () => deps.remote!(request.remote!))
    : ctx.effect(`node:${node.id}:model`, request.model, () => deps.complete(request.model!))
}

/** Direct test runs are real Agent runs, not synthetic Workflow definitions. */
export async function submitAgent(client:SqlClient,args:Omit<SubmitWorkflowInput,'workflowId'>&{agentId:string}) {
  const live=(await client.query('SELECT status FROM agents WHERE workspace_id=$1 AND id=$2 FOR SHARE',[args.workspaceId,args.agentId])).rows[0]
  if(!live)throw new ApiError(404,'Agent 不存在')
  if(['已停用','宸插仠鐢?'].includes(String(live.status)))throw new ApiError(409,'Agent 已停用')
  const version=(await client.query(`SELECT * FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2
    AND ($3::text IS NULL OR version=$3) ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspaceId,args.agentId,args.version??null])).rows[0]
  if(!version||!object(version.snapshot)||version.snapshot.id!==args.agentId)throw new ApiError(404,'Agent 发布版本不存在')
  if(typeof args.inputText!=='string'||args.inputText.length>100000)throw new ApiError(422,'运行输入无效')
  const runId=randomUUID()
  const operation=await enqueueOperation(client,{workspaceId:args.workspaceId,kind:'agent.run',idempotencyKey:args.idempotencyKey,targetId:runId,actorId:args.actorId,
    input:{agentId:args.agentId,version:version.version,versionId:version.id,inputText:args.inputText}})
  if(operation.target_id===runId)await client.query(`INSERT INTO workflow_runs(id,workspace_id,kind,name,agent_id,agent_version,status,input_text,output_text,model,
    prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
    VALUES($1,$2,'agent',$3,$4,$5,'排队中',$6,'','',0,0,0,0,0,'','','trace-'||$1::varchar,now())`,
  [runId,args.workspaceId,version.snapshot.name,args.agentId,version.version,args.inputText])
  return{operation,run:await readRun(client,args.workspaceId,operation.target_id!)}
}

export function createAgentExecutor(deps:WorkflowDependencies):OperationExecutor {
  return async(op,ctx)=>{
    const runId=op.target_id!
    const node:WorkflowNode={id:'agent',type:'agent',position:{x:0,y:0},data:{agentId:op.input.agentId,agentVersion:op.input.version,label:'Agent'}}
    const prepared=await ctx.transaction(async client=>{
      const run=(await client.query('SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[op.workspace_id,runId])).rows[0]
      if(!run||run.agent_id!==op.input.agentId)throw Error('Agent Run 不存在')
      const cp=(await client.query('SELECT * FROM runtime_node_checkpoints WHERE workspace_id=$1 AND run_id=$2 AND node_id=$3',[op.workspace_id,runId,node.id])).rows[0]
      if(cp?.status==='succeeded')return{result:await readRun(client,op.workspace_id,runId)}
      const id=cp?String(cp.node_run_id):await createNode(client,op.workspace_id,runId,node,String(op.input.inputText),null)
      return{id}
    })
    if(prepared.result)return prepared.result
    const result=await agentResult(deps,op,ctx,runId,node,prepared.id!,String(op.input.inputText))
    return ctx.transaction(async client=>{
      await finishNode(client,op,runId,node,prepared.id!,result)
      await client.query(`UPDATE workflow_runs SET status='已完成',output_text=$3,model=$4,prompt_tokens=$5,completion_tokens=$6,
        total_tokens=$5::integer+$6::integer,cost_usd=$7,completed_at=now() WHERE workspace_id=$1 AND id=$2`,
      [op.workspace_id,runId,result.content,result.model,result.promptTokens,result.completionTokens,result.costUsd])
      return readRun(client,op.workspace_id,runId)
    })
  }
}

export function createWorkflowExecutor(deps: WorkflowDependencies): OperationExecutor {
  return async (op, ctx) => {
    const runId = op.kind === 'workflow.run' ? op.target_id! : String(op.input.runId)
    const prepared = await ctx.transaction(async client => {
      const run = (await client.query('SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [op.workspace_id, runId])).rows[0]
      if (!run) throw Error('运行不存在')
      if(run.status==='已取消')throw new ApiError(409,'运行已取消，禁止继续执行')
      const version = (await client.query('SELECT snapshot FROM workflow_versions WHERE workspace_id=$1 AND workflow_id=$2 AND version=$3', [op.workspace_id, run.workflow_id, run.workflow_version])).rows[0]
      if (!version) throw Error('运行版本不存在')
      const snapshot = parseSnapshot(version.snapshot)
      const checkpoints = (await client.query('SELECT * FROM runtime_node_checkpoints WHERE workspace_id=$1 AND run_id=$2', [op.workspace_id, runId])).rows
      const node = order(snapshot).find(node => !checkpoints.some(row => row.node_id === node.id && row.status === 'succeeded'))
      if (!node) {
        const output = checkpoints.find(row => row.node_id === order(snapshot).at(-1)?.id)?.output_text ?? run.input_text
        await client.query(`UPDATE workflow_runs SET status='已完成',output_text=$3,completed_at=now(),current_node='',error='',
          duration_ms=greatest(0,extract(epoch FROM now()-started_at)*1000)::int WHERE workspace_id=$1 AND id=$2`, [op.workspace_id, runId, output])
        return { result: await readRun(client, op.workspace_id, runId) }
      }
      let checkpoint = checkpoints.find(row => row.node_id === node.id)
      if (checkpoint?.status === 'waiting_review') return { waiting: true }
      const input = checkpoint ? String(checkpoint.input_text) : nodeInput(snapshot, node, checkpoints, String(run.input_text))
      if (!checkpoint) {
        const incoming = snapshot.edges.filter(edge => edge.target === node.id)
        const source = checkpoints.find(row => row.node_id === incoming.at(-1)?.source)
        const nodeRunId = await createNode(client, op.workspace_id, runId, node, input, source ? `span-${source.node_run_id}` : null)
        checkpoint = { node_run_id: nodeRunId }
      }
      await client.query("UPDATE workflow_runs SET status='运行中',current_node=$3 WHERE workspace_id=$1 AND id=$2", [op.workspace_id, runId, String(node.data.label ?? node.id)])
      return { node, nodeRunId: String(checkpoint.node_run_id), input, snapshot, checkpoints }
    })
    if (prepared.result) return prepared.result
    if (prepared.waiting) throw new WaitingReview()
    const { node, nodeRunId, input, snapshot, checkpoints } = prepared as Required<Pick<typeof prepared, 'node' | 'nodeRunId' | 'input' | 'snapshot' | 'checkpoints'>>
    if (node.type === 'human') {
      if (!deps.pauseForReview) throw Error('审核服务不可用')
      await ctx.transaction(async client => {
        const sourceNodeId = snapshot.edges.filter(edge => edge.target === node.id).at(-1)?.source
        const source = checkpoints.find(row => row.node_id === sourceNodeId && row.status === 'succeeded')
        const version = source && (await client.query(`SELECT v.id FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id
          WHERE a.workspace_id=$1 AND a.run_id=$2 AND a.source_node_run_id=$3 ORDER BY v.version DESC LIMIT 1`, [op.workspace_id, runId, source.node_run_id])).rows[0]
        if (!sourceNodeId || !version) throw Error('审核来源产出物不存在')
        await deps.pauseForReview!(client, { workspaceId: op.workspace_id, runId, nodeRunId, nodeId: node.id, sourceNodeId,
          config: node.data, artifactVersionId: String(version.id), actorId: op.actor_id ?? 'runtime' })
        await client.query("UPDATE runtime_node_checkpoints SET status='waiting_review' WHERE workspace_id=$1 AND run_id=$2 AND node_id=$3", [op.workspace_id, runId, node.id])
        await client.query("UPDATE workflow_runs SET status='等待审核' WHERE workspace_id=$1 AND id=$2", [op.workspace_id, runId])
      })
      throw new WaitingReview()
    }
    const result:ModelOutput & {score?:number} = node.type === 'agent' ? await agentResult(deps, op, ctx, runId, node, nodeRunId, input)
      : node.type === 'evaluation' ? await (() => {
        if (!deps.evaluateNode) throw Error('评估服务不可用')
        const sourceId=snapshot.edges.filter(edge=>edge.target===node.id).at(-1)?.source
        const source=checkpoints.find(row=>row.node_id===sourceId&&row.status==='succeeded')
        if(!source)throw Error('评估来源节点不存在')
        return deps.evaluateNode(op, ctx, { rubricRef: node.data.rubricRef, artifactText: String(source.output_text), subjectId: String(source.node_run_id), runId, nodeRunId })
      })() : { content: input, model: '', promptTokens: 0, completionTokens: 0, costUsd: 0 }
    await ctx.transaction(async client => {
      await finishNode(client, op, runId, node, nodeRunId, result)
      await client.query(`UPDATE workflow_runs r SET prompt_tokens=n.p,completion_tokens=n.c,total_tokens=n.t,cost_usd=n.cost,model=COALESCE(NULLIF($3,''),r.model),score=COALESCE($4::integer,r.score)
        FROM (SELECT coalesce(sum(prompt_tokens),0) p,coalesce(sum(completion_tokens),0) c,coalesce(sum(total_tokens),0) t,coalesce(sum(cost_usd),0) cost
          FROM node_runs WHERE workspace_id=$1 AND run_id=$2) n WHERE r.workspace_id=$1 AND r.id=$2`, [op.workspace_id, runId, result.model,result.score??null])
    })
    throw new ContinueOperation()
  }
}
