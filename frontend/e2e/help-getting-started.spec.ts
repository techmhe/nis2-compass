import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { signInFresh } from "./tour-users"
import { authFile } from "./users"
import { risks } from "../src/tour/chapters/risks"
import { TOUR_VERSION } from "../src/tour/state"

const ROLE_TABS = [
  "Information Security Officer", "Administrator", "Project Manager", "Assessor", "Contributor", "Viewer", "Auditor",
]
const section = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Getting started" }) })
const popover = (page: Page) => page.getByRole("dialog").filter({ hasText: /Step \d+ of \d+/ })
const seen = (page: Page) => section(page).getByRole("heading", { name: "Chapters you have seen" }).locator("xpath=..")

test.describe("security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("Getting started comes first with one tab per role and the own role selected", async ({ page }) => {
    await page.goto("/help")
    await expect(page.locator("section h2").first()).toHaveText("Getting started")
    await expect(section(page).getByRole("button", { name: "Take the tour" })).toBeVisible()
    await expect(section(page).getByRole("tab")).toHaveText(ROLE_TABS)
    await expect(section(page).getByRole("tab", { name: "Information Security Officer" })).toHaveAttribute("aria-selected", "true")
    const panel = section(page).getByRole("tabpanel")
    for (const heading of ["What you do", "Your typical work", "Pages you will use"]) {
      await expect(panel.getByRole("heading", { name: heading })).toBeVisible()
    }
    await expect(panel.getByRole("link", { name: "Action plan" })).toBeVisible()
    await expect(panel.getByRole("button", { name: /^Show me/ }).first()).toBeEnabled()
  })

  test("Show me starts just that chapter", async ({ page }) => {
    await page.goto("/help")
    await section(page).getByRole("tabpanel").getByRole("button", { name: `Show me: ${risks.title}` }).click()
    await expect(popover(page)).toBeVisible({ timeout: 20_000 })
    await expect(popover(page).getByRole("heading", { level: 2 })).toHaveText(risks.steps[0].title)
    const total = Number(/Step 1 of (\d+)/.exec((await popover(page).textContent()) ?? "")?.[1])
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(risks.steps.length)
  })
})

test.describe("contributor", () => {
  test.use({ storageState: authFile("nl") })

  test("the own tab is selected and what the role cannot use is disabled or plain text", async ({ page }) => {
    await page.goto("/help")
    await expect(section(page).getByRole("tab", { name: "Contributor" })).toHaveAttribute("aria-selected", "true")
    await section(page).getByRole("tab", { name: "Administrator" }).click()
    const panel = section(page).getByRole("tabpanel")
    await expect(panel.getByRole("button", { name: /^Show me: Administer the system/ })).toBeDisabled()
    await expect(panel.getByText("Needs the Administrator role")).toBeVisible()
    await expect(panel.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)
    await expect(panel.getByText("Users", { exact: true })).toBeVisible()
    await expect(panel.getByRole("link", { name: "Administration" })).toBeVisible()
  })
})

test.describe("chapters you have seen", () => {
  test("lists a completed chapter after a run", async ({ page }) => {
    test.slow()
    await signInFresh(page, { role: "contributor" })
    await page.goto("/help")
    await expect(seen(page)).toContainText("None yet")
    await section(page).getByRole("tabpanel").getByRole("button", { name: "Show me: Welcome" }).click()
    for (;;) {
      await expect(popover(page)).toBeVisible({ timeout: 20_000 })
      const done = popover(page).getByRole("button", { name: "Done", exact: true })
      if (await done.isVisible()) {
        await done.click()
        break
      }
      await popover(page).getByRole("button", { name: "Next", exact: true }).click()
    }
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.goto("/help")
    await expect(seen(page).getByRole("listitem")).toHaveText(["Welcome"])
  })

  test("ignores a stored chapter id it does not know", async ({ page }) => {
    await signInFresh(page, { role: "contributor" })
    const csrf = (await page.context().cookies()).find((c) => c.name.endsWith("nis2_csrf"))?.value ?? ""
    const r = await page.request.patch("/api/auth/me", {
      headers: { "X-CSRF-Token": csrf },
      data: { preferences: { tour: { version: 1, status: "started", chapters_done: ["answer", "retired-chapter"] } } },
    })
    expect(r.ok()).toBeTruthy()
    await page.goto("/help")
    await expect(seen(page).getByRole("listitem")).toHaveText(["Answer your questions"])
  })

  test("ignores chapters stored for another tour version", async ({ page }) => {
    await signInFresh(page, { role: "contributor" })
    const csrf = (await page.context().cookies()).find((c) => c.name.endsWith("nis2_csrf"))?.value ?? ""
    const r = await page.request.patch("/api/auth/me", {
      headers: { "X-CSRF-Token": csrf },
      data: { preferences: { tour: { version: TOUR_VERSION + 1, status: "done", chapters_done: ["welcome", "answer"] } } },
    })
    expect(r.ok()).toBeTruthy()
    await page.goto("/help")
    await expect(seen(page)).toContainText("None yet")
    await expect(seen(page).getByRole("listitem")).toHaveCount(0)
  })
})
