import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const admin: TourChapter = {
  id: "admin",
  title: "Administer the system",
  gate: CHAPTER_GATES.admin,
  steps: [
    { name: "users", route: "/admin/users", perm: "users.manage", title: "Users and their roles",
      body: "Users manages accounts and role assignments. A role assigned to one entity applies to that entity's data only." },
    { name: "roles", route: "/admin/roles", perm: "roles.manage", title: "Roles and permissions",
      body: "Roles and permissions defines what each role may do. You can adjust the built-in roles or add your own." },
    { name: "sso", route: "/admin/system", perm: "settings.manage", title: "Single sign-on",
      body: "Sign-in and sessions shows whether single sign-on is active and how groups map to roles. These values come from the server configuration." },
    { name: "entities", route: "/admin/entities", perm: "entities.manage", title: "Companies of the group",
      body: "Entities holds each legal entity with its NIS-2 classification and competent authority. Set these up before you assess a company." },
    { name: "system", route: "/admin/system", perm: "settings.manage", title: "System settings",
      body: "System shows the runtime configuration, the search index and the general settings. Certificates are configured on the server and shown read-only." },
    { name: "audit", route: "/admin/audit", perm: "audit.read", title: "The audit log",
      body: "Audit log records every change, sign-in, export and download with the acting user. Use it to answer who did what and when." },
  ],
}
