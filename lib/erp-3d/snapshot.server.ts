import "server-only"

import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { parseCollection, type ErpSnapshot } from "./model"

export async function readErpScene(): Promise<ErpSnapshot> {
  const requestedAt = new Date().toISOString()
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const [deals, projects, invoices, tasks] = await Promise.all([
    supabase.from("deals").select("id,stage,expected_close_date,next_follow_up_date", { count: "exact" }).eq("org_id", ctx.orgId).order("id", { ascending: true }).limit(51),
    supabase.from("projects").select("id,status,deadline,deal_id", { count: "exact" }).eq("org_id", ctx.orgId).order("id", { ascending: true }).limit(51),
    supabase.from("invoices").select("id,status,due_date,project_id,issued_snapshot_id", { count: "exact" }).eq("org_id", ctx.orgId).order("id", { ascending: true }).limit(51),
    supabase.from("project_tasks").select("id,project_id,status,done,due_date", { count: "exact" }).eq("org_id", ctx.orgId).order("id", { ascending: true }).limit(101),
  ])

  return {
    version: 1,
    scope: { key: `${ctx.orgId}:${ctx.role}`, orgId: ctx.orgId, role: ctx.role },
    requestedAt,
    completedAt: new Date().toISOString(),
    collections: {
      deal: parseCollection("deal", deals),
      project: parseCollection("project", projects),
      invoice: parseCollection("invoice", invoices),
      task: parseCollection("task", tasks),
    },
  }
}
