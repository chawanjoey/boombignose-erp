import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const root = realpathSync(process.cwd())
const lane = isolation.app - 3100
if (isolation.root !== root || isolation.project !== `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`) throw new Error("Wrong isolated worktree")
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
if (env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}` || env.NEXT_PUBLIC_APP_URL !== `http://127.0.0.1:${isolation.app}`) throw new Error("Wrong local environment")

const headURL = `http://127.0.0.1:${isolation.app}`
const baselineURL = process.env.ERP3D_BASELINE_URL
if (baselineURL && !/^http:\/\/(127\.0\.0\.1|localhost):3104$/.test(baselineURL)) throw new Error("Baseline must use the reserved local lane")

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const dataset = { counts: {}, hash: "" }
const datasetHash = createHash("sha256")
for (const table of ["deals", "projects", "invoices", "project_tasks"]) {
  const { count, error: countError } = await admin.from(table).select("id", { count: "exact", head: true }).eq("org_id", "a0000000-0000-0000-0000-000000000001")
  if (countError || count === null) throw new Error(`Cannot count ${table}`)
  dataset.counts[table] = count
  datasetHash.update(`${table}:${count}:`)
  for (let offset = 0; offset < count; offset += 1000) {
    const { data, error } = await admin.from(table).select("id").eq("org_id", "a0000000-0000-0000-0000-000000000001").order("id", { ascending: true }).range(offset, Math.min(offset + 999, count - 1))
    if (error || !data) throw new Error(`Cannot read ${table} IDs`)
    for (const row of data) datasetHash.update(`${row.id}:`)
  }
}
dataset.hash = datasetHash.digest("hex")

const browser = await chromium.launch({ executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH })
const pages = new Map()
async function signedIn(baseURL) {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByLabel("Email").fill("demo@boombignose.org")
  await page.getByLabel("Password").fill("BoomDemo123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
  pages.set(baseURL, { context, page })
  return page
}

async function sample(baseURL, route) {
  const page = pages.get(baseURL).page
  const response = await page.goto(route, { waitUntil: "load" })
  if (!response?.ok()) throw new Error(`${route} returned ${response?.status()}`)
  const body = await response.body()
  const timing = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0]
    if (!(entry instanceof PerformanceNavigationTiming)) throw new Error("Missing navigation timing")
    return { ttfbMs: entry.responseStart, readyMs: entry.loadEventEnd, transferBytes: entry.transferSize }
  })
  return { ...timing, bodyBytes: body.byteLength }
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

const raw = { headURL, baselineURL: baselineURL ?? null, project: isolation.project, dataset, node: process.version, platform: process.platform, arch: process.arch, browser: browser.version(), startedAt: new Date().toISOString(), warmup: 5, iterations: 30, samples: [] }
try {
  await signedIn(headURL)
  if (baselineURL) await signedIn(baselineURL)
  for (let i = 0; i < 35; i++) {
    if (baselineURL) {
      const baseline = await sample(baselineURL, "/dashboard")
      if (i >= 5) raw.samples.push({ iteration: i - 5, target: "baseline-dashboard", ...baseline })
    }
    const head = await sample(headURL, "/dashboard")
    const explorer = await sample(headURL, "/erp-3d")
    if (i >= 5) raw.samples.push({ iteration: i - 5, target: "head-dashboard", ...head }, { iteration: i - 5, target: "head-erp-3d", ...explorer })
  }
  raw.completedAt = new Date().toISOString()
  raw.summary = Object.fromEntries([...new Set(raw.samples.map((item) => item.target))].map((target) => {
    const rows = raw.samples.filter((item) => item.target === target)
    return [target, { count: rows.length, ttfbP95Ms: p95(rows.map((item) => item.ttfbMs)), readyP95Ms: p95(rows.map((item) => item.readyMs)), maxBodyBytes: Math.max(...rows.map((item) => item.bodyBytes)) }]
  }))
  writeFileSync(".local-stack/erp-3d-perf.json", JSON.stringify(raw, null, 2))
  process.stdout.write(`${JSON.stringify(raw.summary)}\n`)
} finally {
  for (const { context } of pages.values()) await context.close()
  await browser.close()
}
