import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { signInFresh, storedTour } from "./tour-users"
import { authFile } from "./users"
import { CHAPTERS } from "../src/tour/chapters"
import { admin } from "../src/tour/chapters/admin"
import { audits } from "../src/tour/chapters/audits"
import { controls } from "../src/tour/chapters/controls"
import { documents } from "../src/tour/chapters/documents"
import { incidents } from "../src/tour/chapters/incidents"
import { inventory } from "../src/tour/chapters/inventory"
import { risks } from "../src/tour/chapters/risks"
import { suppliers } from "../src/tour/chapters/suppliers"
import type { TourChapter } from "../src/tour/types"

const MODULE_CHAPTERS = [risks, controls, audits, incidents, suppliers, inventory, documents]
const ALL_CHAPTERS = Object.values(CHAPTERS) as TourChapter[]
const popover = (page: Page) => page.getByRole("dialog").filter({ hasText: /Step \d+ of \d+/ })

/** Starts the recommended tour from the user menu (after dismissing the automatic one) and walks it to "Done". */
async function walkToDone(page: Page): Promise<string[]> {
  // A full walk visits dozens of steps on many pages.
  test.slow()
  const stored = (await storedTour(page)) as { version?: number } | undefined
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  if (!stored || (stored.version ?? 0) < 1) {
    await page.getByRole("dialog", { name: "Welcome to NIS2 Compass" }).getByRole("button", { name: "Not now" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Take the tour" }).click()

  const shown: string[] = []
  for (;;) {
    await expect(popover(page)).toBeVisible({ timeout: 20_000 })
    const title = (await popover(page).getByRole("heading", { level: 2 }).textContent()) ?? ""
    shown.push(title)
    const chapter = ALL_CHAPTERS.find((c) => c.steps.some((s) => s.title === title))
    const step = chapter?.steps.find((s) => s.title === title)
    if (chapter && step) {
      // The highlighted element is on screen and the step did not land on a missing or forbidden page.
      await expect(page.locator(`[data-tour~="${chapter.id}.${step.name}"]:visible`).first()).toBeInViewport()
      await expect(page.getByText("This page does not exist.")).toHaveCount(0)
      await expect(page.getByText("You do not have permission")).toHaveCount(0)
      await expect(page.getByText("This page could not be displayed")).toHaveCount(0)
    }
    // Scoped to the popover: pages have their own buttons named like "Next requirement (J)".
    const done = popover(page).getByRole("button", { name: "Done", exact: true })
    if (await done.isVisible()) {
      await done.click()
      break
    }
    await popover(page).getByRole("button", { name: "Next", exact: true }).click()
  }
  await expect(page.getByRole("dialog")).toHaveCount(0)
  return shown
}

function expectChapter(shown: string[], chapter: TourChapter, skipped: string[] = []) {
  const wanted = chapter.steps.filter((s) => !skipped.includes(s.name)).map((s) => s.title)
  expect(shown.filter((t) => chapter.steps.some((s) => s.title === t))).toEqual(wanted)
}

test.describe("module chapters: content rules", () => {
  test("titles have at most 6 words, bodies at most 2 sentences, 4 to 10 steps", () => {
    for (const c of MODULE_CHAPTERS) {
      expect(c.steps.length, c.id).toBeGreaterThanOrEqual(4)
      expect(c.steps.length, c.id).toBeLessThanOrEqual(10)
      for (const s of c.steps) {
        expect(s.title.split(/\s+/).length, `${c.id}.${s.name} title`).toBeLessThanOrEqual(6)
        expect(s.body.split(/(?<=[.!?])\s+/).length, `${c.id}.${s.name} body`).toBeLessThanOrEqual(2)
      }
    }
  })
})

test.describe("module chapters: security officer", () => {
  test.use({ storageState: authFile("isb") })
  test("walks every module chapter of the full tour", async ({ page }) => {
    const shown = await walkToDone(page)
    for (const c of MODULE_CHAPTERS) expectChapter(shown, c)
    // The security officer holds neither roles.manage nor settings.manage.
    expectChapter(shown, admin, ["roles", "sso", "system"])
    // The chapters come in the order of the specification.
    const first = (c: TourChapter) => shown.indexOf(c.steps[0].title)
    const order = MODULE_CHAPTERS.map(first)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

test.describe("module chapters: viewer", () => {
  test.use({ storageState: authFile("viewer") })
  test("walks documents without the upload step", async ({ page }) => {
    expectChapter(await walkToDone(page), documents, ["upload"])
  })
})

test("an auditor walks audits and documents", async ({ page }) => {
  await signInFresh(page, { role: "auditor" })
  const shown = await walkToDone(page)
  expectChapter(shown, audits)
  expectChapter(shown, documents, ["upload"])
})

test("an assessor walks risks and incidents with the incident deadline step", async ({ page }) => {
  await signInFresh(page, { role: "assessor" })
  const shown = await walkToDone(page)
  expectChapter(shown, risks)
  expectChapter(shown, incidents)
  expect(shown).toContain(incidents.steps.find((s) => s.name === "deadlines")?.title)
})
