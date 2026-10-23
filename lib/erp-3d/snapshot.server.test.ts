import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readErpScene } from "./snapshot.server"

const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`
const orgA = id(91)
const orgB = id(92)

function clientFor(orgId: string) {
  const calls: { table: string; columns: string; options: unknown; filter: [string, string] | null; order: unknown; limit: number }[] = []
  const responses: Record<string, { data: unknown[]; count: number | null; error: unknown }> = {
    deals: { data: [{ id: id(1), stage: "lead", expected_close_date: null, next_follow_up_date: null }], count: 1, error: null },
    projects: { data: [], count: 0, error: null },
    invoices: { data: [], count: 0, error: null },
    project_tasks: { data: [], count: 0, error: null },
  }
  const client = {
    from(table: string) {
      const call = { table, columns: "", options: null as unknown, filter: null as [string, string] | null, order: null as unknown, limit: 0 }
      calls.push(call)
      const query = {
        select(columns: string, options: unknown) { call.columns = columns; call.options = options; return query },
        eq(column: string, value: string) { call.filter = [column, value]; return query },
        order(column: string, options: unknown) { call.order = [column, options]; return query },
        limit(value: number) { call.limit = value; return query },
        then(resolve: (response: typeof responses[string]) => unknown) { return Promise.resolve(responses[table]).then(resolve) },
      }
      return query
    },
  }
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: id(20), email: null, orgId, orgName: "Synthetic", role: "member" })
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
  return { calls, responses }
}

describe("readErpScene", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([orgA, orgB])("uses the session workspace %s in every exact counted GET", async (orgId) => {
    const { calls } = clientFor(orgId)
    const result = await readErpScene()
    expect(result.scope).toEqual({ key: `${orgId}:member`, orgId, role: "member" })
    expect(result.version).toBe(1)
    expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(new Date(result.requestedAt).getTime())
    expect(calls.map(({ table, limit }) => [table, limit])).toEqual([["deals", 51], ["projects", 51], ["invoices", 51], ["project_tasks", 101]])
    for (const call of calls) {
      expect(call.filter).toEqual(["org_id", orgId])
      expect(call.options).toEqual({ count: "exact" })
      expect(call.order).toEqual(["id", { ascending: true }])
      expect(call.columns).not.toMatch(/title|name|amount|client|notes|email|owner|assignee|evidence/)
    }
    expect(result.collections.deal.state).toBe("ready")
    expect(result.collections.project.state).toBe("empty")
  })

  it("keeps one failed collection unavailable while preserving others", async () => {
    const { responses } = clientFor(orgA)
    responses.invoices = { data: [], count: null, error: { code: "42501" } }
    const result = await readErpScene()
    expect(result.collections.invoice).toEqual({ state: "unavailable", reason: "query" })
    expect(result.collections.deal.state).toBe("ready")
    expect(result.collections.project.state).toBe("empty")
  })
})
