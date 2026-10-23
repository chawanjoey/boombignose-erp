import { expect, test, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { loginDemo } from "../e2e/auth"

function localSql(statement: string): string {
  const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8")) as { root: string; project: string; app: number; api: number; db: number }
  const root = realpathSync(process.cwd())
  const lane = isolation.app - 3100
  if (isolation.root !== root || isolation.project !== `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}` || isolation.api !== 55000 + lane * 100 + 1 || isolation.db !== isolation.api + 1 || process.env.NEXT_PUBLIC_APP_URL !== `http://127.0.0.1:${isolation.app}`) throw new Error("SQL fixture requires this isolated worktree")
  return execFileSync("psql", ["-h", "127.0.0.1", "-p", String(isolation.db), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", statement], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim()
}

async function openMap(page: Page) {
  await loginDemo(page)
  await page.goto("/erp-3d")
  const host = page.getByTestId("erp3d-scene")
  await expect(host).toHaveAttribute("data-state", "ready")
  await expect(host).toHaveAttribute("data-webgl", "active")
  await expect.poll(async () => Number(await host.getAttribute("data-render-count"))).toBeGreaterThan(0)
  return host
}

async function pick(page: Page, kind: string) {
  const host = page.getByTestId("erp3d-scene")
  await host.scrollIntoViewIfNeeded()
  const targets = JSON.parse((await host.getAttribute("data-pick-targets"))!) as { key: string; x: number; y: number }[]
  const target = targets.find((item) => item.key.startsWith(`${kind}:`))!
  const bounds = (await host.locator("canvas").boundingBox())!
  await page.mouse.click(bounds.x + bounds.width * target.x, bounds.y + bounds.height * target.y)
  await expect(host).toHaveAttribute("data-selected-key", target.key)
  await expect(page.getByTestId("erp3d-detail-id")).toHaveText(target.key.split(":")[1])
  return target.key
}

test("real WebGL pixels, raycast selection and list share the same record", async ({ page }, info) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const host = await openMap(page)
  const canvas = host.locator("canvas")
  const screenshot = await canvas.screenshot()
  expect(screenshot.length).toBeGreaterThan(10_000)
  expect(await host.getAttribute("data-node-count")).toBe("23")
  const initialTargets = JSON.parse((await host.getAttribute("data-pick-targets"))!) as { key: string; x: number; y: number }[]
  for (const kind of ["deal", "project", "invoice", "task"]) {
    const targets = initialTargets.filter((item) => item.key.startsWith(`${kind}:`))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) { expect(target.x).toBeGreaterThan(0.05); expect(target.x).toBeLessThan(0.95); expect(target.y).toBeGreaterThan(0.05); expect(target.y).toBeLessThan(0.95) }
  }
  for (const kind of ["deal", "project", "invoice", "task"]) {
    const key = await pick(page, kind)
    const status = await page.getByTestId("erp3d-detail-status").textContent()
    await page.getByTestId(`erp3d-record-${key}`).click()
    await expect(page.getByTestId("erp3d-detail-status")).toHaveText(status!)
    await expect(host).toHaveAttribute("data-selected-key", key)
    await expect(page.getByTestId("erp3d-detail-link")).toHaveAttribute("href", kind === "task" ? /\/projects\// : kind === "invoice" ? /\/finance\/invoices\// : new RegExp(`/${kind}s/`))
  }
  const bounds = (await canvas.boundingBox())!
  const before = await host.getAttribute("data-selected-key")
  const frames = Number(await host.getAttribute("data-render-count"))
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, { steps: 8 })
  await page.mouse.up()
  await expect(host).toHaveAttribute("data-selected-key", before!)
  await expect.poll(async () => Number(await host.getAttribute("data-render-count"))).toBeGreaterThan(frames)
  await page.getByRole("button", { name: "Reset view" }).click()
  await expect.poll(async () => JSON.parse((await host.getAttribute("data-pick-targets"))!)[0].x).toBeCloseTo(initialTargets[0].x, 3)
  await page.screenshot({ path: info.outputPath("webgl-picking.png"), fullPage: true })
  expect(errors).toEqual([])
})

test("selected lines are limited to recorded FK neighbors", async ({ page }, info) => {
  const host = await openMap(page)
  const task = await pick(page, "task")
  const parent = await page.getByTestId("erp3d-detail-parent").textContent()
  expect(parent).toContain("Loaded record")
  expect(Number(await host.getAttribute("data-visible-edge-count"))).toBeGreaterThan(0)
  const visibleTogether = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="erp3d-scene"] canvas')!.getBoundingClientRect()
    const detail = document.querySelector('[data-testid="erp3d-detail"]')!.getBoundingClientRect()
    return canvas.top < innerHeight && canvas.bottom > 0 && detail.top < innerHeight && detail.bottom > 0
  })
  expect(visibleTogether).toBe(true)
  await page.screenshot({ path: info.outputPath("webgl-edges-and-detail.png") })
  await page.getByRole("button", { name: "Close details" }).click()
  await expect(host).toHaveAttribute("data-visible-edge-count", "0")
  expect(task).toMatch(/^task:/)
  await page.screenshot({ path: info.outputPath("webgl-edges.png"), fullPage: true })
})

