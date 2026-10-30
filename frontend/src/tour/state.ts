import { CHAPTER_ORDER, type ChapterId } from "./types"

export const TOUR_VERSION = 1

export type TourStatus = "started" | "done" | "dismissed"
export interface TourState { version: number; status: TourStatus; chapters_done: ChapterId[] }

const STATUSES: TourStatus[] = ["started", "done", "dismissed"]
const known = (ids: unknown[]): ChapterId[] => CHAPTER_ORDER.filter((c) => ids.includes(c))

/** The stored tour state, or null when there is none or it does not have the expected shape. */
export function readTourState(prefs: Record<string, unknown>): TourState | null {
  const t = prefs?.tour as Partial<TourState> | undefined
  if (!t || typeof t !== "object") return null
  if (typeof t.version !== "number" || !STATUSES.includes(t.status as TourStatus) || !Array.isArray(t.chapters_done)) return null
  return { version: t.version, status: t.status as TourStatus, chapters_done: known(t.chapters_done) }
}

/** No state, or one from an older tour version. */
export function shouldAutoStart(state: TourState | null): boolean {
  return state === null || state.version < TOUR_VERSION
}

/** The state after a run. Chapters done in an older version are ignored; done and dismissed never go back to started. */
export function afterRun(prev: TourState | null, completed: ChapterId[], recommended: ChapterId[]): TourState {
  const current = prev && prev.version === TOUR_VERSION ? prev : null
  const done = known([...(current?.chapters_done ?? []), ...completed])
  const all = recommended.length > 0 && recommended.every((c) => done.includes(c))
  const status: TourStatus = all ? "done" : current && current.status !== "started" ? current.status : "started"
  return { version: TOUR_VERSION, status, chapters_done: done }
}
