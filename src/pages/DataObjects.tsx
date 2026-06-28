import { Check, Database, FileJson, Pencil, Plus, Rocket, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createDataObjectDefinition,
  listDataObjectDefinitions,
  publishDataObjectDefinition,
  updateDataObjectDefinition,
} from '../api/dataObjects'
import { useWorkspace } from '../auth/workspaceContextState'
import type { DataObjectDefinition } from '../types'

const defaultSchemaJson = '{\n  "type": "object",\n  "properties": {}\n}'

const initialForm = {
  name: '',
  description: '',
  schemaJson: defaultSchemaJson,
}

interface FormState {
  name: string
  description: string
  schemaJson: string
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} 必须是 JSON 对象`)
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label} 必须是合法 JSON`)
  }
}

function schemaSummary(schema: Record<string, unknown>) {
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? Object.keys(schema.properties)
    : []
  if (required.length > 0) return `required: ${required.join(', ')}`
  if (properties.length > 0) return `fields: ${properties.slice(0, 6).join(', ')}`
  return 'object schema'
}

export function DataObjects() {
  const { workspace } = useWorkspace()
  const [definitions, setDefinitions] = useState<DataObjectDefinition[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState('')
  const [editForm, setEditForm] = useState<FormState | null>(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    void listDataObjectDefinitions(workspace.id)
      .then(setDefinitions)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Data Object 加载失败'))
  }, [workspace.id])

  function updateForm<TField extends keyof FormState>(field: TField, value: FormState[TField]) {
    setForm((current) => ({ ...current, [field]: value }))
    setFeedback('')
    setError('')
  }

  function updateEditForm<TField extends keyof FormState>(field: TField, value: FormState[TField]) {
    setEditForm((current) => current ? { ...current, [field]: value } : current)
    setFeedback('')
    setError('')
  }

  async function createDefinition() {
    setIsBusy(true)
    setError('')
    try {
      const created = await createDataObjectDefinition(workspace.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        schema: parseJsonObject(form.schemaJson, 'Schema'),
      })
      setDefinitions((current) => [created, ...current])
      setForm(initialForm)
      setFeedback('Data Object 已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Data Object 创建失败')
    } finally {
      setIsBusy(false)
    }
  }

  function startEditing(definition: DataObjectDefinition) {
    setEditingId(definition.id)
    setEditForm({
      name: definition.name,
      description: definition.description,
      schemaJson: JSON.stringify(definition.schema, null, 2),
    })
    setFeedback('')
    setError('')
  }

  async function saveDefinition(definition: DataObjectDefinition) {
    if (!editForm) return
    setIsBusy(true)
    setError('')
    try {
      const updated = await updateDataObjectDefinition(workspace.id, definition.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        schema: parseJsonObject(editForm.schemaJson, '编辑 Schema'),
      })
      setDefinitions((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingId('')
      setEditForm(null)
      setFeedback('Data Object 已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Data Object 更新失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function publishDefinition(definition: DataObjectDefinition) {
    setIsBusy(true)
    setError('')
    try {
      const version = await publishDataObjectDefinition(workspace.id, definition.id)
      setDefinitions((current) => current.map((item) => (
        item.id === definition.id
          ? { ...item, status: 'published', version: version.version, updatedAt: version.createdAt }
          : item
      )))
      setFeedback(`已发布 ${version.version}`)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Data Object 发布失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack asset-library-page data-object-page">
      <section className="panel asset-library-intro">
        <div>
          <p className="section-kicker">DATA CONTRACTS</p>
          <h2>Data Object</h2>
          <p>管理节点之间复用的结构化数据对象定义。这里维护的是定义与版本快照，运行时绑定和产出物实例会在后续版本接入。</p>
        </div>
        <div className="provider-secret-note">
          <Database size={18} />
          <span>定义先行，后续再绑定工作流节点</span>
        </div>
      </section>

      {(feedback || error) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || feedback}
        </div>
      )}

      <section className="panel asset-library-form-panel">
        <header className="panel-header">
          <div><span className="section-kicker">定义入口</span><h3>新增 Data Object</h3></div>
          <Plus size={17} />
        </header>
        <div className="asset-form-grid">
          <label className="form-field">
            <span>名称</span>
            <input aria-label="名称" value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
          </label>
          <label className="form-field full">
            <span>描述</span>
            <input aria-label="描述" value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
          </label>
          <label className="form-field full">
            <span>Schema JSON</span>
            <textarea
              aria-label="Schema JSON"
              value={form.schemaJson}
              onChange={(event) => updateForm('schemaJson', event.target.value)}
              rows={5}
            />
          </label>
        </div>
        <button className="button primary" disabled={isBusy} onClick={() => void createDefinition()}>
          <Plus size={15} />创建 Data Object
        </button>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div><span className="section-kicker">定义列表</span><h3>Data Object Definitions</h3></div>
          <span className="draft-indicator"><i />{definitions.length}</span>
        </header>
        <div className="asset-library-list data-object-list">
          {definitions.length === 0 && <div className="table-state">暂无 Data Object Definition。</div>}
          {definitions.map((definition) => {
            const isEditing = editingId === definition.id && editForm
            return (
              <article className="asset-library-card data-object-card" key={definition.id}>
                <div className="asset-library-card-head">
                  <FileJson size={17} />
                  <div>
                    <strong>{definition.name}</strong>
                    <span>{definition.status} · {definition.version}</span>
                  </div>
                  <div className="asset-card-actions">
                    <button
                      aria-label={`编辑 ${definition.name}`}
                      className="icon-button"
                      onClick={() => startEditing(definition)}
                      type="button"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      aria-label={`发布 ${definition.name}`}
                      className="icon-button"
                      disabled={isBusy}
                      onClick={() => void publishDefinition(definition)}
                      type="button"
                    >
                      <Rocket size={15} />
                    </button>
                  </div>
                </div>
                <p>{definition.description || '暂无描述'}</p>
                <div className="data-object-meta">
                  <span>{schemaSummary(definition.schema)}</span>
                  <span>{definition.updatedAt.slice(0, 10)}</span>
                </div>

                {isEditing && (
                  <div className="asset-edit-form">
                    <label className="form-field">
                      <span>编辑名称</span>
                      <input
                        aria-label="编辑名称"
                        value={editForm.name}
                        onChange={(event) => updateEditForm('name', event.target.value)}
                      />
                    </label>
                    <label className="form-field full">
                      <span>编辑描述</span>
                      <input
                        aria-label="编辑描述"
                        value={editForm.description}
                        onChange={(event) => updateEditForm('description', event.target.value)}
                      />
                    </label>
                    <label className="form-field full">
                      <span>编辑 Schema JSON</span>
                      <textarea
                        aria-label="编辑 Schema JSON"
                        value={editForm.schemaJson}
                        onChange={(event) => updateEditForm('schemaJson', event.target.value)}
                        rows={5}
                      />
                    </label>
                    <div className="asset-edit-actions">
                      <button
                        className="button secondary compact"
                        onClick={() => {
                          setEditingId('')
                          setEditForm(null)
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        aria-label={`保存 ${definition.name}`}
                        className="button primary compact"
                        disabled={isBusy}
                        onClick={() => void saveDefinition(definition)}
                        type="button"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
