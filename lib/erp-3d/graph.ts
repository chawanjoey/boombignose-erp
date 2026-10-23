import type { ErpRecord, ErpSnapshot, RecordKey, RecordKind } from "./model"

export type ParentRelation =
  | { state: "none" }
  | { state: "loaded"; key: RecordKey }
  | { state: "outside-sample"; kind: RecordKind; id: string }
  | { state: "unavailable"; kind: RecordKind; id: string }

export type RecordEdge = { from: RecordKey; to: RecordKey }

export type RecordGraph = {
  nodes: ErpRecord[]
  byKey: Map<RecordKey, ErpRecord>
  edges: RecordEdge[]
  adjacency: Map<RecordKey, RecordKey[]>
  parent: Map<RecordKey, ParentRelation>
}

export function buildRecordGraph(snapshot: ErpSnapshot): RecordGraph {
  const nodes: ErpRecord[] = []
  for (const kind of ["deal", "project", "invoice", "task"] as const) {
    const collection = snapshot.collections[kind]
    if (collection.state === "ready") nodes.push(...collection.records)
  }
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const edges: RecordEdge[] = []
  const adjacency = new Map<RecordKey, RecordKey[]>(nodes.map((node) => [node.key, []]))
  const parent = new Map<RecordKey, ParentRelation>()

  for (const node of nodes) {
    let target: { kind: RecordKind; id: string | null } | null = null
    if (node.kind === "project") target = { kind: "deal", id: node.dealId }
    if (node.kind === "invoice") target = { kind: "project", id: node.projectId }
    if (node.kind === "task") target = { kind: "project", id: node.projectId }
    if (!target || target.id === null) {
      parent.set(node.key, { state: "none" })
      continue
    }
    const key = `${target.kind}:${target.id}` as RecordKey
    if (snapshot.collections[target.kind].state === "unavailable") {
      parent.set(node.key, { state: "unavailable", kind: target.kind, id: target.id })
    } else if (!byKey.has(key)) {
      parent.set(node.key, { state: "outside-sample", kind: target.kind, id: target.id })
    } else {
      parent.set(node.key, { state: "loaded", key })
      edges.push({ from: node.key, to: key })
      adjacency.get(node.key)!.push(key)
      adjacency.get(key)!.push(node.key)
    }
  }

  return { nodes, byKey, edges, adjacency, parent }
}

export function recordHref(record: ErpRecord): string {
  switch (record.kind) {
    case "deal": return `/deals/${record.id}`
    case "project": return `/projects/${record.id}`
    case "invoice": return `/finance/invoices/${record.id}`
    case "task": return `/projects/${record.projectId}`
  }
}

export function recordLabel(record: Pick<ErpRecord, "kind" | "id">): string {
  const label = { deal: "Deal", project: "Project", invoice: "Invoice", task: "Task" }[record.kind]
  return `${label} · ${record.id.slice(-8)}`
}
