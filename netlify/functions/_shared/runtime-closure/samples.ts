import {randomUUID} from 'node:crypto'
import {ApiError} from '../identity-workspace/handler.ts'
import type {SqlClient} from '../identity-workspace/postgres.ts'
import {project,text} from './policy.ts'
import type {Row} from './types.ts'
function sample(row:Row){const value=project(row);value.input=value.inputText;delete value.inputText;return value}
async function detail(c:SqlClient,ws:string,id:string) {
 const row=(await c.query('SELECT * FROM regression_sample_sets WHERE workspace_id=$1 AND id=$2',[ws,id])).rows[0]
 if(!row)throw new ApiError(404,'样本集不存在')
 const samples=(await c.query('SELECT * FROM regression_samples WHERE workspace_id=$1 AND sample_set_id=$2 ORDER BY created_at,id LIMIT 1000',[ws,id])).rows
 const counts=(await c.query("SELECT count(*)::int total,count(*) FILTER(WHERE status='active')::int active FROM regression_samples WHERE workspace_id=$1 AND sample_set_id=$2",[ws,id])).rows[0]
 return{...project(row),sampleCount:counts.total,activeSampleCount:counts.active,samples:samples.map(sample)}
}
/** Existing sample-set contracts needed by the quality page; no demo fallback. */
export async function sampleSets(c:SqlClient,ws:string,id:string,user:string,op:string,body:Row) {
 if(op==='samples.list')return{body:await Promise.all((await c.query('SELECT id FROM regression_sample_sets WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 200',[ws])).rows.map(r=>detail(c,ws,String(r.id))))}
 if(op==='samples.create') {
  if(Object.keys(body).some(k=>!['name','description'].includes(k)))throw new ApiError(422,'样本集字段无效')
  const name=text(body.name,160),description=body.description??''
  if(typeof description!=='string'||description.length>4000)throw new ApiError(422,'样本集描述无效')
  if((await c.query('SELECT id FROM regression_sample_sets WHERE workspace_id=$1 AND name=$2',[ws,name])).rows.length)throw new ApiError(409,'样本集名称已存在')
  id=randomUUID();await c.query("INSERT INTO regression_sample_sets VALUES($1,$2,$3,$4,'active',$5,now(),now())",[id,ws,name,description.trim(),user])
  return{status:201,body:await detail(c,ws,id)}
 }
 if(Object.keys(body).some(k=>!['name','input','expectedOutput','tags'].includes(k)))throw new ApiError(422,'样本字段无效')
 const set=(await c.query("SELECT id FROM regression_sample_sets WHERE workspace_id=$1 AND id=$2 AND status='active' FOR UPDATE",[ws,id])).rows[0];if(!set)throw new ApiError(404,'样本集不存在')
 const tags=body.tags??[];if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'))throw new ApiError(422,'标签无效')
 const result=await c.query("INSERT INTO regression_samples(id,workspace_id,sample_set_id,name,input_text,expected_output,tags,source_type,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'manual','active',$8,now(),now()) RETURNING *",[randomUUID(),ws,id,text(body.name,160),text(body.input,20000),text(body.expectedOutput,20000),JSON.stringify([...new Set(tags.map(t=>String(t).trim().slice(0,40)).filter(Boolean))]),user])
 return{status:201,body:sample(result.rows[0])}
}
