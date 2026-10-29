import { test, expect } from "./fixtures"
import type { Locator, Page } from "@playwright/test"

// The file name ends in "setup.spec.ts" on purpose: playwright.config.ts runs those in the `first-run` project, the
// only one with a setup page. These tests never finish the setup, so they leave the database as setup.spec.ts needs it.
const SETUP_TOKEN = "e2e-setup-token"
const ADMIN = { name: "Ida Isb", email: "ida.isb@example.test", password: "Setup-Password-2026!" }

async function toCompanies(page: Page) {
  await page.goto("/setup")
  await page.getByLabel("Setup token").fill(SETUP_TOKEN)
  await page.getByLabel("Name", { exact: true }).fill(ADMIN.name)
  await page.getByLabel("E-mail").fill(ADMIN.email)
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
  await page.getByLabel("Repeat password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Next" }).click()
  return page.getByRole("group", { name: "Company 1", exact: true })
}

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

const legalForm = (company: Locator) => company.getByLabel("Legal form", { exact: true })

test("legal form is a select like Country, offering the country's forms and Other", async ({ page }) => {
  const company = await toCompanies(page)
  const country = company.getByLabel("Country", { exact: true })
  const form = legalForm(company)
  await expect(form).toHaveRole("combobox")
  await expect(form).toHaveText("Select…")
  const countryBox = await country.boundingBox()
  const formBox = await form.boundingBox()
  expect(formBox?.height).toBe(countryBox?.height)

  await form.click()
  for (const name of ["GmbH", "AG", "SE", "KG", "GmbH & Co. KG", "OHG", "UG (haftungsbeschränkt)", "e.K.", "eG", "Other…"]) {
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole("option", { name: "B.V.", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await choose(page, country, "Netherlands")
  await form.click()
  for (const name of ["B.V.", "N.V.", "C.V.", "Coöperatie", "Stichting", "Vennootschap onder firma", "Eenmanszaak", "Other…"]) {
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
  }
})

test("choosing Other shows the text input for the legal form", async ({ page }) => {
  const company = await toCompanies(page)
  const other = company.getByLabel("Other legal form", { exact: true })
  await expect(other).toHaveCount(0)
  await choose(page, legalForm(company), "Other…")
  await expect(legalForm(company)).toHaveText("Other…")
  await expect(other).toBeVisible()
  await expect(other).toHaveAttribute("maxlength", "60")
  await other.fill("Societas Atlas")
  await expect(other).toHaveValue("Societas Atlas")
  await choose(page, legalForm(company), "GmbH")
  await expect(other).toHaveCount(0)
})

test("changing the country clears a legal form of the old country but keeps a free one", async ({ page }) => {
  const company = await toCompanies(page)
  const country = company.getByLabel("Country", { exact: true })
  await choose(page, legalForm(company), "GmbH")
  await expect(legalForm(company)).toHaveText("GmbH")
  await choose(page, country, "Netherlands")
  await expect(legalForm(company)).toHaveText("Select…")

  await choose(page, legalForm(company), "B.V.")
  await choose(page, country, "Germany")
  await expect(legalForm(company)).toHaveText("Select…")

  await choose(page, legalForm(company), "Other…")
  await company.getByLabel("Other legal form", { exact: true }).fill("Societas Atlas")
  await choose(page, country, "Netherlands")
  await expect(legalForm(company)).toHaveText("Other…")
  await expect(company.getByLabel("Other legal form", { exact: true })).toHaveValue("Societas Atlas")
})

test("a missing legal form is reported at the field", async ({ page }) => {
  const company = await toCompanies(page)
  await company.getByLabel("Company name").fill("Atlas Holding GmbH")
  await company.getByLabel("Code", { exact: true }).fill("ATL")
  await company.getByLabel("Sector", { exact: true }).click()
  await page.getByRole("option", { name: /machinery/ }).first().click()
  await choose(page, company.getByLabel("Size class", { exact: true }), "Medium")
  await page.getByRole("button", { name: "Next" }).click()
  await expect(company.getByText("Legal form is required")).toBeVisible()
  await expect(legalForm(company)).toHaveAttribute("aria-invalid", "true")
  await expect(legalForm(company)).toHaveAttribute("aria-describedby", /-legal-error$/)
  await choose(page, legalForm(company), "GmbH")
  await expect(company.getByText("Legal form is required")).toHaveCount(0)
})
