import type { ToolSkillAdapterType } from '../types'

/** Bounded registration fields; no credential or external execution capability. */
export function AssetRegistrationConfig({ adapterType, value, onChange, prefix = '' }: {
  adapterType: ToolSkillAdapterType
  value: string
  onChange: (value: string) => void
  prefix?: string
}) {
  if (adapterType !== 'http') return <p className="form-field full">manual / MCP 仅登记元数据，配置必须为空。</p>
  // The editor only receives JSON produced by this form or a validated API record.
  const config = JSON.parse(value) as { url?: string; method?: string }
  return <>
    <label className="form-field full">
      <span>{prefix}HTTP 地址</span>
      <input value={config.url ?? ''} onChange={event => onChange(JSON.stringify({ ...config, url: event.target.value }))} />
    </label>
    <label className="form-field">
      <span>{prefix}HTTP 方法</span>
      <select aria-label={`${prefix}HTTP 方法`} value={config.method ?? 'POST'} onChange={event => onChange(JSON.stringify({ ...config, method: event.target.value }))}>
        <option value="POST">POST</option><option value="GET">GET</option>
      </select>
    </label>
    <p className="form-field full">仅接受 HTTPS 登记地址；不包含凭证、查询参数或自定义请求头。</p>
  </>
}
