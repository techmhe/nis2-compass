import { E2E_ENV } from "../playwright.config"

// Demo users from backend/app/seed/demo.py and the bootstrap admin of the e2e API.
export const DEMO_PASSWORD = "Demo-Password-2026!"
export const USERS = {
  admin: { email: E2E_ENV.NIS2_BOOTSTRAP_ADMIN_EMAIL, password: E2E_ENV.NIS2_BOOTSTRAP_ADMIN_PASSWORD },
  isb: { email: "isb@demo.local", password: DEMO_PASSWORD }, // security officer, group-wide
  nl: { email: "nl.contact@demo.local", password: DEMO_PASSWORD }, // contributor for ATN and ATC only
  viewer: { email: "viewer@demo.local", password: DEMO_PASSWORD }, // read-only
} as const
export type UserKey = keyof typeof USERS
export const authFile = (u: UserKey) => `e2e/.auth/${u}.json`
