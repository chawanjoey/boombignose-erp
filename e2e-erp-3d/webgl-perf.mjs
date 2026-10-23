import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { chromium, expect } from "@playwright/test"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const root = realpathSync(process.cwd())
const lane = isolation.app - 3100
const baseURL = `http://127.0.0.1:${isolation.app}`
if (isolation.root !== root || isolation.project !== `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}` || isolation.api !== 55000 + lane * 100 + 1 || isolation.db !== isolation.api + 1) throw new Error("Wrong isolated worktree")
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
if (env.NEXT_PUBLIC_APP_URL !== baseURL || env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Wrong local environment")

function sql(statement) {
  return execFileSync("psql", ["-h", "127.0.0.1", "-p", String(isolation.db), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", statement], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim()
}
function p95(values) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] }

const org = "a0000000-0000-0000-0000-000000000001"
const client = sql(`select id from public.clients where org_id='${org}' order by id limit 1`)
const seedDeal = sql(`select id from public.deals where org_id='${org}' order by id limit 1`)
const seedProject = sql(`select id from public.projects where org_id='${org}' order by id limit 1`)
const browser = await chromium.launch({ executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH })
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const raw = { project: isolation.project, browser: browser.version(), startedAt: new Date().toISOString(), warmup: 5, iterations: 30, samples: [], errors }
try {
  sql(`insert into public.deals(id,org_id,client_id,title) select md5('erp3d-250-deal-'||g)::uuid,'${org}','${client}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
  sql(`insert into public.projects(id,org_id,deal_id,name) select md5('erp3d-250-project-'||g)::uuid,'${org}','${seedDeal}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
  sql(`insert into public.invoices(id,org_id,client_id,project_id,number) select md5('erp3d-250-invoice-'||g)::uuid,'${org}','${client}','${seedProject}','ERP3D-250-'||g from generate_series(1,1001) g on conflict do nothing`)
  sql(`insert into public.project_tasks(id,org_id,project_id,title) select md5('erp3d-250-task-'||g)::uuid,'${org}','${seedProject}','ERP3D 250 fixture' from generate_series(1,1001) g on conflict do nothing`)
  raw.dataset = sql(`select (select count(*) from public.deals where org_id='${org}'),(select count(*) from public.projects where org_id='${org}'),(select count(*) from public.invoices where org_id='${org}'),(select count(*) from public.project_tasks where org_id='${org}')`)
  await page.goto("/login")
  await page.getByLabel("Email").fill("demo@boombignose.org")
  await page.getByLabel("Password").fill("BoomDemo123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
  for (let iteration = 0; iteration < 35; iteration++) {
    const response = await page.goto("/erp-3d", { waitUntil: "domcontentloaded" })
    if (!response?.ok()) throw new Error(`ERP route returned ${response?.status()}`)
    await page.getByTestId("erp3d-root").waitFor()
    const dataReadyMs = await page.evaluate(() => performance.now())
    await page.waitForFunction(() => {
      const scene = document.querySelector('[data-testid="erp3d-scene"]')
      return scene?.getAttribute("data-webgl") === "active" && Number(scene.getAttribute("data-render-count")) > 0
    })
    const sceneReady = await page.getByTestId("erp3d-scene").evaluate((host) => {
      const navigation = performance.getEntriesByType("navigation")[0]
      return { first3dMs: performance.now(), ttfbMs: navigation.responseStart, gpuRenderer: host.dataset.gpuRenderer, nodes: Number(host.dataset.nodeCount), frameMs: Number(host.dataset.frameMs) }
    })
    if (sceneReady.nodes !== 250) throw new Error(`Expected 250 nodes, saw ${sceneReady.nodes}`)
    const target = JSON.parse(await page.getByTestId("erp3d-scene").getAttribute("data-pick-targets")).find((item) => item.key.startsWith("task:"))
    const bounds = await page.getByTestId("erp3d-scene").locator("canvas").boundingBox()
    const started = performance.now()
    await page.mouse.click(bounds.x + bounds.width * target.x, bounds.y + bounds.height * target.y)
    await expect(page.getByTestId("erp3d-detail-id")).toHaveText(target.key.split(":")[1])
    const selectionMs = performance.now() - started
    if (iteration >= 5) raw.samples.push({ iteration: iteration - 5, dataTo3dMs: sceneReady.first3dMs - dataReadyMs, navigationTo3dMs: sceneReady.first3dMs, selectionMs, initialRenderCpuMs: sceneReady.frameMs, ttfbMs: sceneReady.ttfbMs })
    raw.gpuRenderer = sceneReady.gpuRenderer
  }
  await page.waitForTimeout(250)
  const idle = await page.getByTestId("erp3d-scene").getAttribute("data-render-count")
  await page.waitForTimeout(500)
  raw.idleFramesAfterSettle = Number(await page.getByTestId("erp3d-scene").getAttribute("data-render-count")) - Number(idle)
  if (errors.length) throw new Error(`${errors.length} browser page errors`)
  raw.summary = {
    dataTo3dP95Ms: p95(raw.samples.map((item) => item.dataTo3dMs)),
    navigationTo3dP95Ms: p95(raw.samples.map((item) => item.navigationTo3dMs)),
    selectionP95Ms: p95(raw.samples.map((item) => item.selectionMs)),
    initialRenderCpuP95Ms: p95(raw.samples.map((item) => item.initialRenderCpuMs)),
    ttfbP95Ms: p95(raw.samples.map((item) => item.ttfbMs)),
    idleFramesAfterSettle: raw.idleFramesAfterSettle,
  }
  raw.completedAt = new Date().toISOString()
  writeFileSync(".local-stack/erp-3d-webgl-perf.json", JSON.stringify(raw, null, 2))
  process.stdout.write(`${JSON.stringify({ dataset: raw.dataset, gpuRenderer: raw.gpuRenderer, summary: raw.summary })}\n`)
} finally {
  await context.close()
  await browser.close()
  sql(`delete from public.project_tasks where org_id='${org}' and title='ERP3D 250 fixture'`)
  sql(`delete from public.invoices where org_id='${org}' and number like 'ERP3D-250-%'`)
  sql(`delete from public.projects where org_id='${org}' and name='ERP3D 250 fixture'`)
  sql(`delete from public.deals where org_id='${org}' and title='ERP3D 250 fixture'`)
}
