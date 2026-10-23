import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, realpathSync } from "node:fs"
import { chromium } from "@playwright/test"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const root = realpathSync(process.cwd())
const lane = isolation.app - 3100
if (isolation.root !== root || isolation.project !== `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`) throw new Error("Wrong isolated worktree")
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
const baseURL = `http://127.0.0.1:${isolation.app}`
if (env.NEXT_PUBLIC_APP_URL !== baseURL || env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Wrong local environment")

const videoDir = ".local-stack/erp-3d-video"
mkdirSync(videoDir, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH })
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } })
const page = await context.newPage()
try {
  await page.goto("/login")
  await page.getByLabel("Email").fill("demo@boombignose.org")
  await page.getByLabel("Password").fill("BoomDemo123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
  await page.goto("/erp-3d")
  await page.getByTestId("erp3d-root").waitFor()
  await page.waitForTimeout(3500)
  for (const kind of ["deal", "project", "invoice", "task"]) {
    await page.getByTestId(`erp3d-${kind}-collection`).locator("button").first().click()
    await page.getByTestId("erp3d-detail").waitFor()
    await page.waitForTimeout(3500)
  }
  await page.getByTestId("erp3d-reload").click()
  await page.getByTestId("erp3d-root").waitFor()
  await page.waitForTimeout(3500)
  await page.getByTestId("erp3d-task-collection").locator("button").first().focus()
  await page.keyboard.press("Enter")
  await page.waitForTimeout(3500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(7000)
  const video = page.video()
  await context.close()
  if (!video) throw new Error("No browser video")
  execFileSync("ffmpeg", ["-y", "-i", await video.path(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ".local-stack/erp-3d-review.mp4"], { stdio: "ignore" })
  process.stdout.write("Recorded .local-stack/erp-3d-review.mp4\n")
} finally {
  await browser.close()
}
