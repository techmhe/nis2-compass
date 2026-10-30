import { test as setup, expect } from "@playwright/test"
import { authFile, USERS, type UserKey } from "./users"

// Sign in once per role through the API and store the session cookies for the tests.
for (const key of Object.keys(USERS) as UserKey[]) {
  setup(`sign in as ${key}`, async ({ request }) => {
    const r = await request.post("/api/auth/login", { data: USERS[key] })
    expect(r.ok(), await r.text()).toBeTruthy()
    // The product tour would start on the first Dashboard load of every stored user; the tests that cover it use
    // users of their own (tour-users.ts).
    const csrf = (await request.storageState()).cookies.find((c) => c.name.endsWith("nis2_csrf"))?.value
    const t = await request.patch("/api/auth/me", {
      headers: { "X-CSRF-Token": csrf ?? "" },
      data: { preferences: { tour: { version: 1, status: "dismissed", chapters_done: [] } } },
    })
    expect(t.ok(), await t.text()).toBeTruthy()
    await request.storageState({ path: authFile(key) })
  })
}
