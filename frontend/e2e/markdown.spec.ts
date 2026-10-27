import { authFile } from "./users"
import { expect, expectPageOk, test } from "./fixtures"

test.use({ storageState: authFile("isb") })

test("user Markdown renders links but never images", async ({ page }) => {
  await page.goto("/assessments")
  await page.locator('a[href^="/assessments/"]').first().click()
  await expectPageOk(page)
  await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
  await page.getByRole("tab", { name: /Comments/ }).click()
  const marker = `md-${Date.now()}`
  await page.getByPlaceholder(/Write a comment/).fill(`${marker} ![pixel](/api/health) [docs](https://example.com)`)
  await page.getByRole("button", { name: "Add comment" }).click()
  const comment = page.locator(".prose-md").filter({ hasText: marker })
  await expect(comment).toBeVisible()
  await expect(comment.getByRole("link", { name: "docs" })).toHaveAttribute("href", "https://example.com")
  await expect(comment.locator("img")).toHaveCount(0)
})
