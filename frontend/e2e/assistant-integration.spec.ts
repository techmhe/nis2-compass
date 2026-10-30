import type { Locator, Page } from "@playwright/test"
import { expect, expectPageOk, test } from "./fixtures"
import { authFile } from "./users"

// The floating assistant next to the product tour, the toasts, the work package bar and the writing help dialogs.
// The AI is mocked: /ai/status says ready, /ai/chat fails (for the toast) and writing help answers at once.
const STATUS = { ready: true, enabled: true, chat_model: "e2e-model", embedding_model: null, semantic_search: false, index: { chunks: 0, embedded: 0 } }
const SUGGESTION = "Evidence: the policy v2.1 was reviewed in March."

const launcher = (page: Page) => page.getByRole("button", { name: "Open assistant" })
const win = (page: Page) => page.getByRole("dialog", { name: "Assistant", exact: true })

async function mockAi(page: Page) {
  await page.route("**/api/ai/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STATUS) }))
  await page.route("**/api/ai/conversations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }))
}

async function boxOf(l: Locator) {
  await expect(l).toBeVisible()
  return (await l.boundingBox())!
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test.describe("assistant window with its neighbours", () => {
  test.use({ storageState: authFile("isb") })

  test("Take the tour closes the open window and the Assistant step points at the launcher", async ({ page }) => {
    await mockAi(page)
    await page.goto("/")
    await launcher(page).click()
    await expect(win(page)).toBeVisible()
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: "Take the tour" }).click()
    await expect(win(page)).toHaveCount(0)
    // The Assistant step is the sixth of the welcome chapter; each Next waits for the following step to show.
    const popover = page.getByRole("dialog").filter({ hasText: /Step \d+ of \d+/ })
    await expect(popover).toContainText("Step 1 of")
    for (let i = 1; i < 6; i++) {
      await popover.getByRole("button", { name: "Next", exact: true }).click()
      await expect(popover).toContainText(`Step ${i + 1} of`)
    }
    const step = page.getByRole("dialog", { name: "Ask the Assistant", exact: true })
    await expect(step).toBeVisible()
    await expect(step).toContainText("The Assistant in the bottom-right corner answers questions about your programme and the regulations, based on what you are allowed to see.")
    await expect(launcher(page)).toBeVisible()
    await expect(launcher(page)).toHaveAttribute("data-tour", "welcome.assistant")
    await expect(win(page)).toHaveCount(0)
  })

  test("the unsaved changes bar of a work package stays clear of the launcher", async ({ page }) => {
    await mockAi(page)
    await page.goto("/work-packages")
    await page.locator('a[href^="/work-packages/"]').first().click()
    await expectPageOk(page)
    const title = page.getByRole("textbox", { name: "Work package title" })
    await title.fill(`${await title.inputValue()} edited`)
    const bar = page.locator("div.fixed").filter({ hasText: "You have unsaved changes." })
    await expect(bar.getByRole("button", { name: "Save changes" })).toBeVisible()
    expect(overlaps(await boxOf(bar), await boxOf(launcher(page)))).toBe(false)
    // with the window open, compact or expanded, the bar moves left of it so Save and Discard stay reachable
    await launcher(page).click()
    await expect.poll(async () => overlaps(await boxOf(bar), await boxOf(win(page)))).toBe(false)
    await page.getByRole("button", { name: "Expand assistant" }).click()
    await expect.poll(async () => Math.round((await win(page).boundingBox())!.width)).toBe(760)
    await expect.poll(async () => overlaps(await boxOf(bar), await boxOf(win(page)))).toBe(false)
    await bar.getByRole("button", { name: "Discard changes" }).click()
    await expect(bar).toHaveCount(0)
  })

  test("workspace shortcuts work while the window is open, but not from inside it", async ({ page }) => {
    await mockAi(page)
    await page.goto("/assessments")
    await page.locator('a[href^="/assessments/"]').first().click()
    await expectPageOk(page)
    const rows = page.locator('[id^="ws-row-"]')
    // the row's own button; a row the user may edit also has a checkbox, which is a button too
    const rowButton = (row: Locator) => row.locator(":scope > button:not([role=checkbox])")
    const selectedRow = () => rows.filter({ has: page.locator('button[aria-current="true"]') }).getAttribute("id")
    await rowButton(rows.nth(0)).click()
    const first = await rows.nth(0).getAttribute("id")
    const second = await rows.nth(1).getAttribute("id")
    await expect.poll(selectedRow).toBe(first)
    await launcher(page).click()
    await expect(win(page)).toBeVisible()
    // J on a button inside the window does not move the selection
    await win(page).getByRole("button", { name: "Expand assistant" }).focus()
    await page.keyboard.press("j")
    await expect.poll(selectedRow).toBe(first)
    // with the focus back on the page, J moves it
    await rowButton(rows.nth(0)).focus()
    await page.keyboard.press("j")
    await expect.poll(selectedRow).toBe(second)
    await expect(win(page)).toBeVisible()
  })

  test("a toast does not overlap the compact or the expanded window", async ({ page }) => {
    await mockAi(page)
    await page.route("**/api/ai/chat", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "Assistant e2e failure" }) }))
    await page.goto("/")
    await launcher(page).click()
    const input = win(page).getByRole("textbox", { name: "Message to the assistant" })
    await input.fill("Hello")
    await input.press("Enter")
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Assistant e2e failure" })
    // compact: the toast stays at the right edge, above the window
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await toast.boundingBox())!.y + (await toast.boundingBox())!.height).toBeLessThanOrEqual((await win(page).boundingBox())!.y)
    await expect.poll(async () => overlaps((await toast.boundingBox())!, (await win(page).boundingBox())!)).toBe(false)
    await page.getByRole("button", { name: "Expand assistant" }).click()
    await expect.poll(async () => Math.round((await win(page).boundingBox())!.width)).toBe(760)
    await expect.poll(async () => overlaps((await toast.boundingBox())!, (await win(page).boundingBox())!)).toBe(false)
  })

  test("with the window expanded, writing help opens on top and Esc closes its dialog first", async ({ page }) => {
    await mockAi(page)
    await page.route("**/api/ai/assist/text", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: SUGGESTION, model: "e2e" }) }))
    await page.goto("/assessments")
    await page.locator('a[href^="/assessments/"]').first().click()
    await expectPageOk(page)
    await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
    await expect(page.getByRole("button", { name: /^Legal references \(\d+\)/ })).toBeVisible()
    await page.locator("#f-evidence").fill("evidance: polcy was reviewd")
    await launcher(page).click()
    await page.getByRole("button", { name: "Expand assistant" }).click()
    await expect.poll(async () => Math.round((await win(page).boundingBox())!.width)).toBe(760)
    // The expanded window may cover the button, so it is opened from the keyboard.
    const help = page.locator("#f-evidence").locator("..").getByRole("button", { name: "Writing help" })
    await help.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    const dialog = page.getByRole("dialog", { name: "Proofread" })
    await expect(dialog.getByText(SUGGESTION)).toBeVisible()
    const top = await dialog.evaluate((d) => {
      const r = d.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!hit && d.contains(hit)
    })
    expect(top).toBe(true)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(win(page)).toBeVisible()
  })
})
