import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { CreateAgentInput } from '../api/agents'

interface AgentCreateDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (input: CreateAgentInput) => Promise<void>
}

type FieldName = keyof CreateAgentInput

const emptyForm: CreateAgentInput = {
  name: '',
  role: '',
  owner: '',
  model: '',
}

const labels: Record<FieldName, string> = {
  name: '名称',
  role: '职责',
  owner: '负责人',
  model: '模型',
}

export function AgentCreateDialog({
  open,
  onClose,
  onSubmit,
}: AgentCreateDialogProps) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  if (!open) {
    return null
  }

  function updateField(field: FieldName, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = Object.fromEntries(
      Object.entries(form).map(([field, value]) => [field, value.trim()]),
    ) as unknown as CreateAgentInput
    const nextErrors = Object.fromEntries(
      (Object.keys(normalized) as FieldName[])
        .filter((field) => !normalized[field])
        .map((field) => [field, `${labels[field]}不能为空`]),
    )

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError('')
    try {
      await onSubmit(normalized)
      setForm(emptyForm)
      onClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Agent 创建失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title">
        <header>
          <div>
            <p className="eyebrow">Agent Asset</p>
            <h2 id="agent-dialog-title">新建 Agent</h2>
          </div>
          <button className="icon-button quiet" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          {(Object.keys(labels) as FieldName[]).map((field) => (
            <label className="dialog-field" key={field}>
              <span>{labels[field]}</span>
              {field === 'role' ? (
                <textarea
                  value={form[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                  rows={4}
                />
              ) : (
                <input
                  value={form[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                />
              )}
              {errors[field] && <small role="alert">{errors[field]}</small>}
            </label>
          ))}

          {submitError && <p className="dialog-error" role="alert">{submitError}</p>}

          <footer>
            <button className="button ghost" type="button" onClick={onClose}>取消</button>
            <button className="button primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '创建中…' : '创建 Agent'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
