import { test, expect, expectNoHorizontalOverflow, expectPageOk } from "./fixtures"
import type { Locator, Page } from "@playwright/test"

// Runs in the `first-run` project against an API with an empty database (see playwright.config.ts). The tests run in
// file order on that one database: the layout and error checks stop before "Finish setup", the last test completes it.
const ADMIN = { name: "Ida Isb", email: "ida.isb@example.test", password: "Setup-Password-2026!" }

async function chooseOption(page: Page, trigger: Locator, option: RegExp | string) {
  await trigger.click()
  await page.getByRole("option", { name: option }).first().click()
}

async function fillAdmin(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill(ADMIN.name)
  await page.getByLabel("E-mail").fill(ADMIN.email)
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
  await page.getByLabel("Repeat password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Next" }).click()
}

async function fillCompany(page: Page, n: number, c: { name: string; code: string; legalForm: string; country: string; headquarters?: boolean }) {
  const g = page.getByRole("group", { name: `Company ${n}` })
  await g.getByLabel("Company name").fill(c.name)
  await g.getByLabel("Code", { exact: true }).fill(c.code)
  await chooseOption(page, g.getByLabel("Country"), c.country)
  await g.getByLabel("Legal form").fill(c.legalForm)
  await chooseOption(page, g.getByLabel("Sector"), /machinery/)
  await chooseOption(page, g.getByLabel("Size class"), "Medium")
  if (c.headquarters) await g.getByLabel("Headquarters").check()
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
  await page.getByRole("button", { name: "Review" }).click()
  const second = page.getByRole("group", { name: "Company 2" })
  await expect(second.getByText("Company code is used twice")).toBeVisible()
  await expect(second.getByLabel("Code", { exact: true })).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByRole("button", { name: "Finish setup" })).toHaveCount(0)
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
  await page.getByRole("button", { name: "Review" }).click()
  await page.getByRole("button", { name: "Finish setup" }).click()
  const first = page.getByRole("group", { name: "Company 1" })
  await expect(first.getByText("Code is taken on the server")).toBeVisible()
  await expect(first.getByLabel("Code", { exact: true })).toHaveAttribute("aria-invalid", "true")
})

test("setup with two companies ends on the dashboard as the new administrator", async ({ page }) => {
  await page.goto("/")
  await fillAdmin(page)
  await fillCompany(page, 1, { name: "Atlas Holding GmbH", code: "ATL", legalForm: "GmbH", country: "Germany", headquarters: true })
  await page.getByRole("button", { name: "Add company" }).click()
  await fillCompany(page, 2, { name: "Atlas Nederland B.V.", code: "ATN", legalForm: "B.V.", country: "Netherlands" })
  await page.getByRole("button", { name: "Review" }).click()

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
})
