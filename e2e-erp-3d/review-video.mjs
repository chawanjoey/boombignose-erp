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
  const host = page.getByTestId("erp3d-scene")
  await host.locator("canvas").waitFor()
  await page.waitForTimeout(2500)
  let bounds = await host.locator("canvas").boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.55, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(2500)
  await page.getByRole("button", { name: "Reset view" }).click()
  await page.waitForTimeout(1500)
  for (const kind of ["deal", "project", "invoice", "task"]) {
    const targets = JSON.parse(await host.getAttribute("data-pick-targets"))
    const target = targets.find((item) => item.key.startsWith(`${kind}:`))
    bounds = await host.locator("canvas").boundingBox()
    await page.mouse.click(bounds.x + bounds.width * target.x, bounds.y + bounds.height * target.y)
    await page.getByTestId("erp3d-detail").waitFor()
    await page.waitForTimeout(3000)
  }
  await page.getByTestId("erp3d-task-collection").locator("button").first().focus()
  await page.keyboard.press("Enter")
  await page.waitForTimeout(2500)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(1500)
  await host.locator("canvas").evaluate((canvas) => canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext())
  await page.getByRole("button", { name: "Try 3D map again" }).waitFor()
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: "Try 3D map again" }).click()
  await host.locator("canvas").waitFor()
  await page.waitForTimeout(4000)
  const video = page.video()
  await context.close()
  if (!video) throw new Error("No browser video")
  execFileSync("ffmpeg", ["-y", "-i", await video.path(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ".local-stack/erp-3d-review.mp4"], { stdio: "ignore" })
  process.stdout.write("Recorded .local-stack/erp-3d-review.mp4\n")
} finally {
  await browser.close()
}
