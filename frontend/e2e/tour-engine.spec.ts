import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { signInFresh, storedTour, storeTour, createTourUser, signIn, changePassword, TOUR_PASSWORD } from "./tour-users"
import { authFile } from "./users"
import { TOUR_VERSION } from "../src/tour/state"
import { programme } from "../src/tour/chapters/programme"
import { risks } from "../src/tour/chapters/risks"
import { welcome } from "../src/tour/chapters/welcome"

const ENDED = "Tour ended. Restart it from Help any time."
const intro = (page: Page) => page.getByRole("dialog", { name: "Welcome to NIS2 Compass" })
const popover = (page: Page) => page.getByRole("dialog").filter({ hasText: /Step \d+ of \d+/ })

const toastEnded = (page: Page) => page.getByText(ENDED)
const gettingStarted = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Getting started" }) })
const DISMISSED = { version: TOUR_VERSION, status: "dismissed", chapters_done: [] }
// An administrator for one entity only: the Users section is hidden, so the step on its tab has no anchor.
const SCOPED_ADMIN = ["users.manage", "entities.manage", "entities.read", "audit.read"]

async function takeTourFromMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Take the tour" }).click()
}

async function nextInPopover(page: Page) {
  await popover(page).getByRole("button", { name: "Next", exact: true }).click()
}

/** Expects the steps with these titles in order and stops on the last one. */
async function stepThrough(page: Page, titles: string[]) {
  for (const [i, title] of titles.entries()) {
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible({ timeout: 20_000 })
    if (i < titles.length - 1) await nextInPopover(page)
  }
}
const titlesUpTo = (steps: { name: string; title: string }[], last: string, without: string[] = []) =>
  steps.slice(0, steps.findIndex((s) => s.name === last) + 1).filter((s) => !without.includes(s.name)).map((s) => s.title)

async function startTour(page: Page) {
  await page.goto("/")
  await expect(intro(page)).toBeVisible()
  await page.getByRole("button", { name: "Start tour" }).click()
  await expect(popover(page)).toBeVisible()
}

