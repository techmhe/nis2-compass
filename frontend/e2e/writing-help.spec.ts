import type { Page, Route } from "@playwright/test"
import { authFile } from "./users"
import { expect, expectDialogFits, expectPageOk, test } from "./fixtures"

const ENDPOINT = "**/api/ai/assist/text"
const SUGGESTION = "Evidence: the policy v2.1 was reviewed in March."
const FIELDS = ["f-evidence", "f-gap", "f-action", "f-notes"]

async function openFirstRequirement(page: Page) {
  await page.goto("/assessments")
  await page.locator('a[href^="/assessments/"]').first().click()
  await expectPageOk(page)
  await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
  // The requirement's check points and legal references load after the panel and push the fields down; wait
  // for them so a click does not land on a field that moves away.
  await expect(page.getByRole("button", { name: /^Legal references \(\d+\)/ })).toBeVisible()
}

/** The writing help button next to the label of a field (the field's container is the textarea's parent). */
const helpOf = (page: Page, fieldId: string) => page.locator(`#${fieldId}`).locator("..").getByRole("button", { name: "Writing help" })

function answer(route: Route, body: unknown = { text: SUGGESTION, model: "e2e" }, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

test.describe("writing help as security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("each of the four fields has a button; empty and too long disable it", async ({ page }) => {
    await openFirstRequirement(page)
    for (const id of FIELDS) await expect(helpOf(page, id)).toBeVisible()
    const evidence = page.locator("#f-evidence")
    await evidence.fill("")
    await expect(helpOf(page, "f-evidence")).toBeDisabled()
    await expect(helpOf(page, "f-evidence")).toHaveAttribute("title", "Write something first")
    await evidence.fill("x".repeat(6001))
    await expect(helpOf(page, "f-evidence")).toBeDisabled()
    await expect(helpOf(page, "f-evidence")).toHaveAttribute("title", "Too long for writing help (max. 6000 characters)")
    await evidence.fill("short note")
    await expect(helpOf(page, "f-evidence")).toBeEnabled()
  })

  test("the menu lists the five items in order", async ({ page }) => {
    await openFirstRequirement(page)
    await page.locator("#f-evidence").fill("some text")
    await helpOf(page, "f-evidence").click()
    await expect(page.getByRole("menuitem")).toHaveText([
      "Proofread", "Write out from bullet points", "Translate to German", "Translate to Dutch", "Translate to English",
    ])
  })

  test("proofread: Apply replaces the field, saves it and survives navigation and reload", async ({ page }) => {
    let body: Record<string, unknown> | null = null
    await page.route(ENDPOINT, (route) => { body = route.request().postDataJSON(); return answer(route) })
    await openFirstRequirement(page)
    await page.locator("#f-evidence").fill("evidance: polcy v2.1 was reviewd in march")
    await helpOf(page, "f-evidence").click()
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    const dialog = page.getByRole("dialog", { name: "Proofread" })
    await expect(dialog.getByText("Original")).toBeVisible()
    await expect(dialog.getByText("Suggestion")).toBeVisible()
    await expect(dialog.getByText(SUGGESTION)).toBeVisible()
    await dialog.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByText("Text replaced. Review and adjust it.")).toBeVisible()
    await expect(page.locator("#f-evidence")).toHaveValue(SUGGESTION)
    expect(body).toMatchObject({
      mode: "proofread", language: null, field: "evidence", text: "evidance: polcy v2.1 was reviewd in march",
      target: { type: "answer", id: expect.any(Number) },
    })
    // survives J/K navigation
    await page.keyboard.press("j")
    await page.keyboard.press("k")
    await expect(page.locator("#f-evidence")).toHaveValue(SUGGESTION)
    await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible()
    await page.reload()
    await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
    await expect(page.locator("#f-evidence")).toHaveValue(SUGGESTION)
  })

  test("Discard and Esc leave the field unchanged", async ({ page }) => {
    await page.route(ENDPOINT, (route) => answer(route))
    await openFirstRequirement(page)
    const field = page.locator("#f-gap")
    await field.fill("original gap text")
    for (const close of ["Discard", "Escape"]) {
      await helpOf(page, "f-gap").click()
      await page.getByRole("menuitem", { name: "Proofread" }).click()
      const dialog = page.getByRole("dialog", { name: "Proofread" })
      await expect(dialog.getByText(SUGGESTION)).toBeVisible()
      if (close === "Escape") await page.keyboard.press("Escape")
      else await dialog.getByRole("button", { name: "Discard" }).click()
      await expect(dialog).toHaveCount(0)
      await expect(field).toHaveValue("original gap text")
      await expect(helpOf(page, "f-gap")).toBeFocused()
    }
  })

  test("translate sends the language, other modes send null", async ({ page }) => {
    const bodies: Record<string, unknown>[] = []
    await page.route(ENDPOINT, (route) => { bodies.push(route.request().postDataJSON()); return answer(route) })
    await openFirstRequirement(page)
    await page.locator("#f-action").fill("- patch servers\n- test backups")
    const run = async (item: string) => {
      await helpOf(page, "f-action").click()
      await page.getByRole("menuitem", { name: item }).click()
      const dialog = page.getByRole("dialog", { name: item })
      await expect(dialog.getByText(SUGGESTION)).toBeVisible()
      await dialog.getByRole("button", { name: "Discard" }).click()
    }
    await run("Translate to German")
    await run("Write out from bullet points")
    expect(bodies.map((b) => [b.mode, b.language, b.field])).toEqual([["translate", "de", "recommended_action"], ["expand", null, "recommended_action"]])
  })

  test("an error shows the message and Try again re-sends", async ({ page }) => {
    let calls = 0
    await page.route(ENDPOINT, (route) => {
      calls += 1
      return calls === 1 ? answer(route, { detail: "The AI model returned no usable text. Try again or use another model." }, 502) : answer(route)
    })
    await openFirstRequirement(page)
    await page.locator("#f-notes").fill("interview notes")
    await helpOf(page, "f-notes").click()
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    const dialog = page.getByRole("dialog", { name: "Proofread" })
    await expect(dialog.getByText("The AI model returned no usable text. Try again or use another model.")).toBeVisible()
    await expect(page.locator("#f-notes")).toHaveValue("interview notes")
    await dialog.getByRole("button", { name: "Try again" }).click()
    await expect(dialog.getByText(SUGGESTION)).toBeVisible()
    expect(calls).toBe(2)
  })

  test("an unconfigured assistant shows the existing toast", async ({ page }) => {
    await page.route(ENDPOINT, (route) => answer(route, { detail: "AI assistant is not configured" }, 503))
    await openFirstRequirement(page)
    await page.locator("#f-notes").fill("interview notes")
    await helpOf(page, "f-notes").click()
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    await expect(page.getByText("The AI assistant is not configured yet. An administrator can connect a model under Administration, AI settings.")).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("long unbroken text fits the dialog in both columns", async ({ page }) => {
    const long = "A".repeat(300)
    await page.route(ENDPOINT, (route) => answer(route, { text: "B".repeat(300), model: "e2e" }))
    await openFirstRequirement(page)
    await page.locator("#f-evidence").fill(long)
    // The fill resizes the field; a pointer click could land its pointerup on the menu item. Open by keyboard.
    await helpOf(page, "f-evidence").focus()
    await page.keyboard.press("Enter")
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    const dialog = page.getByRole("dialog", { name: "Proofread" })
    await expect(dialog.getByText("B".repeat(300))).toBeVisible()
    await expectDialogFits(dialog)
  })
})

test.describe("writing help as viewer", () => {
  test.use({ storageState: authFile("viewer") })

  test("a viewer sees no button", async ({ page }) => {
    await openFirstRequirement(page)
    await expect(page.locator("#f-evidence")).toBeVisible()
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0)
  })
})
