import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { loginDemo } from "../e2e/auth"

const api = process.env.NEXT_PUBLIC_SUPABASE_URL!
const app = process.env.NEXT_PUBLIC_APP_URL!
const admin = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const seedOrg = "a0000000-0000-0000-0000-000000000001"

function localSql(statement: string): string {
  const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8")) as { root: string; project: string; app: number; api: number; db: number }
  const root = realpathSync(process.cwd())
  const lane = isolation.app - 3100
  const expectedProject = `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`
  if (isolation.root !== root || isolation.project !== expectedProject || isolation.api !== 55000 + lane * 100 + 1 || isolation.db !== isolation.api + 1 || app !== `http://127.0.0.1:${isolation.app}` || api !== `http://127.0.0.1:${isolation.api}`) throw new Error("SQL fixture requires this isolated worktree")
  return execFileSync("psql", ["-h", "127.0.0.1", "-p", String(isolation.db), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", statement], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim()
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (new URL(page.url()).pathname === "/erp-3d") await expect(page.getByTestId("erp3d-root")).toBeVisible()
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
}

async function selectFirst(page: Page, kind: string) {
  await page.getByTestId(`erp3d-${kind}-collection`).locator("button").first().click()
  await expect(page.getByTestId("erp3d-detail")).toBeVisible()
}

test.describe.configure({ mode: "serial" })

test("unauthenticated request has no ERP records", async ({ page }, info) => {
  const response = await page.goto("/erp-3d")
  await expect(page).toHaveURL(/\/login/)
  expect(await response?.text()).not.toContain("ERP Record Explorer")
  await shot(page, info, "data-auth")
})

test("seeded owner sees exact counts and can open every record kind", async ({ page }, info) => {
  await loginDemo(page)
  const response = await page.goto("/erp-3d")
  await expect(page.getByTestId("erp3d-root")).toBeVisible()
  await expect(page.getByTestId("erp3d-scope")).toContainText(`${seedOrg} · owner`)
  for (const [kind, table] of [["deal", "deals"], ["project", "projects"], ["invoice", "invoices"], ["task", "project_tasks"]] as const) {
    const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("org_id", seedOrg)
    expect(error).toBeNull()
    await expect(page.getByTestId(`erp3d-${kind}-count`)).toHaveText(`${count} displayed / ${count} total`)
    await selectFirst(page, kind)
    const href = await page.getByTestId("erp3d-detail-link").getAttribute("href")
    expect(href).toMatch(kind === "task" ? /^\/projects\// : kind === "invoice" ? /^\/finance\/invoices\// : new RegExp(`^/${kind}s/`))
    await page.getByTestId("erp3d-detail-link").click()
    await expect(page).toHaveURL(new RegExp(href!.replaceAll("/", "\\/")))
    await page.goto("/erp-3d")
  }
  const html = await response?.text()
  expect(html).not.toMatch(/LINE Sales-Support Bot|amount_satang|issued_snapshot_id|value_satang/)
  await shot(page, info, "data-links")
})

test("forged active workspace cookie falls back to authorized org", async ({ page, context }, info) => {
  await loginDemo(page)
  await context.addCookies([{ name: "active_org", value: randomUUID(), url: app }])
  await page.goto("/erp-3d")
  await expect(page.getByTestId("erp3d-scope")).toContainText(seedOrg)
  await expect(page.getByTestId("erp3d-deal-count")).not.toContainText("unavailable")
  await shot(page, info, "data-scope")
})

test("a two-org member sees only the chosen org, including its empty state", async ({ page, context }, info) => {
  const orgId = randomUUID()
  const projectId = randomUUID()
  const userId = "b0000000-0000-0000-0000-000000000001"
  const slug = `erp3d-${orgId.slice(0, 8)}`
  const insertedOrg = await admin.from("organizations").insert({ id: orgId, name: "ERP3D isolated test org", slug })
  expect(insertedOrg.error).toBeNull()
  try {
    const membership = await admin.from("memberships").insert({ org_id: orgId, user_id: userId, role: "owner" })
    expect(membership.error).toBeNull()
    const project = await admin.from("projects").insert({ id: projectId, org_id: orgId, name: "ERP3D scope sentinel" })
    expect(project.error).toBeNull()
    await loginDemo(page)
    await context.addCookies([{ name: "active_org", value: orgId, url: app }])
    const secondResponse = await page.goto("/erp-3d")
    await expect(page.getByTestId("erp3d-scope")).toContainText(orgId)
    await expect(page.getByTestId("erp3d-project-count")).toHaveText("1 displayed / 1 total")
    await expect(page.getByTestId("erp3d-deal-empty")).toBeVisible()
    expect(await secondResponse?.text()).not.toContain("BoomBigNose AI")
    await shot(page, info, "data-two-org")

    const removed = await admin.from("projects").delete().eq("id", projectId)
    expect(removed.error).toBeNull()
    await page.getByTestId("erp3d-reload").click()
    await expect(page.getByTestId("erp3d-project-empty")).toBeVisible()

    await context.addCookies([{ name: "active_org", value: seedOrg, url: app }])
    await page.getByTestId("erp3d-reload").click()
    await expect(page.getByTestId("erp3d-scope")).toContainText(seedOrg)
    await expect(page.getByTestId("erp3d-deal-empty")).toHaveCount(0)
  } finally {
    await admin.from("projects").delete().eq("id", projectId)
    const membership = await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId)
    expect(membership.error).toBeNull()
    const removedOrg = await admin.from("organizations").delete().eq("id", orgId)
    expect(removedOrg.error).toBeNull()
  }
})

test("member receives the same minimal projection without privileged fields", async ({ page }, info) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill("nattapong@boombignose.org")
  await page.getByLabel("Password").fill("BoomDemo123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
  const response = await page.goto("/erp-3d")
  await expect(page.getByTestId("erp3d-scope")).toContainText(`${seedOrg} · member`)
  expect(await response?.text()).not.toMatch(/amount_satang|outbound_events|issued_snapshot_id|value_satang/)
  await shot(page, info, "data-roles")
})

test("large synthetic project set reports exact total and a fifty-row subset", async ({ page }, info) => {
  const ids = Array.from({ length: 1001 }, () => randomUUID())
  try {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { error } = await admin.from("projects").insert(ids.slice(offset, offset + 100).map((id) => ({ id, org_id: seedOrg, name: "ERP3D synthetic limit case" })))
      expect(error).toBeNull()
    }
    await loginDemo(page)
    await page.goto("/erp-3d")
    const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("org_id", seedOrg)
    await expect(page.getByTestId("erp3d-project-count")).toHaveText(`50 displayed / ${count} total`)
    await expect(page.getByTestId("erp3d-project-subset")).toBeVisible()
    await expect(page.getByTestId("erp3d-project-collection").locator("button")).toHaveCount(50)
    await shot(page, info, "data-limit")
  } finally {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { error } = await admin.from("projects").delete().in("id", ids.slice(offset, offset + 100))
      expect(error).toBeNull()
    }
  }
})

