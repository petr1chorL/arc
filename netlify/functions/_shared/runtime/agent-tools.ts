import {randomUUID} from 'node:crypto'
import {isIP} from 'node:net'
import {ApiError} from '../identity-workspace/handler.ts'
import {validateAdapterConfig} from '../reference-assets/policy.ts'
import {appendOperationEvent,requestHash} from './ledger.ts'
import {ContinueOperation,NotSentError,UncertainEffectError,type Operation,type RuntimeContext} from './types.ts'

type ObjectValue=Record<string,unknown>
type ToolSnapshot={invocationId:string;assetId:string;assetName:string;assetType:string;adapterType:string;adapterConfig:ObjectValue;active:boolean}
type InvocationResult={status:'succeeded'|'failed';outputSummary:string;error:string;durationMs:number}
export type AgentToolOptions={allowedBindings:readonly {workspaceId:string;host:string}[];fetch?:typeof fetch;agentId?:string;agentVersion?:string}
const asObject=(value:unknown):ObjectValue=>{if(!value || typeof value!=='object' || Array.isArray(value))throw new ApiError(409,'工具历史结构无效');return value as ObjectValue}

/** Fixed configuration and input precede all tool effects, including resumed runs. */
export async function prepareAgentToolInput(op:Operation,ctx:RuntimeContext,snapshot:ObjectValue,input:string,nodeRunId:string,options:AgentToolOptions={allowedBindings:[]}):Promise<string> {
  const runId=['workflow.run','agent.run'].includes(op.kind)?op.target_id!:String(op.input.runId)
  const prepared=await ctx.transaction(async client=>{
    const old=(await client.query('SELECT * FROM runtime_agent_tool_inputs WHERE node_run_id=$1 AND workspace_id=$2 AND run_id=$3 FOR UPDATE',[nodeRunId,op.workspace_id,runId])).rows[0]
    if(old){if(old.input_hash!==requestHash(input))throw new ApiError(409,'工具恢复输入与固定请求不一致');return old}
    const toolRefs=references(snapshot.toolAssetRefs,'tool'),skillRefs=references(snapshot.skillAssetRefs,'skill')
    const tools:ToolSnapshot[]=[]
    for(const ref of [...toolRefs,...skillRefs]) {
      const row=(await client.query('SELECT * FROM tool_skill_assets WHERE workspace_id=$1 AND id=$2 AND asset_type=$3',[op.workspace_id,ref.assetId,ref.assetType])).rows[0]
      if(!row)throw new ApiError(409,'固定 Tool / Skill 引用不存在或不属于当前 Workspace')
      if(ref.assetType==='tool')tools.push(freezeTool(row))
    }
    if(!toolRefs.length && Array.isArray(snapshot.tools)) {
      if(snapshot.tools.length>100 || snapshot.tools.some(name=>typeof name!=='string'))throw new ApiError(409,'历史工具名称无效')
      for(const name of snapshot.tools) {
        const row=(await client.query("SELECT * FROM tool_skill_assets WHERE workspace_id=$1 AND name=$2 AND asset_type='tool'",[op.workspace_id,name])).rows[0]
        if(row && !tools.some(tool=>tool.assetId===row.id))tools.push(freezeTool(row))
      }
    }
    const agentId=options.agentId??String(snapshot.id??''),agentVersion=options.agentVersion??String(snapshot.version??'')
    if(!agentId || agentId.length>36 || !agentVersion || agentVersion.length>20)throw new ApiError(409,'Agent 版本标识无效')
    const stored=(await client.query(`INSERT INTO runtime_agent_tool_inputs(node_run_id,workspace_id,run_id,agent_id,agent_version,input_hash,input_text,tool_snapshots)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[nodeRunId,op.workspace_id,runId,agentId,agentVersion,requestHash(input),input,JSON.stringify(tools)])).rows[0]
    for(const tool of tools)await client.query(`INSERT INTO tool_skill_asset_invocations(id,workspace_id,asset_id,asset_type,asset_name,agent_id,agent_version,run_id,node_run_id,status,input_summary,output_summary,error,duration_ms,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,'','',0,now())`,[tool.invocationId,op.workspace_id,tool.assetId,tool.assetType,tool.assetName,agentId,agentVersion,runId,nodeRunId,JSON.stringify({input})])
    await appendOperationEvent(client,op,'tool.inputs_frozen',{runId,nodeRunId,toolCount:tools.length,skillMetadataCount:skillRefs.length,traceId:`trace-${runId}`})
    return stored
  })
  if(typeof prepared.enriched_input==='string')return prepared.enriched_input
  const tools=prepared.tool_snapshots as ToolSnapshot[],summaries=[]
  let worked=0
  for(const tool of tools) {
    const old=await ctx.transaction(async client=>(await client.query('SELECT * FROM tool_skill_asset_invocations WHERE id=$1 AND workspace_id=$2 AND run_id=$3 AND node_run_id=$4',[tool.invocationId,op.workspace_id,runId,nodeRunId])).rows[0])
    if(!old)throw new ApiError(409,'工具调用记录不存在')
    let result:InvocationResult
    if(old.status==='succeeded' || old.status==='failed')result={status:old.status,outputSummary:String(old.output_summary),error:String(old.error),durationMs:Number(old.duration_ms)}
    else {
      if(++worked>5)throw new ContinueOperation('继续执行已固定的工具请求')
      if(!tool.active)result={status:'failed',outputSummary:'',error:'工具已停用，未执行',durationMs:0}
      else if(tool.adapterType!=='http')result={status:'failed',outputSummary:'',error:tool.adapterType==='mcp'?'MCP Tool 网关未配置，未执行':'Manual Tool 仅登记元数据，未执行',durationMs:0}
      else {
        // Invalid/unauthorized configuration is a confirmed pre-send failure, not a transport retry.
        let configError=false
        try{validateToolTarget(tool.adapterConfig,op.workspace_id,options)}catch{configError=true}
        try {
          const receipt=await claimTool(op,ctx,tool)
          result=receipt??(configError?{status:'failed',outputSummary:'',error:'HTTP Tool 地址未获准，未执行',durationMs:0}
            :await ctx.effect(`tool:${tool.invocationId}`,{assetId:tool.assetId,config:tool.adapterConfig,input},()=>invoke(tool,input,op.workspace_id,options)))
        }catch(error) {
          if(error instanceof UncertainEffectError)await ctx.transaction(async client=>{
            await client.query("UPDATE tool_skill_asset_invocations SET status='needs_reconciliation',error='工具调用结果待核对' WHERE id=$1 AND workspace_id=$2",[tool.invocationId,op.workspace_id])
            await appendOperationEvent(client,op,'tool.needs_reconciliation',{runId,nodeRunId,invocationId:tool.invocationId,traceId:`trace-${runId}`})
          })
          throw error
        }
      }
      await ctx.transaction(async client=>{
        await client.query('UPDATE tool_skill_asset_invocations SET status=$1,output_summary=$2,error=$3,duration_ms=$4 WHERE id=$5 AND workspace_id=$6 AND run_id=$7 AND node_run_id=$8',[result.status,result.outputSummary,result.error,result.durationMs,tool.invocationId,op.workspace_id,runId,nodeRunId])
        await appendOperationEvent(client,op,`tool.${result.status}`,{runId,nodeRunId,invocationId:tool.invocationId,assetId:tool.assetId,traceId:`trace-${runId}`})
      })
    }
    summaries.push(`- ${tool.assetName}（${result.status}）：${result.outputSummary||result.error}`)
  }
  const enriched=summaries.length?`${input}\n\n工具调用结果：\n${summaries.join('\n')}`:input
  await ctx.transaction(async client=>{await client.query('UPDATE runtime_agent_tool_inputs SET enriched_input=$1 WHERE node_run_id=$2 AND workspace_id=$3 AND run_id=$4',[enriched,nodeRunId,op.workspace_id,runId])})
  return enriched
}

async function claimTool(op:Operation,ctx:RuntimeContext,tool:ToolSnapshot):Promise<InvocationResult|null> {
  return ctx.transaction(async client=>{
    const invocation=(await client.query('SELECT * FROM tool_skill_asset_invocations WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[tool.invocationId,op.workspace_id])).rows[0]
    if(!invocation)throw new ApiError(409,'工具调用记录不存在')
    const owner=invocation.effect_operation_id
    if(owner) {
      const receipt=(await client.query("SELECT e.* FROM runtime_effects e JOIN runtime_operations o ON o.id=e.operation_id AND o.workspace_id=$3 WHERE e.operation_id=$1 AND e.effect_key=$2",[owner,`tool:${tool.invocationId}`,op.workspace_id])).rows[0]
      if(receipt?.status==='succeeded')return receipt.result as InvocationResult
      if(receipt && ['started','uncertain'].includes(String(receipt.status)))throw new UncertainEffectError('原工具调用结果待核对，不能重发')
      if(owner!==op.id) {
        const old=(await client.query('SELECT status FROM runtime_operations WHERE id=$1 AND workspace_id=$2',[owner,op.workspace_id])).rows[0]
        if(!old || !['failed','canceled','dead_letter'].includes(String(old.status)))throw new UncertainEffectError('工具已由另一任务领取，不能重发')
      }
    }
    await client.query('UPDATE tool_skill_asset_invocations SET effect_operation_id=$1 WHERE id=$2 AND workspace_id=$3',[op.id,tool.invocationId,op.workspace_id])
    return null
  })
}

function references(value:unknown,kind:string) {
  if(value===undefined)return []
  if(!Array.isArray(value) || value.length>100)throw new ApiError(409,'Tool / Skill 引用无效')
  const refs=value.map(item=>{const ref=asObject(item);if(typeof ref.assetId!=='string' || !ref.assetId || ref.assetType!==kind)throw new ApiError(409,'Tool / Skill 引用无效');return {assetId:ref.assetId,assetType:kind}})
  if(new Set(refs.map(ref=>ref.assetId)).size!==refs.length)throw new ApiError(409,'Tool / Skill 引用重复')
  return refs
}

function freezeTool(row:ObjectValue):ToolSnapshot {
  const config=asObject(row.adapter_config)
  // Never freeze a credential-bearing historical config into the internal ledger.
  try{validateAdapterConfig(String(row.adapter_type),config)}catch{throw new ApiError(409,'工具配置未通过安全治理')}
  return {invocationId:randomUUID(),assetId:String(row.id),assetName:String(row.name),assetType:String(row.asset_type),adapterType:String(row.adapter_type),adapterConfig:config,active:row.status==='active'}
}

function validateToolTarget(config:ObjectValue,workspaceId:string,options:AgentToolOptions) {
  validateAdapterConfig('http',config)
  const url=new URL(String(config.url))
  if(isIP(url.hostname) || url.hostname.startsWith('[') || !options.allowedBindings.some(binding=>binding.workspaceId===workspaceId && binding.host.toLowerCase()===url.hostname.toLowerCase()))throw new NotSentError('HTTP Tool Host 未获准')
}

async function invoke(tool:ToolSnapshot,input:string,workspaceId:string,options:AgentToolOptions):Promise<InvocationResult> {
  validateToolTarget(tool.adapterConfig,workspaceId,options)
  const started=Date.now(),url=new URL(String(tool.adapterConfig.url)),method=String(tool.adapterConfig.method??'POST')
  if(method==='GET')url.searchParams.set('input',input)
  const response=await(options.fetch??fetch)(url.toString(),{method,headers:{'Content-Type':'application/json','Idempotency-Key':tool.invocationId},...(method==='POST'?{body:JSON.stringify({input})}:{}),redirect:'error',signal:AbortSignal.timeout(10000)})
  if(response.status>=500 || response.status>=300 && response.status<400)throw new Error('工具接收结果不确定')
  if(!response.ok)return {status:'failed',outputSummary:'',error:`HTTP Tool 请求被拒绝（HTTP ${response.status}）`,durationMs:Date.now()-started}
  const reader=response.body?.getReader()
  if(!reader)throw new Error('工具返回无正文')
  const chunks:Uint8Array[]=[];let bytes=0
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw new Error('工具返回超过上限');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const joined=new Uint8Array(bytes);let offset=0
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length}
  const content=new TextDecoder('utf-8',{fatal:true}).decode(joined)
  const output=response.headers.get('content-type')?.includes('application/json')?JSON.stringify(JSON.parse(content)):content
  return {status:'succeeded',outputSummary:output.slice(0,1000),error:'',durationMs:Date.now()-started}
}
