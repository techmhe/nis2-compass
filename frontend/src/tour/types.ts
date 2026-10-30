export type ChapterId =
  | "welcome" | "answer" | "assess" | "programme" | "project" | "risks" | "controls"
  | "audits" | "incidents" | "suppliers" | "inventory" | "documents" | "quality" | "admin"

export const CHAPTER_ORDER: ChapterId[] = [
  "welcome", "answer", "assess", "programme", "project", "risks", "controls",
  "audits", "incidents", "suppliers", "inventory", "documents", "quality", "admin",
]

/** Data a detail-page route can depend on; resolved from what the user can see. */
export interface TourContext {
  firstProjectId: number | null
  firstAssessmentId: number | null
  firstRiskId: number | null
  firstIncidentId: number | null
  firstSupplierId: number | null
}

export interface TourStep {
  /** Anchor is the element with `data-tour="<chapter>.<name>"` (a token of the space-separated attribute). */
  name: string
  /** Path to be on; a function may return null when the data it needs does not exist (the step is skipped). */
  route: string | ((ctx: TourContext) => string | null)
  /** A user without this permission (held anywhere) skips the step. */
  perm?: string
  /** At most 6 words. */
  title: string
  /** At most 2 sentences, plain English, UI elements named by their visible label. */
  body: string
}

export interface TourChapter {
  id: ChapterId
  title: string
  /** Any-of; the same values as CHAPTER_GATES. */
  gate: string[]
  steps: TourStep[]
}
