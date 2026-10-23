import type { Enums } from "@/lib/types/database"

export const RECORD_LIMITS = { deal: 50, project: 50, invoice: 50, task: 100 } as const

export type RecordKind = keyof typeof RECORD_LIMITS
export type RecordKey = `${RecordKind}:${string}`

type BaseRecord = { id: string; key: RecordKey; kind: RecordKind; status: string }

export type DealRecord = BaseRecord & {
  kind: "deal"
  status: Enums<"deal_stage">
  expectedCloseDate: string | null
  nextFollowUpDate: string | null
}
export type ProjectRecord = BaseRecord & {
  kind: "project"
  status: Enums<"project_status">
  deadline: string | null
  dealId: string | null
}
export type InvoiceRecord = BaseRecord & {
  kind: "invoice"
  status: Enums<"invoice_status">
  dueDate: string | null
  projectId: string | null
  issued: boolean
}
export type TaskRecord = BaseRecord & {
  kind: "task"
  status: Enums<"task_status">
  done: boolean
  dueDate: string | null
  projectId: string
}
export type ErpRecord = DealRecord | ProjectRecord | InvoiceRecord | TaskRecord
export type RecordOf<K extends RecordKind> = Extract<ErpRecord, { kind: K }>

export type RecordCollection<K extends RecordKind> =
  | { state: "ready"; total: number; displayed: number; truncated: boolean; records: RecordOf<K>[] }
  | { state: "empty"; total: 0; displayed: 0; truncated: false; records: [] }
  | { state: "unavailable"; reason: "query" | "invalid" }

export type ErpSnapshot = {
  version: 1
  scope: { key: string; orgId: string; role: Enums<"role_enum"> }
  requestedAt: string
  completedAt: string
  collections: {
    deal: RecordCollection<"deal">
    project: RecordCollection<"project">
    invoice: RecordCollection<"invoice">
    task: RecordCollection<"task">
  }
}

export type QueryResult = { data: unknown; count: number | null; error: unknown }

const STATUSES = {
  deal: { lead: true, contacted: true, discovery: true, proposal: true, negotiation: true, won: true, lost: true } satisfies Record<Enums<"deal_stage">, true>,
  project: { not_started: true, in_progress: true, review: true, delivered: true, support: true, paused: true, cancelled: true } satisfies Record<Enums<"project_status">, true>,
  invoice: { draft: true, sent: true, partially_paid: true, paid: true, overdue: true, cancelled: true } satisfies Record<Enums<"invoice_status">, true>,
  task: { todo: true, in_progress: true, done: true } satisfies Record<Enums<"task_status">, true>,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid row")
  return value as Record<string, unknown>
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid ID")
  return value.toLowerCase()
}

function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value)
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date")
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Invalid date")
  return value
}

function status<K extends RecordKind>(kind: K, value: unknown): RecordOf<K>["status"] {
  if (typeof value !== "string" || !Object.hasOwn(STATUSES[kind], value)) throw new Error("Invalid status")
  return value as RecordOf<K>["status"]
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid boolean")
  return value
}

export function parseRecord(kind: "deal", raw: unknown): DealRecord
export function parseRecord(kind: "project", raw: unknown): ProjectRecord
export function parseRecord(kind: "invoice", raw: unknown): InvoiceRecord
export function parseRecord(kind: "task", raw: unknown): TaskRecord
export function parseRecord(kind: RecordKind, raw: unknown): ErpRecord {
  const row = object(raw)
  const id = uuid(row.id)
  const key = `${kind}:${id}` as const
  switch (kind) {
    case "deal":
      return { kind, id, key, status: status(kind, row.stage), expectedCloseDate: nullableDate(row.expected_close_date), nextFollowUpDate: nullableDate(row.next_follow_up_date) }
    case "project":
      return { kind, id, key, status: status(kind, row.status), deadline: nullableDate(row.deadline), dealId: nullableUuid(row.deal_id) }
    case "invoice":
      nullableUuid(row.issued_snapshot_id)
      return { kind, id, key, status: status(kind, row.status), dueDate: nullableDate(row.due_date), projectId: nullableUuid(row.project_id), issued: row.issued_snapshot_id !== null }
    case "task":
      return { kind, id, key, status: status(kind, row.status), done: boolean(row.done), dueDate: nullableDate(row.due_date), projectId: uuid(row.project_id) }
  }
}

export function parseCollection<K extends RecordKind>(kind: K, result: QueryResult): RecordCollection<K> {
  if (result.error) return { state: "unavailable", reason: "query" }
  try {
    if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0 || !Array.isArray(result.data)) throw new Error("Invalid result")
    const limit = RECORD_LIMITS[kind]
    if (result.data.length > limit + 1) throw new Error("Unbounded result")
    const parsed = result.data.map((row) => parseRecord(kind as never, row)) as RecordOf<K>[]
    const ids = new Set(parsed.map((record) => record.id))
    if (ids.size !== parsed.length) throw new Error("Duplicate ID")
    if (parsed.some((record, index) => index > 0 && parsed[index - 1].id >= record.id)) throw new Error("Unstable order")
    const records = parsed.slice(0, limit)
    if (result.data.length <= limit && result.count !== result.data.length) throw new Error("Count and sample differ")
    if (result.data.length === limit + 1 && result.count <= limit) throw new Error("Sentinel exceeds count")
    if (result.count === 0) {
      if (result.data.length !== 0) throw new Error("Nonempty zero count")
      return { state: "empty", total: 0, displayed: 0, truncated: false, records: [] }
    }
    return { state: "ready", total: result.count, displayed: records.length, truncated: result.count > records.length || result.data.length > records.length, records }
  } catch {
    return { state: "unavailable", reason: "invalid" }
  }
}
