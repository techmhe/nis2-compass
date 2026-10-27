import { test as base, expect, type Locator, type Page } from "@playwright/test"

/** Every test fails on uncaught exceptions in the page (e.g. a crashed React tree). */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await use(errors)
    expect(errors, "uncaught errors in the page").toEqual([])
  }, { auto: true }],
})
export { expect }

/** The page rendered (its header, or `ready` for pages without one) and not the error boundary. */
export async function expectPageOk(page: Page, ready?: Locator) {
  await expect(ready ?? page.locator("main h1, h1").first()).toBeVisible()
  await expect(page.getByText("This page could not be displayed")).toHaveCount(0)
}

/** No horizontal scrolling of the whole page. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, "page is wider than the viewport").toBeLessThanOrEqual(1)
}

/** Nothing inside an open dialog sticks out of it (the grid overflow bug class). */
export async function expectDialogFits(dialog: Locator) {
  await expect(dialog).toBeVisible()
  const sticking = await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect()
    return [...d.querySelectorAll("*")]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right - r.right > 1 || r.left - b.left > 1) })
      .map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(" ").slice(0, 3).join(".")}`)
      .slice(0, 5)
  })
  expect(sticking, "elements outside the dialog").toEqual([])
}