test.describe("tour engine", () => {
  test("starts on the Dashboard for a new user, once", async ({ page }) => {
    await signInFresh(page)
    await page.goto("/")
    await expect(intro(page)).toBeVisible()
    await expect(intro(page)).toContainText(/\d+ chapters?, about \d+ minutes?/)
    await expect.poll(() => storedTour(page)).toMatchObject({ version: 1, status: "started", chapters_done: [] })
    await page.reload()
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("Not now stores dismissed", async ({ page }) => {
    await signInFresh(page)
    await page.goto("/")
    await page.getByRole("button", { name: "Not now" }).click()
    await expect(page.getByText(ENDED)).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect.poll(() => storedTour(page)).toMatchObject({ status: "dismissed" })
  })

  test("Esc on the intro is Not now", async ({ page }) => {
    await signInFresh(page)
    await page.goto("/")
    await expect(intro(page)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByText(ENDED)).toBeVisible()
    await expect.poll(() => storedTour(page)).toMatchObject({ status: "dismissed" })
  })

  test("Start tour, two Next and End tour stores started", async ({ page }) => {
    await signInFresh(page)
    await startTour(page)
    await expect(popover(page)).toContainText("Step 1 of")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await expect(popover(page)).toContainText("Step 3 of")
    await page.getByRole("button", { name: "End tour" }).click()
    await expect(page.getByText(ENDED)).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect.poll(() => storedTour(page)).toMatchObject({ status: "started" })
  })

  test("the popover is a dialog named by the step title and the intro does not count", async ({ page }) => {
    await signInFresh(page)
    await startTour(page)
    const d = page.getByRole("dialog", { name: "Find your way around" })
    await expect(d).toBeVisible()
    await expect(d).toContainText("Step 1 of")
    await expect(d).toHaveAccessibleDescription(/sidebar groups the work/)
    await expect(d).toBeFocused()
  })

  test("arrow keys, Enter and Esc", async ({ page }) => {
    await signInFresh(page)
    await startTour(page)
    await page.keyboard.press("ArrowRight")
    await expect(popover(page)).toContainText("Step 2 of")
    await page.keyboard.press("Enter")
    await expect(popover(page)).toContainText("Step 3 of")
    await page.keyboard.press("ArrowLeft")
    await expect(popover(page)).toContainText("Step 2 of")
    await page.keyboard.press("Escape")
    await expect(page.getByText(ENDED)).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("clicking the dimmed area changes nothing", async ({ page }) => {
    await signInFresh(page)
    await startTour(page)
    await page.mouse.click(1100, 500)
    await expect(popover(page)).toContainText("Step 1 of")
    await expect(page).toHaveURL(/\/$/)
  })

  test("the Assistant step is skipped without ai.use and the count excludes it", async ({ page }) => {
    await signInFresh(page, { permissions: ["entities.read", "assessments.read"] })
    await startTour(page)
    await expect(popover(page)).toContainText("Step 1 of 8")
    for (let i = 0; i < 7; i++) {
      await expect(page.getByRole("dialog", { name: "Ask the Assistant" })).toHaveCount(0)
      await page.getByRole("button", { name: "Next" }).click()
    }
    await expect(page.getByRole("dialog", { name: "Help and restarting the tour" })).toContainText("Step 8 of 8")
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible()
  })

  test("a user with ai.use sees the Assistant step", async ({ page }) => {
    // Only the welcome chapter is recommended for this role, so the run has its 9 steps.
    await signInFresh(page, { permissions: ["entities.read", "assessments.read", "ai.use"] })
    await startTour(page)
    await expect(popover(page)).toContainText("Step 1 of 9")
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByRole("dialog", { name: "Ask the Assistant" })).toBeVisible()
  })

  test("a deep link does not start the tour, the next Dashboard load does", async ({ page }) => {
    const user = await createTourUser({ role: "contributor" })
    await page.goto("/login?next=/my-work")
    await page.getByLabel("E-mail").fill(user.email)
    await page.getByLabel("Password").fill(user.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    // The forced password change comes first; do it through the API, then continue to the deep link.
    await expect(page).toHaveURL(/force=1/)
    await changePassword(page, user)
    await page.goto("/my-work")
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(await storedTour(page)).toBeUndefined()
    await page.goto("/")
    await expect(intro(page)).toBeVisible()
  })

  test("a pending password change blocks the start until it is done", async ({ page }) => {
    const user = await createTourUser({ role: "contributor" })
    await signIn(page, user)
    await page.goto("/")
    await expect(page).toHaveURL(/\/profile\?force=1/)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByLabel("Current password").fill(user.password)
    await page.getByLabel("New password", { exact: true }).fill(TOUR_PASSWORD)
    await page.getByLabel("Repeat new password").fill(TOUR_PASSWORD)
    await page.getByRole("button", { name: "Change password" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(intro(page)).toBeVisible()
  })

  test("clicking the highlighted sidebar navigates and ends the tour", async ({ page }) => {
    await signInFresh(page)
    await startTour(page)
    await page.getByRole("navigation").getByRole("link", { name: "Tasks" }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByText(ENDED)).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect.poll(() => storedTour(page)).toMatchObject({ status: "started" })
  })

  test("a collapsed sidebar still shows the sidebar steps", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nis2-sidebar", "1"))
    await signInFresh(page)
    await startTour(page)
    await expect(page.getByRole("dialog", { name: "Find your way around" })).toBeVisible()
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByRole("dialog", { name: "Tasks" })).toBeVisible()
  })

  test("in dark mode the popover uses the surface token", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nis2-theme", "dark"))
    await signInFresh(page)
    await startTour(page)
    await expect(page.locator("html")).toHaveClass(/dark/)
    const popoverBg = await popover(page).evaluate((el) => getComputedStyle(el).backgroundColor)
    const surface = await page.evaluate(() => {
      const probe = document.createElement("div")
      probe.style.backgroundColor = "var(--surface)"
      document.body.append(probe)
      const c = getComputedStyle(probe).backgroundColor
      probe.remove()
      return c
    })
    expect(popoverBg).toBe(surface)
  })

  test("Take the tour on the Help page goes to the Dashboard and keeps running", async ({ page }) => {
    await signInFresh(page)
    await storeTour(page, DISMISSED)
    await page.goto("/help")
    await gettingStarted(page).getByRole("button", { name: "Take the tour" }).click()
    await expect(page.getByRole("dialog", { name: "Find your way around" })).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(popover(page)).toContainText("Step 1 of")
    await expect(toastEnded(page)).toHaveCount(0)
    await nextInPopover(page)
    await expect(popover(page)).toContainText("Step 2 of")
  })

  test("Take the tour in the account menu away from the Dashboard keeps running", async ({ page }) => {
    await signInFresh(page)
    await storeTour(page, DISMISSED)
    await page.goto("/my-work")
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible()
    await takeTourFromMenu(page)
    await expect(page.getByRole("dialog", { name: "Find your way around" })).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/$/)
    await page.waitForLoadState("networkidle")
    await expect(popover(page)).toContainText("Step 1 of")
    await expect(toastEnded(page)).toHaveCount(0)
    await expect.poll(() => storedTour(page)).toMatchObject({ status: "dismissed" })
  })

  test("a missing anchor is skipped and the counter shrinks", async ({ page }) => {
    test.slow()
    await signInFresh(page, { permissions: SCOPED_ADMIN, scoped: true })
    await storeTour(page, DISMISSED)
    await page.goto("/")
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await takeTourFromMenu(page)
    const titles: string[] = []
    const counters: string[] = []
    for (;;) {
      await expect(popover(page)).toBeVisible({ timeout: 20_000 })
      titles.push((await popover(page).getByRole("heading", { level: 2 }).textContent()) ?? "")
      counters.push(/Step \d+ of \d+/.exec((await popover(page).textContent()) ?? "")?.[0] ?? "")
      const done = popover(page).getByRole("button", { name: "Done", exact: true })
      if (await done.isVisible()) {
        await done.click()
        break
      }
      await nextInPopover(page)
      await expect(popover(page).getByRole("heading", { level: 2 })).not.toHaveText(titles.at(-1)!, { timeout: 20_000 })
    }
    expect(titles).not.toContain("Users and their roles")
    expect(titles).toContain("Companies of the group")
    const planned = Number(/of (\d+)/.exec(counters[0])?.[1])
    expect(titles).toHaveLength(planned - 1)
    expect(counters.at(-1)).toBe(`Step ${planned - 1} of ${planned - 1}`)
  })

  test("the back button while a step is being located ends the tour and stays there", async ({ page }) => {
    test.slow()
    await signInFresh(page, { permissions: SCOPED_ADMIN, scoped: true })
    await storeTour(page, DISMISSED)
    await page.goto("/")
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await takeTourFromMenu(page)
    await stepThrough(page, titlesUpTo(welcome.steps, "help", ["assistant"]))
    // The next step (Users) has no anchor for this user, so the engine waits for it on the Administration page.
    await nextInPopover(page)
    await expect(page).toHaveURL(/\/admin\//)
    await expect(popover(page)).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/my-work$/)
    await expect(toastEnded(page)).toBeVisible()
    // Past the anchor wait: the skipped step must not pull the user back into the tour.
    await page.waitForTimeout(6_000)
    await expect(page).toHaveURL(/\/my-work$/)
    await expect(popover(page)).toHaveCount(0)
  })
})

test.describe("tour engine: security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("Next and Back across governance tabs keep the tour running", async ({ page }) => {
    await page.goto("/help")
    await gettingStarted(page).getByRole("tabpanel").getByRole("button", { name: "Show me: Steer the programme" }).click()
    const legal = page.getByRole("dialog", { name: "Legal basis per jurisdiction" })
    await stepThrough(page, titlesUpTo(programme.steps, "legal"))
    await expect(page).toHaveURL(/\/governance\/legal$/)
    await nextInPopover(page)
    await expect(page.getByRole("dialog", { name: "Registrations with authorities" })).toBeVisible()
    await expect(page).toHaveURL(/\/governance\/registrations$/)
    await popover(page).getByRole("button", { name: "Back", exact: true }).click()
    await expect(legal).toBeVisible()
    await expect(page).toHaveURL(/\/governance\/legal$/)
    await nextInPopover(page)
    await expect(page.getByRole("dialog", { name: "Registrations with authorities" })).toBeVisible()
    await nextInPopover(page)
    await expect(page.getByRole("dialog", { name: "The management body" })).toBeVisible()
    await expect(page).toHaveURL(/\/governance\/management$/)
    await page.waitForLoadState("networkidle")
    await expect(popover(page)).toBeVisible()
    await expect(toastEnded(page)).toHaveCount(0)
  })

  test("clicking a highlighted dialog trigger ends the tour and the dialog works", async ({ page }) => {
    await page.goto("/help")
    await gettingStarted(page).getByRole("tabpanel").getByRole("button", { name: "Show me: Manage risks" }).click()
    await stepThrough(page, titlesUpTo(risks.steps, "new"))
    await page.locator('[data-tour~="risks.new"]').click()
    await expect(toastEnded(page)).toBeVisible()
    await expect(popover(page)).toHaveCount(0)
    const dialog = page.getByRole("dialog", { name: "New risk", exact: true })
    await expect(dialog).toBeVisible()
    // A click lands on the dialog, not on a veil above it.
    await dialog.getByLabel("Title").click()
    await page.keyboard.type("Tour check")
    await expect(dialog.getByLabel("Title")).toHaveValue("Tour check")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})
