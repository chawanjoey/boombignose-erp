import { defineConfig, devices } from "@playwright/test"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8")) as { root: string; project: string; app: number; api: number; db: number }
const root = realpathSync(process.cwd())
const lane = isolation.app - 3100
const expectedProject = `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`
if (isolation.root !== root || isolation.project !== expectedProject || lane < 1 || lane > 6 || isolation.api !== 55000 + lane * 100 + 1 || isolation.db !== isolation.api + 1) throw new Error("Playwright requires this worktree's isolated lane")

const baseURL = `http://127.0.0.1:${isolation.app}`
const localEnv = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
if (localEnv.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}` || localEnv.NEXT_PUBLIC_APP_URL !== baseURL || !localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || !localEnv.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Playwright local environment does not match isolation metadata")
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"]) process.env[name] = localEnv[name]
if (process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL !== baseURL) throw new Error("Untrusted Playwright origin")

export default defineConfig({
  testDir: "./e2e-erp-3d",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: ".local-stack/erp-3d-playwright-report", open: "never" }]],
  outputDir: ".local-stack/erp-3d-test-results",
  use: { baseURL, trace: "retain-on-failure", launchOptions: { executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH } },
  projects: [{ name: "erp-3d-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${isolation.app}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: { ...localEnv, OPENROUTER_API_KEY: "", RESEND_API_KEY: "", N8N_OUTBOUND_URL: "" },
    timeout: 120_000,
  },
})
