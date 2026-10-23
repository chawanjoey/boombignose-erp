import { describe, expect, it } from "vitest"
import { positionGraph, selectedRelations } from "./layout"
import type { RecordGraph } from "./graph"
import type { RecordKey } from "./model"

const deal = "deal:00000000-0000-0000-0000-000000000001" as RecordKey
const project = "project:00000000-0000-0000-0000-000000000002" as RecordKey

describe("record scene layout", () => {
  it("places records stably regardless of input order and in distinct category bands", () => {
    const nodes = [{ key: project, kind: "project" }, { key: deal, kind: "deal" }] as RecordGraph["nodes"]
    const first = positionGraph({ nodes })
    const second = positionGraph({ nodes: [...nodes].reverse() })
    expect(first).toEqual(second)
    expect(first[0].point[0]).toBeLessThan(first[1].point[0])
    expect(new Set(first.map((node) => node.point.join(","))).size).toBe(2)
  })

  it("limits highlighted connections to actual edges touching the selected record", () => {
    const edges = [{ from: project, to: deal }, { from: "task:other" as RecordKey, to: project }]
    expect(selectedRelations({ edges }, deal)).toEqual([edges[0]])
    expect(selectedRelations({ edges }, null)).toEqual([])
    expect(selectedRelations({ edges }, "invoice:unknown" as RecordKey)).toEqual([])
  })
})
