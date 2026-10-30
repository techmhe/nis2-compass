import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { signInFresh, storedTour } from "./tour-users"
import { authFile } from "./users"
import { admin } from "../src/tour/chapters/admin"
import { answer } from "../src/tour/chapters/answer"
import { assess } from "../src/tour/chapters/assess"
import { programme } from "../src/tour/chapters/programme"
import { projectChapter } from "../src/tour/chapters/project"
import { quality } from "../src/tour/chapters/quality"
import type { TourChapter } from "../src/tour/types"

const WORK_CHAPTERS = [answer, assess, programme, projectChapter, quality, admin]
const popover = (page: Page) => page.getByRole("dialog").filter({ hasText: /Step \d+ of \d+/ })

/** Starts the recommended tour from the user menu (after dismissing the automatic one) and walks it to "Done". */
async function walkToDone(page: Page, chapter: TourChapter): Promise<string[]> {
  // A walk visits every recommended step (up to 44 for the security officer) on many pages.
  test.slow()
  // Without a stored tour state the Dashboard starts the tour on its own once it has loaded; wait for it and dismiss it.
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
    const step = chapter.steps.find((s) => s.title === title)
    if (step) {
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

test.describe("work chapters: content rules", () => {
  test("titles have at most 6 words, bodies at most 2 sentences, 4 to 10 steps", () => {
    for (const c of WORK_CHAPTERS) {
      expect(c.steps.length, c.id).toBeGreaterThanOrEqual(4)
      expect(c.steps.length, c.id).toBeLessThanOrEqual(10)
      for (const s of c.steps) {
        expect(s.title.split(/\s+/).length, `${c.id}.${s.name} title`).toBeLessThanOrEqual(6)
        expect(s.body.split(/(?<=[.!?])\s+/).length, `${c.id}.${s.name} body`).toBeLessThanOrEqual(2)
      }
    }
  })
})

test.describe("work chapters: fresh users with the recommending role", () => {
  test("contributor walks answer", async ({ page }) => {
    await signInFresh(page, { role: "contributor" })
    expectChapter(await walkToDone(page, answer), answer)
  })

  test("assessor walks assess", async ({ page }) => {
    await signInFresh(page, { role: "assessor" })
    expectChapter(await walkToDone(page, assess), assess)
  })

  test("project manager walks project and quality", async ({ page }) => {
    await signInFresh(page, { role: "project_manager" })
    const shown = await walkToDone(page, projectChapter)
    expectChapter(shown, projectChapter)
    expectChapter(shown, quality)
  })
})

test.describe("work chapters: demo users", () => {
  test.describe("security officer", () => {
    test.use({ storageState: authFile("isb") })
    test("walks programme", async ({ page }) => {
      expectChapter(await walkToDone(page, programme), programme)
    })
  })

  test.describe("administrator", () => {
    test.use({ storageState: authFile("admin") })
    test("walks admin", async ({ page }) => {
      expectChapter(await walkToDone(page, admin), admin)
    })
  })

  test.describe("entity-scoped contributor", () => {
    test.use({ storageState: authFile("nl") })
    test("walks answer on an assessment of their own entity", async ({ page }) => {
      expectChapter(await walkToDone(page, answer), answer)
    })
  })
})

test("an administrator without roles.manage and settings.manage skips those steps", async ({ page }) => {
  await signInFresh(page, { permissions: ["users.manage", "entities.manage", "entities.read", "audit.read"] })
  expectChapter(await walkToDone(page, admin), admin, ["roles", "sso", "system"])
})

test.describe("anchor wrappers in grids", () => {
  test.use({ storageState: authFile("isb") })
  // A tour anchor wraps a Section that is a grid item; the Section must still stretch to the row like its neighbour.
  const box = async (page: Page, title: string) => {
    const b = await page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first().boundingBox()
    if (!b) throw new Error(`no section ${title}`)
    return b
  }

  test("Dashboard: Largest gaps to target is as tall as Answer distribution", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Largest gaps to target" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Answer distribution (Implemented)" })).toBeVisible()
    const a = await box(page, "Largest gaps to target")
    const b = await box(page, "Answer distribution (Implemented)")
    expect(Math.abs(a.y + a.height - (b.y + b.height))).toBeLessThanOrEqual(1)
  })

  test("Risks: the Heat map ends where the Residual risk overview ends", async ({ page }) => {
    await page.goto("/risks")
    await expect(page.getByRole("heading", { name: "Heat map" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Residual risk overview" })).toBeVisible()
    const a = await box(page, "Heat map")
    const b = await box(page, "Residual risk overview")
    expect(Math.abs(a.y + a.height - (b.y + b.height))).toBeLessThanOrEqual(1)
  })
})