test("no WebGL2 keeps the accessible list and explicit retry", async ({ page, context }, info) => {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind, ...args) {
      return kind === "webgl2" ? null : original.call(this, kind, ...args)
    } as typeof original
  })
  await loginDemo(page)
  await page.goto("/erp-3d")
  const host = page.getByTestId("erp3d-scene")
  await expect(host).toHaveAttribute("data-state", "unavailable")
  await expect(host.locator("canvas")).toHaveCount(0)
  await page.getByTestId("erp3d-deal-collection").locator("button").first().focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("erp3d-detail")).toBeVisible()
  await expect(page.getByTestId("erp3d-detail-link")).toHaveAttribute("href", /\/deals\//)
  await page.getByRole("button", { name: "Try 3D map again" }).click()
  await expect(host).toHaveAttribute("data-state", "unavailable")
  await expect(host.locator("canvas")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("webgl-unavailable.png"), fullPage: true })
})

test("context loss stops drawing and retry creates one fresh canvas", async ({ page }, info) => {
  const host = await openMap(page)
  await pick(page, "project")
  const scope = await page.getByTestId("erp3d-root").getAttribute("data-scope")
  await host.locator("canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!
    gl.getExtension("WEBGL_lose_context")!.loseContext()
  })
  await expect(host).toHaveAttribute("data-state", "unavailable")
  await expect(host.locator("canvas")).toHaveCount(0)
  await expect(page.getByTestId("erp3d-detail")).toBeVisible()
  await page.getByRole("button", { name: "Try 3D map again" }).click()
  await expect(host).toHaveAttribute("data-state", "ready")
  await expect(host.locator("canvas")).toHaveCount(1)
  await expect(page.getByTestId("erp3d-root")).toHaveAttribute("data-scope", scope!)
  await page.screenshot({ path: info.outputPath("webgl-context.png"), fullPage: true })
})

test("idle, hidden and offscreen scene does not keep rendering", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const host = await openMap(page)
  await page.waitForTimeout(250)
  const idle = await host.getAttribute("data-render-count")
  await page.waitForTimeout(350)
  await expect(host).toHaveAttribute("data-render-count", idle!)
  await host.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")) })
  await page.waitForTimeout(250)
  await expect(host).toHaveAttribute("data-render-count", idle!)
  await host.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")) })
  await expect.poll(async () => Number(await host.getAttribute("data-render-count"))).toBeGreaterThan(Number(idle))
  await page.getByTestId("erp3d-task-collection").scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  const offscreen = await host.getAttribute("data-render-count")
  await page.waitForTimeout(350)
  await expect(host).toHaveAttribute("data-render-count", offscreen!)
  await host.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("webgl-motion.png"), fullPage: true })
})

