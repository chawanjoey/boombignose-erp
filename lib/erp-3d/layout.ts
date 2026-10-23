import type { RecordGraph } from "./graph"
import type { RecordKey, RecordKind } from "./model"

export type ScenePoint = readonly [number, number, number]
export type PositionedRecord = { key: RecordKey; kind: RecordKind; point: ScenePoint }

const KIND_X: Record<RecordKind, number> = { deal: -12, project: -4, invoice: 4, task: 12 }
const KIND_ORDER = ["deal", "project", "invoice", "task"] as const

function hash(key: string): number {
  let value = 2166136261
  for (let index = 0; index < key.length; index++) {
    value ^= key.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

export function positionGraph(graph: Pick<RecordGraph, "nodes">): PositionedRecord[] {
  const groups = new Map(KIND_ORDER.map((kind) => [kind, graph.nodes.filter((node) => node.kind === kind).sort((a, b) => a.key.localeCompare(b.key))]))
  return KIND_ORDER.flatMap((kind) => groups.get(kind)!.map((node, index) => {
    const column = index % 5
    const row = Math.floor(index / 5)
    const middleRow = (Math.ceil(groups.get(kind)!.length / 5) - 1) / 2
    const jitter = hash(node.key)
    return {
      key: node.key,
      kind,
      point: [KIND_X[kind] + (column - 2) * 1.1 + ((jitter & 255) / 255 - 0.5) * 0.22, 0.72 + ((jitter >>> 8 & 255) / 255) * 0.28, (row - middleRow) * 2.2 + ((jitter >>> 16 & 255) / 255 - 0.5) * 0.22] as const,
    }
  }))
}

export function selectedRelations(graph: Pick<RecordGraph, "edges">, key: RecordKey | null) {
  return key === null ? [] : graph.edges.filter((edge) => edge.from === key || edge.to === key)
}
