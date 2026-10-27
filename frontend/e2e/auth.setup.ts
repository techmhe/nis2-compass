import { test as setup, expect } from "@playwright/test"
import { authFile, USERS, type UserKey } from "./users"

// Sign in once per role through the API and store the session cookies for the tests.
for (const key of Object.keys(USERS) as UserKey[]) {
  setup(`sign in as ${key}`, async ({ request }) => {
    const r = await request.post("/api/auth/login", { data: USERS[key] })
    expect(r.ok(), await r.text()).toBeTruthy()
    await request.storageState({ path: authFile(key) })
  })
}