test("375px layout retains keyboard access without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const host = await openMap(page)
  await expect(host.locator("canvas")).toBeVisible()
  const targets = JSON.parse((await host.getAttribute("data-pick-targets"))!) as { key: string; x: number; y: number }[]
  for (const kind of ["deal", "project", "invoice", "task"]) {
    const group = targets.filter((item) => item.key.startsWith(`${kind}:`))
    expect(group.length).toBeGreaterThan(0)
    for (const target of group) { expect(target.x).toBeGreaterThan(0.05); expect(target.x).toBeLessThan(0.95); expect(target.y).toBeGreaterThan(0.05); expect(target.y).toBeLessThan(0.95) }
  }
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(width[0]).toBeLessThanOrEqual(width[1])
  const row = page.getByTestId("erp3d-invoice-collection").locator("button").first()
  await row.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("complementary", { name: "Selected record details" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(row).toBeFocused()
  await page.screenshot({ path: info.outputPath("webgl-layout.png"), fullPage: true })
})

test("250 loaded records from four real tables remain selectable with totals above 1000", async ({ page }, info) => {
  test.setTimeout(120_000)
  const org = "a0000000-0000-0000-0000-000000000001"
  const client = localSql(`select id from public.clients where org_id='${org}' order by id limit 1`)
  const seedDeal = localSql(`select id from public.deals where org_id='${org}' order by id limit 1`)
  const seedProject = localSql(`select id from public.projects where org_id='${org}' order by id limit 1`)
  expect(client).toMatch(/^[0-9a-f-]{36}$/)
  try {
    localSql(`insert into public.deals(id,org_id,client_id,title) select md5('erp3d-250-deal-'||g)::uuid,'${org}','${client}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
    localSql(`insert into public.projects(id,org_id,deal_id,name) select md5('erp3d-250-project-'||g)::uuid,'${org}','${seedDeal}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
    localSql(`insert into public.invoices(id,org_id,client_id,project_id,number) select md5('erp3d-250-invoice-'||g)::uuid,'${org}','${client}','${seedProject}','ERP3D-250-'||g from generate_series(1,1001) g on conflict do nothing`)
    localSql(`insert into public.project_tasks(id,org_id,project_id,title) select md5('erp3d-250-task-'||g)::uuid,'${org}','${seedProject}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
    const host = await openMap(page)
    await expect(host).toHaveAttribute("data-node-count", "250")
    for (const [kind, shown] of [["deal", 50], ["project", 50], ["invoice", 50], ["task", 100]] as const) {
      const count = page.getByTestId(`erp3d-${kind}-count`)
      await expect(count).toContainText(`${shown} displayed / `)
      const total = Number((await count.textContent())!.match(/\/ (\d+) total/)![1])
      expect(total).toBeGreaterThan(1000)
    }
    const targets = JSON.parse((await host.getAttribute("data-pick-targets"))!) as { key: string; x: number; y: number }[]
    expect(targets).toHaveLength(250)
    for (const target of targets) { expect(target.x).toBeGreaterThan(0.05); expect(target.x).toBeLessThan(0.95); expect(target.y).toBeGreaterThan(0.05); expect(target.y).toBeLessThan(0.95) }
    await pick(page, "task")
    await page.screenshot({ path: info.outputPath("webgl-large.png"), fullPage: true })
  } finally {
    localSql(`delete from public.project_tasks where org_id='${org}' and title='ERP3D 250 fixture'`)
    localSql(`delete from public.invoices where org_id='${org}' and number like 'ERP3D-250-%'`)
    localSql(`delete from public.projects where org_id='${org}' and name='ERP3D 250 fixture'`)
    localSql(`delete from public.deals where org_id='${org}' and title='ERP3D 250 fixture'`)
  }
})

test("twenty route visits release their canvas and renderer ownership", async ({ page }, info) => {
  test.setTimeout(120_000)
  await loginDemo(page)
  for (let cycle = 0; cycle < 20; cycle++) {
    await page.goto("/erp-3d")
    const host = page.getByTestId("erp3d-scene")
    await expect(host).toHaveAttribute("data-state", "ready")
    await expect(host.locator("canvas")).toHaveCount(1)
    await expect(page.locator("html")).toHaveAttribute("data-erp3d-active-scenes", "1")
    await page.getByTestId("erp3d-deal-collection").locator("button").first().click()
    await expect(page.getByTestId("erp3d-detail")).toBeVisible()
    await page.getByRole("link", { name: "Dashboard", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.locator("html")).toHaveAttribute("data-erp3d-active-scenes", "0")
    await expect(page.locator('canvas[aria-label="Interactive record map"]')).toHaveCount(0)
  }
  await page.screenshot({ path: info.outputPath("webgl-lifecycle.png") })
})
