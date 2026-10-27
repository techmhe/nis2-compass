import { authFile } from "./users"
import { expect, test } from "./fixtures"

// React reports these mistakes on the console instead of throwing, so the page still renders and the other tests
// stay green. Duplicate keys can drop or duplicate list rows; a select that turns from uncontrolled to controlled
// can show a stale value.
const REACT_WARNINGS = /two children with the same key|changing from (un)?controlled to (un)?controlled/

test.use({ storageState: authFile("isb") })

// "/my-work" lists several report stages of the same incident; "/" and "/assessments" have a round select that
// has no value until the rounds are loaded.
for (const path of ["/", "/my-work", "/assessments"]) {
  test(`page ${path} renders without React key or controlled-input warnings`, async ({ page }) => {
    const warnings: string[] = []
    page.on("console", (m) => { if (REACT_WARNINGS.test(m.text())) warnings.push(m.text()) })
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main h1, h1").first()).toBeVisible()
    expect(warnings, "React warnings on the console").toEqual([])
  })
}
