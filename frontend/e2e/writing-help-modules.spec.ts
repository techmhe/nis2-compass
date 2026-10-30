import type { Page, Route } from "@playwright/test"
import { authFile } from "./users"
import { expect, expectPageOk, test } from "./fixtures"

const ENDPOINT = "**/api/ai/assist/text"
const SUGGESTION = "Maßnahmen: Der Zugriff wird vierteljährlich geprüft."

type Body = Record<string, unknown>

/** Records the request bodies of the writing help endpoint and answers with a fixed suggestion. */
async function mockEndpoint(page: Page) {
  const bodies: Body[] = []
  await page.route(ENDPOINT, (route: Route) => {
    bodies.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: SUGGESTION, model: "e2e" }) })
  })
  return bodies
}

const helpIn = (page: Page, fieldId: string) => page.locator(`#${fieldId}`).locator("..").getByRole("button", { name: "Writing help" })

async function proofread(page: Page, fieldId: string) {
  await helpIn(page, fieldId).click()
  await page.getByRole("menuitem", { name: "Proofread" }).click()
  const dialog = page.getByRole("dialog", { name: "Proofread" })
  await expect(dialog.getByText(SUGGESTION)).toBeVisible()
  await dialog.getByRole("button", { name: "Discard" }).click()
  await expect(dialog).toHaveCount(0)
}

async function openFirstRisk(page: Page) {
  await page.goto("/risks")
  await page.locator('a[href^="/risks/"]').first().click()
  await expectPageOk(page)
}

async function openAudit(page: Page, code = "AUD-2026-01") {
  await page.goto("/audits/programme")
  await page.getByText(code, { exact: true }).locator("xpath=following-sibling::button").click()
}

test.describe("writing help in risks, incidents and audits as security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("risk: a hand edit and an applied translation are saved together", async ({ page }) => {
    await mockEndpoint(page)
    await openFirstRisk(page)
    const stamp = `edited by hand ${Date.now()}`
    await page.locator("#r-scen").fill(stamp)
    await page.locator("#r-ctrl").fill("Access is reviewed every quarter.")
    await helpIn(page, "r-ctrl").click()
    await page.getByRole("menuitem", { name: "Translate to German" }).click()
    await page.getByRole("dialog", { name: "Translate to German" }).getByRole("button", { name: "Apply" }).click()
    await expect(page.getByText("Text replaced. Save to keep it.")).toBeVisible()
    await expect(page.locator("#r-ctrl")).toHaveValue(SUGGESTION)
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Risk saved")).toBeVisible()
    await page.reload()
    await expect(page.locator("#r-scen")).toHaveValue(stamp)
    await expect(page.locator("#r-ctrl")).toHaveValue(SUGGESTION)
    await expect(helpIn(page, "r-just")).toBeVisible()
  })

  test("incident: Proofread on Measures sends the incident and the field", async ({ page }) => {
    const bodies = await mockEndpoint(page)
    await page.goto("/incidents")
    await page.getByText("Compromised VPN account", { exact: false }).first().click()
    await expectPageOk(page)
    await page.locator("#inc-measures").fill("- reset passwords\n- block the account")
    await proofread(page, "inc-measures")
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ mode: "proofread", field: "measures", target: { type: "incident", id: expect.any(Number) } })
    for (const id of ["inc-description", "inc-significance_rationale", "inc-impact", "inc-root_cause", "inc-lessons_learned"]) {
      await expect(helpIn(page, id)).toBeVisible()
    }
    await expect(helpIn(page, "inc-indicators_of_compromise")).toHaveCount(0)
  })

  test("audit: the edit dialog offers Summary help, the new audit dialog does not", async ({ page }) => {
    const bodies = await mockEndpoint(page)
    await openAudit(page)
    // the audit sheet's own Edit button; the programme's "Edit …" button lies behind the sheet overlay
    await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click()
    await page.locator("#a-sum").fill("Two findings on access reviews.")
    await proofread(page, "a-sum")
    await expect(helpIn(page, "a-conc")).toBeVisible()
    expect(bodies[0]).toMatchObject({ field: "summary", target: { type: "audit", id: expect.any(Number) } })
    await page.keyboard.press("Escape")

    await page.goto("/audits/programme")
    await page.getByRole("button", { name: "New audit" }).click()
    await expect(page.locator("#a-sum")).toBeVisible()
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0)
  })

  test("audit: the new finding description is written on the audit", async ({ page }) => {
    const bodies = await mockEndpoint(page)
    await openAudit(page)
    await page.getByRole("button", { name: "Add finding" }).click()
    await page.locator("#f-desc").fill("Access reviews are not evidenced.")
    await proofread(page, "f-desc")
    expect(bodies[0]).toMatchObject({ field: "finding_description", target: { type: "audit", id: expect.any(Number) } })
  })

  test("audit: the closure note is written on the finding", async ({ page }) => {
    const bodies = await mockEndpoint(page)
    await page.goto("/audits/findings")
    await page.getByRole("button", { name: "Close", exact: true }).first().click()
    await page.locator("#cl-note").fill("Accepted for now.")
    await proofread(page, "cl-note")
    expect(bodies[0]).toMatchObject({ field: "closure_note", target: { type: "audit_finding", id: expect.any(Number) } })
  })

  test("effectiveness review: a draft has the button, an approved one does not", async ({ page }) => {
    await page.goto("/audits/effectiveness-reviews")
    await page.getByRole("button", { name: /chapters? rated/ }).first().click()
    await expect(helpIn(page, "eff-conclusion")).toBeVisible()
    await page.keyboard.press("Escape")

    await page.route("**/api/audits/effectiveness-reviews/*", async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      const res = await route.fetch()
      const review = await res.json()
      return route.fulfill({ response: res, json: { ...review, status: "approved", can_edit: false } })
    })
    await page.reload()
    await page.getByRole("button", { name: /chapters? rated/ }).first().click()
    await expect(page.getByRole("heading", { name: "Overall conclusion" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0)
  })
})

test.describe("writing help in risks, incidents and audits as viewer", () => {
  test.use({ storageState: authFile("viewer") })

  test("a viewer sees no button on a risk or an incident", async ({ page }) => {
    await openFirstRisk(page)
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0)
    await page.goto("/incidents")
    await page.getByText("Compromised VPN account", { exact: false }).first().click()
    await expectPageOk(page)
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0)
  })
})
