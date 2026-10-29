import { test, expect, expectNoHorizontalOverflow, expectPageOk } from "./fixtures"
import type { Locator, Page } from "@playwright/test"

// Runs in the `first-run` project against an API with an empty database (see playwright.config.ts). The tests run in
// file order on that one database: the layout and error checks stop before "Finish setup", the last test completes it.
// Must equal NIS2_SETUP_TOKEN of the first-run API in playwright.config.ts.
const SETUP_TOKEN = "e2e-setup-token"
const ADMIN = { name: "Ida Isb", email: "ida.isb@example.test", password: "Setup-Password-2026!" }

async function chooseOption(page: Page, trigger: Locator, option: RegExp | string) {
  await trigger.click()
  await page.getByRole("option", { name: option }).first().click()
}

async function fillAdmin(page: Page, token = SETUP_TOKEN) {
  await page.getByLabel("Setup token").fill(token)
  await page.getByLabel("Name", { exact: true }).fill(ADMIN.name)
  await page.getByLabel("E-mail").fill(ADMIN.email)
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
  await page.getByLabel("Repeat password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Next" }).click()
}

async function fillCompany(page: Page, n: number, c: { name: string; code: string; legalForm: string; country: string; headquarters?: boolean }) {
  const g = page.getByRole("group", { name: `Company ${n}`, exact: true })
  await g.getByLabel("Company name").fill(c.name)
  await g.getByLabel("Code", { exact: true }).fill(c.code)
  await chooseOption(page, g.getByLabel("Country"), c.country)
  await chooseOption(page, g.getByLabel("Legal form", { exact: true }), c.legalForm)
  await chooseOption(page, g.getByLabel("Sector"), /machinery/)
  await chooseOption(page, g.getByLabel("Size class"), "Medium")
  if (c.headquarters) await g.getByLabel("Headquarters").check()
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** "2026-11-09" as the app shows it ("9 Nov 2026"). */
function shown(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
/** ISO date plus days, in UTC so that the time zone cannot move it. */
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function nextMondayPlus(days: number) {
  const t = new Date()
  const iso = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())).toISOString().slice(0, 10)
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return addDays(iso, ((8 - dow) % 7 || 7) + days)
}

/** The Project step, once the plan for the current answers has arrived ("Next" is disabled until then). */
async function toProjectStep(page: Page) {
  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByLabel("Project name")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  await expect(page.getByLabel("Gate 1 date")).toBeVisible()
}

/** From the Companies step through Project and Roles (defaults) to Review. */
async function toReview(page: Page) {
  await toProjectStep(page)
  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByRole("button", { name: "Add role" })).toBeVisible()
  await page.getByRole("button", { name: "Review" }).click()
}

for (const width of [1280, 390]) {
  test(`no horizontal overflow at ${width} px on any step`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup$/)
    await expectPageOk(page)
    await expectNoHorizontalOverflow(page)
    await fillAdmin(page)
    await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
    await page.getByRole("button", { name: "Add company" }).click()
    await fillCompany(page, 2, { name: "Atlas Nederland Industrial Manufacturing and Services B.V.", code: "ATN", legalForm: "B.V.", country: "Netherlands" })
    await expectNoHorizontalOverflow(page)
    await toProjectStep(page)
    await expectNoHorizontalOverflow(page)
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByRole("button", { name: "Add role" })).toBeVisible()
    await page.getByRole("button", { name: "Add role" }).click()
    await page.getByRole("group", { name: "Custom role 1", exact: true }).getByLabel("Role name").fill("A very long custom role name for the plant safety and environmental management office")
    await expectNoHorizontalOverflow(page)
    await page.getByRole("button", { name: "Review" }).click()
    await expect(page.getByRole("button", { name: "Finish setup" })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}

test("a duplicate company code is reported at the field", async ({ page }) => {
  await page.goto("/setup")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await page.getByRole("button", { name: "Add company" }).click()
  await fillCompany(page, 2, { name: "Atlas Schweiz GmbH", code: "atl", legalForm: "GmbH", country: "Germany" })
  await page.getByRole("button", { name: "Next" }).click()
  const second = page.getByRole("group", { name: "Company 2", exact: true })
  await expect(second.getByText("Company code is used twice")).toBeVisible()
  await expect(second.getByLabel("Code", { exact: true })).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByRole("button", { name: "Finish setup" })).toHaveCount(0)
})

test("a wrong setup token is reported at the token field", async ({ page }) => {
  await page.goto("/setup")
  await fillAdmin(page, "not-the-token")
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await toReview(page)
  await page.getByRole("button", { name: "Finish setup" }).click()
  await expect(page.getByText("The setup token is not correct.")).toBeVisible()
  await expect(page.getByLabel("Setup token")).toHaveAttribute("aria-invalid", "true")
  await expect(page).toHaveURL(/\/setup$/)
})

test("a server-only 422 is shown at the field it names", async ({ page }) => {
  await page.route("**/api/setup", (route) => route.request().method() === "POST"
    ? route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid input", errors: [{ loc: ["body", "companies", 0, "code"], msg: "Value error, Code is taken on the server" }] }),
    })
    : route.continue())
  await page.goto("/setup")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await toReview(page)
  await page.getByRole("button", { name: "Finish setup" }).click()
  const first = page.getByRole("group", { name: "Company 1", exact: true })
  await expect(first.getByText("Code is taken on the server")).toBeVisible()
  await expect(first.getByLabel("Code", { exact: true })).toHaveAttribute("aria-invalid", "true")
})

