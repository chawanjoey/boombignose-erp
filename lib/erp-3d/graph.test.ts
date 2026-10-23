import { describe, expect, it } from "vitest"
import { buildRecordGraph, recordHref } from "./graph"
import { parseCollection, type ErpSnapshot } from "./model"

const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`

function snapshot(): ErpSnapshot {
  return {
    version: 1,
    scope: { key: `${id(20)}:owner`, orgId: id(20), role: "owner" },
    requestedAt: "2026-10-23T00:00:00.000Z",
    completedAt: "2026-10-23T00:00:01.000Z",
    collections: {
      deal: parseCollection("deal", { data: [{ id: id(1), stage: "won", expected_close_date: null, next_follow_up_date: null }], count: 1, error: null }),
      project: parseCollection("project", { data: [{ id: id(2), status: "in_progress", deadline: null, deal_id: id(1) }, { id: id(3), status: "review", deadline: null, deal_id: id(19) }], count: 2, error: null }),
      invoice: parseCollection("invoice", { data: [{ id: id(4), status: "sent", due_date: null, project_id: id(2), issued_snapshot_id: id(10) }], count: 1, error: null }),
      task: parseCollection("task", { data: [{ id: id(5), status: "todo", done: false, due_date: null, project_id: id(2) }], count: 1, error: null }),
    },
  }
}

describe("ERP record graph", () => {
  it("links only loaded foreign-key endpoints", () => {
    const graph = buildRecordGraph(snapshot())
    expect(graph.edges).toEqual([
      { from: `project:${id(2)}`, to: `deal:${id(1)}` },
      { from: `invoice:${id(4)}`, to: `project:${id(2)}` },
      { from: `task:${id(5)}`, to: `project:${id(2)}` },
    ])
    expect(graph.adjacency.get(`project:${id(2)}`)).toEqual([`deal:${id(1)}`, `invoice:${id(4)}`, `task:${id(5)}`])
    expect(graph.parent.get(`project:${id(3)}`)).toEqual({ state: "outside-sample", kind: "deal", id: id(19) })
    expect(graph.byKey.get(`task:${id(5)}`)?.kind).toBe("task")
    expect(graph.byKey.get(`task:${id(99)}`)).toBeUndefined()
  })

  it("marks a failed parent collection without inventing an edge", () => {
    const input = snapshot()
    input.collections.deal = { state: "unavailable", reason: "query" }
    const graph = buildRecordGraph(input)
    expect(graph.edges.every((edge) => edge.to !== `deal:${id(1)}`)).toBe(true)
    expect(graph.parent.get(`project:${id(2)}`)).toEqual({ state: "unavailable", kind: "deal", id: id(1) })
  })

  it("routes a task to its project without a fabricated task anchor", () => {
    const graph = buildRecordGraph(snapshot())
    const task = graph.byKey.get(`task:${id(5)}`)
    expect(task && recordHref(task)).toBe(`/projects/${id(2)}`)
    const invoice = graph.byKey.get(`invoice:${id(4)}`)
    expect(invoice && recordHref(invoice)).toBe(`/finance/invoices/${id(4)}`)
  })
})