test("real relations and invoice status remain literal", async ({ page }, info) => {
  await loginDemo(page)
  await page.goto("/erp-3d")
  await selectFirst(page, "invoice")
  const status = await page.getByTestId("erp3d-detail-status").textContent()
  expect(status).toBeTruthy()
  await expect(page.getByTestId("erp3d-detail")).toContainText("Issued snapshot")
  if (status !== "paid") await expect(page.getByTestId("erp3d-detail")).not.toContainText("Payment verified")
  await selectFirst(page, "task")
  await expect(page.getByTestId("erp3d-detail-parent")).toContainText(/Loaded record|outside this sample/)
  await shot(page, info, "data-relations")
})

test("document reload gets a new observation interval", async ({ page }, info) => {
  await loginDemo(page)
  await page.goto("/erp-3d")
  const before = await page.getByTestId("erp3d-requested").getAttribute("datetime")
  await page.waitForTimeout(1100)
  await page.getByTestId("erp3d-reload").click()
  await expect(page.getByTestId("erp3d-requested")).not.toHaveAttribute("datetime", before!)
  await expect(page.getByTestId("erp3d-scope")).toContainText(seedOrg)
  await shot(page, info, "data-refresh")
})

test("one failed collection stays unavailable and recovers after permission restoration", async ({ page }, info) => {
  await loginDemo(page)
  const hadGrant = localSql("select exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name='projects' and grantee='authenticated' and privilege_type='SELECT')")
  expect(hadGrant).toBe("t")
  try {
    localSql("revoke select on table public.projects from authenticated")
    await page.goto("/erp-3d")
    await expect(page.getByTestId("erp3d-project-unavailable")).toBeVisible()
    await expect(page.getByTestId("erp3d-project-count")).toHaveText("Count unavailable")
    await expect(page.getByTestId("erp3d-deal-count")).toContainText("displayed")
    await selectFirst(page, "invoice")
    await expect(page.getByTestId("erp3d-detail-parent")).toContainText("could not be checked")
    await shot(page, info, "data-states")
  } finally {
    localSql("grant select on table public.projects to authenticated")
  }
  await page.getByTestId("erp3d-reload").click()
  await expect(page.getByTestId("erp3d-project-count")).toHaveText("4 displayed / 4 total")
})

test("375px keyboard selection brings detail into view and returns focus", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await loginDemo(page)
  await page.goto("/erp-3d")
  const first = page.getByTestId("erp3d-deal-collection").locator("button").first()
  const panel = page.getByRole("complementary", { name: "Selected record details" })
  await first.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("erp3d-detail")).toBeVisible()
  await expect(panel).toBeFocused()
  const bounds = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: window.innerHeight }
  })
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
  await shot(page, info, "data-accessibility-detail")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Close details" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByTestId("erp3d-detail-link")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/deals\//)

  await page.goto("/erp-3d")
  await first.focus()
  await page.keyboard.press("Enter")
  await expect(panel).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("erp3d-detail-empty")).toBeVisible()
  await expect(first).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(panel).toBeFocused()
  await page.getByRole("button", { name: "Close details" }).click()
  await expect(first).toBeFocused()
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(width.page).toBeLessThanOrEqual(width.viewport)
  await shot(page, info, "data-accessibility")
})
