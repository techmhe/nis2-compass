import { USERS } from "./users"
import { expect, expectPageOk, test } from "./fixtures"

test.describe("sign-in", () => {
  test("wrong password is rejected, correct password signs in, sign out returns to the login page", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel("E-mail").fill(USERS.isb.email)
    await page.getByLabel("Password").fill("wrong-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText(/invalid/i)).toBeVisible()

    await page.getByLabel("Password").fill(USERS.isb.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).not.toHaveURL(/\/login/)
    await expectPageOk(page)

    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test("login page looks as expected", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(page).toHaveScreenshot("login.png")
  })
})
