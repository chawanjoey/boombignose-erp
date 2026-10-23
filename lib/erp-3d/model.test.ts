import { describe, expect, it } from "vitest"
import { parseCollection, parseRecord } from "./model"

const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`
const deal = (n: number) => ({ id: id(n), stage: "won", expected_close_date: null, next_follow_up_date: null })

describe("ERP record projection", () => {
  it("copies only allowed fields and keeps an issued invoice distinct from paid status", () => {
    const source = { id: id(1), status: "sent", due_date: null, project_id: null, issued_snapshot_id: id(2), amount_satang: 200000, notes: "secret", client_id: id(3) }
    const record = parseRecord("invoice", source)
    expect(record).toEqual({ kind: "invoice", key: `invoice:${id(1)}`, id: id(1), status: "sent", dueDate: null, projectId: null, issued: true })
    expect(JSON.stringify(record)).not.toMatch(/amount|notes|client|snapshot_id|200000|secret/)
    expect(source.issued_snapshot_id).toBe(id(2))
  })

  it("reports empty, query failure, missing count and malformed rows as distinct states", () => {
    expect(parseCollection("deal", { data: [], count: 0, error: null }).state).toBe("empty")
    expect(parseCollection("deal", { data: null, count: null, error: { code: "42501" } })).toEqual({ state: "unavailable", reason: "query" })
    expect(parseCollection("deal", { data: [], count: null, error: null })).toEqual({ state: "unavailable", reason: "invalid" })
    expect(parseCollection("deal", { data: [{ ...deal(1), stage: "imaginary" }], count: 1, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [{ ...deal(1), expected_close_date: "2026-02-30" }], count: 1, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [{ ...deal(1), id: "bad" }], count: 1, error: null }).state).toBe("unavailable")
  })

  it("rejects duplicate IDs and impossible exact count/sample pairs", () => {
    expect(parseCollection("deal", { data: [deal(1), deal(1)], count: 2, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [deal(2), deal(1)], count: 2, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [], count: 1, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [deal(1)], count: 0, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: Array.from({ length: 51 }, (_, n) => deal(n + 1)), count: 50, error: null }).state).toBe("unavailable")
    expect(parseCollection("deal", { data: [...Array.from({ length: 50 }, (_, n) => deal(n + 1)), deal(50)], count: 51, error: null }).state).toBe("unavailable")
  })

  it("keeps an exact total while capping a stable bounded sample", () => {
    const result = parseCollection("deal", { data: Array.from({ length: 51 }, (_, n) => deal(n + 1)), count: 1001, error: null })
    expect(result.state).toBe("ready")
    if (result.state !== "ready") return
    expect(result).toMatchObject({ total: 1001, displayed: 50, truncated: true })
    expect(result.records[0].id).toBe(id(1))
    expect(result.records.at(-1)?.id).toBe(id(50))
    expect(result.records).toHaveLength(50)
  })
})
