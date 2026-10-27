import { authFile } from "./users"
import { expectNoHorizontalOverflow, expectPageOk, test } from "./fixtures"

// Every main page renders for the security officer, without crash, error boundary or horizontal overflow.
const PAGES = [
  "/", "/my-work", "/assessments", "/projects/1", "/catalog", "/action-plan", "/work-packages", "/tasks", "/documents",
  "/regulations", "/incidents", "/governance", "/audits", "/audits/findings", "/audits/effectiveness-reviews",
  "/audits/management-reviews", "/risks", "/controls", "/controls/advisories", "/controls/vulnerabilities",
  "/controls/kpis", "/approvals", "/suppliers", "/inventory", "/reports", "/checks", "/assistant", "/profile",
  "/help",
]

test.use({ storageState: authFile("isb") })

for (const path of PAGES) {
  test(`page ${path} renders`, async ({ page }) => {
    await page.goto(path)
    await expectPageOk(page, path === "/assistant" ? page.getByRole("textbox").first() : undefined)
    await page.waitForLoadState("networkidle")
    await expectPageOk(page, path === "/assistant" ? page.getByRole("textbox").first() : undefined)  // again with data loaded
    await expectNoHorizontalOverflow(page)
  })
}

test("admin pages render for the administrator", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("admin") })
  const page = await ctx.newPage()
  for (const path of ["/admin", "/admin/system"]) {
    await page.goto(path)
    await expectPageOk(page)
  }
  await ctx.close()
})
