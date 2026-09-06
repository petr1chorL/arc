import { ApiError } from '../identity-workspace/handler.ts'
import { strip } from '../rubrics/policy.ts'

export type WorkflowNode = { id: string; type: string; position: Record<string, number>; data: Record<string, unknown> }
export type WorkflowEdge = { id: string; source: string; target: string; label?: string; data?: Record<string, unknown> }
export type WorkflowFields = { name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; input_schema: Record<string, unknown>; output_schema: Record<string, unknown> }
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new ApiError(422, 'Workflow 请求字段不符合要求')
const schema = () => ({ type: 'object', properties: {} })
function text(value: unknown, maximum?: number, minimum = 0): string {
  if (typeof value !== 'string' || Array.from(value).length < minimum || (maximum !== undefined && Array.from(value).length > maximum)) throw invalid()
  return value
}
function positionNumber(value: unknown): number {
  if (typeof value === 'boolean') return Number(value)
  if (typeof value === 'string') {
    const normalized = strip(value)
    if (!/^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/.test(normalized)) throw invalid()
    value = Number(normalized.replaceAll('_', ''))
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid()
  return value
}
function node(value: unknown): WorkflowNode {
  if (!object(value) || !object(value.position) || !object(value.data)) throw invalid()
  return { id: text(value.id), type: text(value.type), position: Object.fromEntries(Object.entries(value.position).map(([key, number]) => [key, positionNumber(number)])), data: value.data }
}
function edge(value: unknown): WorkflowEdge {
  if (!object(value) || (value.data != null && !object(value.data))) throw invalid()
  return { id: text(value.id), source: text(value.source), target: text(value.target),
    ...(value.label == null ? {} : { label: text(value.label) }), ...(value.data == null ? {} : { data: value.data }) }
}
/** Match Pydantic's full replacement, alias priority and extra=ignore contract. */
export function parseWorkflowWrite(value: unknown): WorkflowFields {
  if (!object(value)) throw invalid()
  const nodes = value.nodes === undefined ? [] : value.nodes
  const edges = value.edges === undefined ? [] : value.edges
  const input = Object.hasOwn(value, 'inputSchema') ? value.inputSchema : value.input_schema === undefined ? schema() : value.input_schema
  const output = Object.hasOwn(value, 'outputSchema') ? value.outputSchema : value.output_schema === undefined ? schema() : value.output_schema
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !object(input) || !object(output)) throw invalid()
  return { name: strip(text(value.name, 120, 1)), nodes: nodes.map(node), edges: edges.map(edge), input_schema: input, output_schema: output }
}
export function parseWorkflowPublish(value: unknown): string {
  if (value == null) return ''
  if (!object(value)) throw invalid()
  return strip(text(value.note === undefined ? '' : value.note, 500))
}
