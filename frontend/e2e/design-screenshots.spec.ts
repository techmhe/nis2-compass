import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { authFile } from "./users"

// Screenshot pack of the current UI for design work (not a regression test):
//   DESIGN_SCREENSHOTS=1 npx playwright test design-screenshots
// Writes full-page PNGs, light and dark, to docs/design/screenshots/<theme>/ (not committed).
test.skip(!process.env.DESIGN_SCREENSHOTS, "set DESIGN_SCREENSHOTS=1 to capture the design screenshot pack")
test.use({ storageState: authFile("isb") })

const OUT = path.join(process.cwd(), "..", "docs", "design", "screenshots")

type Screen = { name: string; path: string; then?: (page: Page) => Promise<void>; fullPage?: boolean }

const openFirst = (selector: string) => async (page: Page) => {
  await page.locator(selector).first().click()
}

const SCREENS: Screen[] = [
  { name: "01-dashboard", path: "/" },
  { name: "02-my-work", path: "/my-work" },
  { name: "03-assessments", path: "/assessments" },
  { name: "04-assessment-workspace", path: "/assessments", fullPage: false, then: async (page) => {
    await openFirst('a[href^="/assessments/"]')(page)
    await page.getByRole("region", { name: "Requirements" }).getByRole("button").nth(2).click()
  } },
  { name: "05-requirements-catalogue", path: "/catalog" },
  { name: "06-requirement-detail", path: "/catalog", then: openFirst('a[href^="/catalog/"]') },
  { name: "07-action-plan", path: "/action-plan" },
  { name: "08-action-plan-item-sheet", path: "/action-plan", fullPage: false, then: async (page) => {
    await page.locator("tbody tr").first().click()
  } },
  { name: "09-bundle-work-package-dialog", path: "/action-plan", fullPage: false, then: async (page) => {
    await page.getByRole("checkbox", { name: "Select AP-001" }).click()
    await page.getByRole("checkbox", { name: "Select AP-002" }).click()
    await page.getByRole("button", { name: /Bundle 2 into work package/ }).click()
  } },
  { name: "10-project-master-plan", path: "/projects/1" },
  { name: "11-work-packages", path: "/work-packages" },
  { name: "12-work-package-detail", path: "/work-packages", then: openFirst('a[href^="/work-packages/"]') },
  { name: "13-tasks-board", path: "/tasks", fullPage: false },
  { name: "14-documents", path: "/documents" },
  { name: "15-document-detail", path: "/documents", then: openFirst('a[href^="/documents/"]') },
  { name: "16-regulations-library", path: "/regulations", fullPage: false },
  { name: "17-incidents", path: "/incidents" },
  { name: "18-incident-detail", path: "/incidents", then: async (page) => {
    await page.getByText("Compromised VPN account", { exact: false }).first().click()
  } },
  { name: "19-incident-report-draft", path: "/incidents", fullPage: false, then: async (page) => {
    await page.getByText("Compromised VPN account", { exact: false }).first().click()
    await page.getByRole("button", { name: "Draft report" }).first().click()
  } },
  { name: "20-governance", path: "/governance" },
  { name: "21-audits-programme", path: "/audits/programme" },
  { name: "22-effectiveness-review", path: "/audits/effectiveness-reviews", fullPage: false, then: async (page) => {
    await page.getByText("chapters rated").first().click()
  } },
  { name: "23-management-reviews", path: "/audits/management-reviews" },
  { name: "24-risks", path: "/risks" },
  { name: "25-risk-detail", path: "/risks", then: openFirst('a[href^="/risks/"]') },
  { name: "26-controls-calendar", path: "/controls" },
  { name: "27-advisories", path: "/controls/advisories" },
  { name: "28-vulnerabilities", path: "/controls/vulnerabilities" },
  { name: "29-kpis", path: "/controls/kpis" },
  { name: "30-approvals", path: "/approvals" },
  { name: "31-suppliers", path: "/suppliers" },
  { name: "32-supplier-detail", path: "/suppliers", then: openFirst('a[href^="/suppliers/"]') },
  { name: "33-inventory", path: "/inventory" },
  { name: "34-reports", path: "/reports" },
  { name: "35-data-quality", path: "/checks" },
  { name: "36-assistant", path: "/assistant", fullPage: false },
  { name: "37-profile", path: "/profile" },
]

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("nis2-theme", t), theme)
    })

    for (const s of SCREENS) {
      test(s.name, async ({ page }) => {
        await page.goto(s.path)
        await page.waitForLoadState("networkidle")
        if (s.then) {
          await s.then(page)
          await page.waitForLoadState("networkidle")
        }
        await page.waitForTimeout(600) // charts and sheet animations settle
        await page.screenshot({ path: path.join(OUT, theme, `${s.name}.png`), fullPage: s.fullPage ?? true, animations: "disabled" })
        await expect(page.getByText("This page could not be displayed")).toHaveCount(0)
      })
    }

    test("00-login", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const page = await ctx.newPage()
      await page.addInitScript((t) => localStorage.setItem("nis2-theme", t), theme)
      await page.goto("/login")
      await page.waitForLoadState("networkidle")
      await page.screenshot({ path: path.join(OUT, theme, "00-login.png"), animations: "disabled" })
      await ctx.close()
    })
  })
}
