import { authFile } from "./users"
import { expect, expectPageOk, test } from "./fixtures"

test.use({ storageState: authFile("viewer") })

test("the help page carries the disclaimer for every user", async ({ page }) => {
  await page.goto("/help")
  await expectPageOk(page)
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Disclaimer" }) })
  await expect(section).toBeVisible()
  await expect(section).toContainText("provided as is")
  await expect(section).toContainText("AI coding assistants")
  await expect(section).toContainText("not legal advice")
  await expect(section).toContainText("assistant can be wrong")
})
