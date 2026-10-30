import { expect, test } from "@playwright/test"
import { recommendedChapters } from "../src/tour/recommend"
import { afterRun } from "../src/tour/state"
import { CHAPTER_ORDER, type ChapterId } from "../src/tour/types"

// No browser: the pure functions behind the tour recommendation and the stored state.
const READS = [
  "entities.read", "catalog.read", "assessments.read", "findings.read", "projects.read", "workpackages.read",
  "tasks.read", "documents.read", "regulations.read", "governance.read", "risks.read", "assets.read",
  "suppliers.read", "controls.read", "audits.read", "incidents.read",
]
// The built-in roles of backend/app/core/permissions.py, as far as chapter gates look at them.
const PERMS: Record<string, string[]> = {
  admin: [...READS, "audit.read", "ai.use", "users.manage", "roles.manage", "settings.manage", "entities.manage", "assessments.edit", "findings.manage", "risks.manage"],
  security_officer: [...READS, "audit.read", "ai.use", "users.manage", "entities.manage", "assessments.edit", "findings.manage", "risks.manage"],
  project_manager: [...READS, "audit.read", "projects.manage", "findings.manage", "documents.upload", "controls.manage", "ai.use"],
  assessor: [...READS, "audit.read", "assessments.edit", "findings.manage", "documents.upload", "incidents.manage", "risks.manage", "ai.use"],
  contributor: [
    "entities.read", "catalog.read", "assessments.read", "assessments.edit", "findings.read", "projects.read", "workpackages.read",
    "documents.read", "documents.upload", "regulations.read", "incidents.read", "governance.read", "risks.read", "assets.read",
    "suppliers.read", "controls.read", "audits.read", "ai.use",
  ],
  viewer: [...READS, "ai.use"],
  auditor: [...READS, "audit.read"],
}

function recommend(roleKeys: string[], extra: string[] = []): ChapterId[] {
  const permissions = [...new Set([...roleKeys.flatMap((k) => PERMS[k] ?? []), ...extra])]
  return recommendedChapters(roleKeys.map((key) => ({ key })), (p) => permissions.includes(p), permissions)
}

test.describe("recommendedChapters", () => {
  test("the security officer gets every chapter its permissions allow, in order", () => {
    const got = recommend(["security_officer"])
    expect(got).toEqual(CHAPTER_ORDER)
  })
  test("the other built-in roles get their list", () => {
    expect(recommend(["admin"])).toEqual(["welcome", "programme", "admin"])
    expect(recommend(["project_manager"])).toEqual(["welcome", "project", "quality"])
    expect(recommend(["assessor"])).toEqual(["welcome", "answer", "assess", "risks", "incidents"])
    expect(recommend(["contributor"])).toEqual(["welcome", "answer"])
    expect(recommend(["viewer"])).toEqual(["welcome", "programme", "documents"])
    expect(recommend(["auditor"])).toEqual(["welcome", "programme", "audits", "documents"])
  })
  test("several roles give the union in tour order", () => {
    expect(recommend(["assessor", "contributor"])).toEqual(["welcome", "answer", "assess", "risks", "incidents"])
    expect(recommend(["viewer", "project_manager"])).toEqual(["welcome", "programme", "project", "documents", "quality"])
  })
  test("the security officer role wins over other roles", () => {
    expect(recommend(["viewer", "security_officer"])).toEqual(CHAPTER_ORDER)
  })
  test("a custom role with a write permission adds that area", () => {
    expect(recommend(["clerk"], ["risks.manage", "risks.read", "governance.read"])).toEqual(["welcome", "risks"])
    expect(recommend(["clerk"], ["documents.upload", "documents.read"])).toEqual(["welcome", "documents"])
  })
  test("a custom role with only reads gets the programme, if it can read governance", () => {
    expect(recommend(["clerk"], ["risks.read", "governance.read"])).toEqual(["welcome", "programme"])
    expect(recommend(["clerk"], ["risks.read"])).toEqual(["welcome"])
  })
  test("a write permission without read access does not make the chapter available", () => {
    expect(recommend(["clerk"], ["risks.manage", "governance.read"])).toEqual(["welcome", "programme"])
  })
  test("custom roles add nothing to a built-in role", () => {
    expect(recommend(["contributor", "clerk"], ["risks.manage"])).toEqual(["welcome", "answer"])
  })
})

test.describe("afterRun", () => {
  const rec: ChapterId[] = ["welcome", "answer"]
  test("a partial run is started, a complete one is done", () => {
    expect(afterRun(null, ["welcome"], rec)).toEqual({ version: 1, status: "started", chapters_done: ["welcome"] })
    expect(afterRun({ version: 1, status: "started", chapters_done: ["welcome"] }, ["answer"], rec))
      .toEqual({ version: 1, status: "done", chapters_done: ["welcome", "answer"] })
  })
  test("done and dismissed never go back to started", () => {
    expect(afterRun({ version: 1, status: "done", chapters_done: ["welcome", "answer"] }, [], rec).status).toBe("done")
    expect(afterRun({ version: 1, status: "dismissed", chapters_done: [] }, ["welcome"], rec).status).toBe("dismissed")
  })
  test("chapters done in an older version are ignored", () => {
    expect(afterRun({ version: 0, status: "done", chapters_done: ["welcome", "answer"] }, [], rec))
      .toEqual({ version: 1, status: "started", chapters_done: [] })
  })
  test("unknown ids are kept out", () => {
    expect(afterRun(null, ["welcome", "bogus" as ChapterId], rec).chapters_done).toEqual(["welcome"])
  })
})
