import { authFile } from "./users"
import { expect, expectDialogFits, expectPageOk, test } from "./fixtures"

test.describe("as security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("assessment answers save automatically and survive a reload", async ({ page }) => {
    await page.goto("/assessments")
    await page.locator('a[href^="/assessments/"]').first().click()
    await expectPageOk(page)
    await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
    const notes = page.locator("#f-notes")
    const text = `e2e note ${Date.now()}`
    await notes.fill(text)
    await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible()
    await page.reload()
    await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
    await expect(page.locator("#f-notes")).toHaveValue(text)
  })

  test("action plan items can be bundled into a pre-filled work package", async ({ page }) => {
    await page.goto("/action-plan")
    await page.getByRole("checkbox", { name: "Select AP-001" }).click()
    await page.getByRole("checkbox", { name: "Select AP-002" }).click()
    await page.getByRole("button", { name: "Bundle 2 into work package" }).click()
    const dialog = page.getByRole("dialog", { name: "New work package" })
    await expectDialogFits(dialog)
    await expect(dialog.getByRole("textbox").first()).not.toHaveValue("")
    await expect(dialog.getByText("AP-001")).toBeVisible()
  })

  test("an incident report draft is pre-filled from the incident", async ({ page }) => {
    await page.goto("/incidents")
    await page.getByText("Compromised VPN account", { exact: false }).first().click()
    await expectPageOk(page)
    await page.getByRole("button", { name: "Draft report" }).first().click()
    const dialog = page.getByRole("dialog")
    await expectDialogFits(dialog)
    await expect(dialog.getByRole("textbox").first()).not.toHaveValue("")
    await expect(dialog.getByRole("button", { name: "Copy all" })).toBeEnabled()
  })

  test("the asset picker offers inventory assets", async ({ page }) => {
    await page.goto("/controls/advisories")
    await page.getByRole("button", { name: "Log advisory" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Add asset" }).click()
    await expect(page.getByRole("option").first()).toBeVisible()
    await expect(page.getByText("No asset found.")).toHaveCount(0)
  })

  test("dialogs fit their content", async ({ page }) => {
    const open = async (path: string, button: string | RegExp) => {
      await page.goto(path)
      await page.getByRole("button", { name: button }).first().click()
      await expectDialogFits(page.getByRole("dialog"))
      await page.keyboard.press("Escape")
    }
    await open("/controls/advisories", "Log advisory")
    await open("/controls/vulnerabilities", /Log vulnerability/)
    await open("/controls/kpis", "Import values")
    await open("/audits/programme", "New audit")
    await open("/work-packages", /New work package/)
    await page.goto("/risks")
    await page.locator('a[href^="/risks/"]').first().click()
    await page.getByRole("button", { name: "Link object" }).click()
    await expectDialogFits(page.getByRole("dialog"))
  })
})

test.describe("entity scoping and read-only access", () => {
  test("the Dutch contact only sees the Dutch entities' assessments", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("nl") })
    const page = await ctx.newPage()
    await page.goto("/assessments")
    await expectPageOk(page)
    const links = page.locator('a[href^="/assessments/"]')
    await expect(links.first()).toBeVisible()
    const texts = await links.allInnerTexts()
    expect(texts.join(" ")).not.toMatch(/\bPG\b|\bPGP\b/)
    await ctx.close()
  })

  test("the read-only viewer cannot change the action plan", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("viewer") })
    const page = await ctx.newPage()
    await page.goto("/action-plan")
    await expectPageOk(page)
    await expect(page.getByRole("button", { name: "New item" })).toHaveCount(0)
    await expect(page.getByRole("checkbox", { name: "Select AP-001" })).toHaveCount(0)
    await ctx.close()
  })
})
