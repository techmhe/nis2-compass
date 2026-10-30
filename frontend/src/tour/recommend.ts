// Pure and free of aliases and React so that a browser-less test can import it.
import { CHAPTER_ORDER, type ChapterId } from "./types"

/** Permissions of which a user needs at least one (anywhere) for a chapter to be available. */
export const CHAPTER_GATES: Record<ChapterId, string[]> = {
  welcome: [],
  answer: ["assessments.edit"],
  assess: ["findings.manage"],
  programme: ["governance.read"],
  project: ["projects.read"],
  risks: ["risks.read"],
  controls: ["controls.read"],
  audits: ["audits.read"],
  incidents: ["incidents.read"],
  suppliers: ["suppliers.read"],
  inventory: ["assets.read"],
  documents: ["documents.read"],
  quality: ["assessments.read"],
  admin: ["users.manage", "roles.manage", "settings.manage", "entities.manage"],
}

const BY_ROLE: Record<string, ChapterId[]> = {
  admin: ["welcome", "admin", "programme"],
  project_manager: ["welcome", "project", "quality"],
  assessor: ["welcome", "assess", "answer", "risks", "incidents"],
  contributor: ["welcome", "answer"],
  viewer: ["welcome", "programme", "documents"],
  auditor: ["welcome", "programme", "audits", "documents"],
}

const WRITE = /^(.+)\.(manage|edit|upload)$/

/**
 * The chapters offered to a user, in tour order. The security officer role gets every available chapter; other
 * built-in roles get their list (united when several are held); custom roles count only when no built-in role is held.
 */
export function recommendedChapters(
  roles: { key: string }[],
  canAny: (perm: string) => boolean,
  permissions: string[],
): ChapterId[] {
  const available = (c: ChapterId) => c === "welcome" || CHAPTER_GATES[c].some(canAny)
  const keys = new Set(roles.map((r) => r.key))
  let wanted: Set<ChapterId>
  if (keys.has("security_officer")) {
    wanted = new Set(CHAPTER_ORDER)
  } else if ([...keys].some((k) => k in BY_ROLE)) {
    wanted = new Set([...keys].flatMap((k) => BY_ROLE[k] ?? []))
  } else {
    const areas = new Set(permissions.map((p) => WRITE.exec(p)?.[1]).filter((a): a is string => !!a))
    const written = CHAPTER_ORDER.filter((c) => available(c) && CHAPTER_GATES[c].some((g) => areas.has(g.split(".")[0])))
    wanted = new Set<ChapterId>(["welcome", ...(written.length ? written : ["programme" as const])])
  }
  return CHAPTER_ORDER.filter((c) => wanted.has(c) && available(c))
}
