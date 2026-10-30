import { request as pwRequest, type Page } from "@playwright/test"
import { E2E_ENV } from "../playwright.config"
import { authFile } from "./users"

// Users for the tour tests are created through the admin API, so each starts without a stored tour state.
const FIRST_PASSWORD = "Tour-First-Password-2026!"
export const TOUR_PASSWORD = "Tour-Password-2026!"
let counter = 0

export interface TourUser { email: string; password: string }

/**
 * Creates a user with a built-in role (`role`) or a custom role with exactly `permissions`, assigned group-wide or,
 * with `scoped`, for the first entity only.
 */
export async function createTourUser(opts: { role?: string; permissions?: string[]; scoped?: boolean }): Promise<TourUser> {
  const admin = await pwRequest.newContext({ baseURL: E2E_ENV.NIS2_BASE_URL, storageState: authFile("admin") })
  try {
    const csrf = (await admin.storageState()).cookies.find((c) => c.name.endsWith("nis2_csrf"))?.value ?? ""
    const headers = { "X-CSRF-Token": csrf }
    const suffix = `${Date.now()}-${++counter}`
    let roleKey = opts.role ?? ""
    if (opts.permissions) {
      roleKey = `tour_${suffix.replace("-", "_")}`
      const r = await admin.post("/api/roles", { headers, data: { key: roleKey, name: `Tour role ${suffix}`, permissions: opts.permissions } })
      if (!r.ok()) throw new Error(`role: ${r.status()} ${await r.text()}`)
    }
    const roles: { id: number; key: string }[] = await (await admin.get("/api/roles")).json()
    const role = roles.find((r) => r.key === roleKey)
    if (!role) throw new Error(`unknown role ${roleKey}`)
    let entityId: number | null = null
    if (opts.scoped) {
      const entities: { id: number }[] = await (await admin.get("/api/entities")).json()
      if (!entities.length) throw new Error("no entity to scope the role to")
      entityId = entities[0].id
    }
    const email = `tour-${suffix}@example.test`
    const u = await admin.post("/api/users", {
      headers,
      data: { email, display_name: "Tina Tour", password: FIRST_PASSWORD, assignments: [{ role_id: role.id, entity_id: entityId }] },
    })
    if (!u.ok()) throw new Error(`user: ${u.status()} ${await u.text()}`)
    return { email, password: FIRST_PASSWORD }
  } finally {
    await admin.dispose()
  }
}

async function csrfOf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name.endsWith("nis2_csrf"))?.value ?? ""
}

/** Signs in through the API; the admin API gives new users a password they must change first. */
export async function signIn(page: Page, user: TourUser) {
  const r = await page.request.post("/api/auth/login", { data: user })
  if (!r.ok()) throw new Error(`login: ${r.status()} ${await r.text()}`)
}

export async function changePassword(page: Page, user: TourUser) {
  const r = await page.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": await csrfOf(page) },
    data: { current_password: user.password, new_password: TOUR_PASSWORD },
  })
  if (!r.ok()) throw new Error(`change-password: ${r.status()} ${await r.text()}`)
}

/** A new user, signed in with the forced password change already done. */
export async function signInFresh(
  page: Page,
  opts: { role?: string; permissions?: string[]; scoped?: boolean } = { role: "contributor" },
): Promise<TourUser> {
  const user = await createTourUser(opts)
  await signIn(page, user)
  await changePassword(page, user)
  return { email: user.email, password: TOUR_PASSWORD }
}

export async function storedTour(page: Page): Promise<unknown> {
  const me = await (await page.request.get("/api/auth/me")).json()
  return me.preferences?.tour
}

/** Stores a tour state for the signed-in user, e.g. so the Dashboard does not start the tour on its own. */
export async function storeTour(page: Page, tour: { version: number; status: string; chapters_done: string[] }) {
  const r = await page.request.patch("/api/auth/me", { headers: { "X-CSRF-Token": await csrfOf(page) }, data: { preferences: { tour } } })
  if (!r.ok()) throw new Error(`tour state: ${r.status()} ${await r.text()}`)
}