test("a tight end date shows the warning", async ({ page }) => {
  await page.goto("/setup")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await toProjectStep(page)
  const proposed = await page.getByLabel("End date", { exact: true }).inputValue()
  const start = await page.getByLabel("Start date").inputValue()
  await expect(page.getByText(/leaves less than 75% of the proposed time/)).toHaveCount(0)
  // The warning is about the share of the proposed time that is left, so cut 30% of it
  const span = (Date.parse(proposed) - Date.parse(start)) / 86_400_000
  await page.getByLabel("End date", { exact: true }).fill(addDays(proposed, -Math.round(0.3 * span)))
  await expect(page.getByText("The end date leaves less than 75% of the proposed time; the plan is compressed accordingly.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  await page.getByRole("button", { name: "Use proposed end date" }).click()
  await expect(page.getByText(/leaves less than 75% of the proposed time/)).toHaveCount(0)
  await expect(page.getByLabel("End date", { exact: true })).toHaveValue(proposed)
})

test("a changed answer recalculates gate dates", async ({ page }) => {
  await page.goto("/setup")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await toProjectStep(page)
  const before = await page.getByLabel("Gate 6 date").inputValue()
  const gate3 = await page.getByLabel("Gate 3 date").inputValue()
  // A changed answer without typed gate dates has nothing to say about recalculation
  await page.getByRole("group", { name: "Assessment", exact: true }).getByRole("radio", { name: "Sequential" }).click()
  await expect(page.getByLabel("Gate 3 date")).not.toHaveValue(gate3)
  await expect(page.getByText("Gate dates were recalculated.")).toHaveCount(0)
  const typed = addDays(await page.getByLabel("Gate 3 date").inputValue(), -7)
  await page.getByLabel("Gate 3 date").fill(typed)
  await expect(page.getByLabel("Gate 3 date")).toHaveValue(typed)
  await page.getByRole("group", { name: "Capacity", exact: true }).getByRole("radio", { name: "Dedicated" }).click()
  await expect(page.getByLabel("Gate 6 date")).not.toHaveValue(before)
  await expect(page.getByLabel("Gate 3 date")).not.toHaveValue(typed)
  await expect(page.getByText("Gate dates were recalculated.")).toBeVisible()
  // Typing a date again clears the note
  await page.getByLabel("Gate 3 date").fill(typed)
  await expect(page.getByText("Gate dates were recalculated.")).toHaveCount(0)
  await page.getByRole("group", { name: "Capacity", exact: true }).getByRole("radio", { name: "Part-time" }).click()
  await expect(page.getByText("Gate dates were recalculated.")).toBeVisible()
  await page.getByRole("group", { name: "Capacity", exact: true }).getByRole("radio", { name: "Dedicated" }).click()
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  const after = await page.getByLabel("Gate 6 date").inputValue()
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("button", { name: "Review" }).click()
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeVisible()
  await expect(page.getByText(shown(after)).first()).toBeVisible()
})

test("an end date before the earliest possible one is reported at the field", async ({ page }) => {
  await page.goto("/setup")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await toProjectStep(page)
  const proposed = await page.getByLabel("End date", { exact: true }).inputValue()
  await page.getByLabel("End date", { exact: true }).fill(addDays(proposed, -330))
  await expect(page.getByText(/earliest feasible end is/)).toBeVisible()
  await expect(page.getByLabel("End date", { exact: true })).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled()
})

test("setup with two companies ends on the dashboard as the new administrator", async ({ page }) => {
  await page.goto("/")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await page.getByRole("button", { name: "Add company" }).click()
  await fillCompany(page, 2, { name: "Atlas Nederland B.V.", code: "ATN", legalForm: "B.V.", country: "Netherlands" })
  const start = nextMondayPlus(7)
  await toProjectStep(page)
  await page.getByLabel("Start date").fill(start)
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  const gate1 = await page.getByLabel("Gate 1 date").inputValue()
  expect(gate1 >= start, "the first gate lies after the start").toBe(true)
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("group", { name: "OT", exact: true }).getByRole("checkbox", { name: "Takes part" }).uncheck()
  await page.getByRole("button", { name: "Add role" }).click()
  await page.getByRole("group", { name: "Custom role 1", exact: true }).getByLabel("Role name").fill("Plant Safety Officer")
  await page.getByRole("button", { name: "Review" }).click()

  await expect(page.getByText("Plant Safety Officer")).toBeVisible()
  await expect(page.getByText(shown(start)).first()).toBeVisible()
  await expect(page.getByText(shown(gate1)).first()).toBeVisible()
  await expect(page.getByText("Central at HQ")).toBeVisible()
  await expect(page.getByText("CSIRT-DSP / NCSC-NL")).toBeVisible()
  await page.getByRole("button", { name: "Finish setup" }).click()

  await expect(page).toHaveURL(/\/$/)
  await expectPageOk(page)
  const me = await (await page.request.get("/api/auth/me")).json()
  expect(me.email).toBe(ADMIN.email)

  await page.goto("/admin/entities")
  await expect(page.getByRole("link", { name: "Atlas Holding GmbH" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Atlas Nederland B.V." })).toBeVisible()

  await page.goto("/setup")
  await expect(page).not.toHaveURL(/\/setup/)

  const projects: { id: number; name: string }[] = await (await page.request.get("/api/projects")).json()
  expect(projects).toHaveLength(1)
  await page.goto(`/projects/${projects[0].id}`)
  await expect(page.getByText(shown(start)).first()).toBeVisible()
  await page.goto(`/projects/${projects[0].id}/gates`)
  await expect(page.getByText(shown(gate1)).first()).toBeVisible()
})
