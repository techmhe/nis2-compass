import { authFile } from "./users"
import { expect, test } from "./fixtures"

// The legal form field of the entity master data. The setup page has its own tests in legal-form-setup.spec.ts.
test.use({ storageState: authFile("isb") })

test("a stored legal form outside the list shows as Other with its value", async ({ page }) => {
  await page.goto("/entities/1")
  await page.getByRole("button", { name: "Edit master data" }).click()
  const dialog = page.getByRole("dialog")
  const form = dialog.getByLabel("Legal form", { exact: true })
  const original = (await form.textContent())?.trim() ?? ""
  expect(original, "the demo entity has a legal form from the list").not.toBe("Other…")
  await expect(dialog.getByLabel("Other legal form", { exact: true })).toHaveCount(0)

  try {
    await form.click()
    await page.getByRole("option", { name: "Other…", exact: true }).click()
    await dialog.getByLabel("Other legal form", { exact: true }).fill("Societas Atlas")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expect(dialog).toHaveCount(0)

    await page.reload()
    await page.getByRole("button", { name: "Edit master data" }).click()
    const reopened = page.getByRole("dialog")
    await expect(reopened.getByLabel("Legal form", { exact: true })).toHaveText("Other…")
    await expect(reopened.getByLabel("Other legal form", { exact: true })).toHaveValue("Societas Atlas")
  } finally {
    // Put the demo entity back so that other tests see what they expect.
    if (!(await page.getByRole("dialog").count())) {
      await page.getByRole("button", { name: "Edit master data" }).click()
    }
    const restore = page.getByRole("dialog")
    await restore.getByLabel("Legal form", { exact: true }).click()
    await page.getByRole("option", { name: original, exact: true }).click()
    await restore.getByRole("button", { name: "Save changes" }).click()
    await expect(restore).toHaveCount(0)
  }
})

test("the legal form can be left unset in the entity form", async ({ page }) => {
  await page.goto("/entities/1")
  await page.getByRole("button", { name: "Edit master data" }).click()
  const form = page.getByRole("dialog").getByLabel("Legal form", { exact: true })
  await form.click()
  await expect(page.getByRole("option", { name: "Not set", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
})
