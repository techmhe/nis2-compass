import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useAssistant } from "@/components/assistant/provider"
import { useAuth } from "@/hooks/useAuth"
import { ApiError, api } from "@/lib/api"
import type { Me } from "@/lib/types"
import { CHAPTERS } from "./chapters"
import { recommendedChapters } from "./recommend"
import { TOUR_VERSION, afterRun, readTourState, shouldAutoStart, type TourState } from "./state"
import { TourLayer } from "./TourPopover"
import type { ChapterId, TourContext, TourStep } from "./types"

const ANCHOR_WAIT_MS = 5000
const MINUTES_PER_STEP = 0.25
const NO_CONTEXT: TourContext = { firstProjectId: null, firstAssessmentId: null, firstRiskId: null, firstIncidentId: null, firstSupplierId: null }
const ENDED = "Tour ended. Restart it from Help any time."

interface PlannedStep { chapter: ChapterId; step: TourStep }
interface Run {
  steps: PlannedStep[]
  recommended: ChapterId[]
  intro: { chapters: number; minutes: number } | null
  ctx: TourContext
}
/** intro: welcome card; locating: navigating to the step's route and waiting for its anchor; showing: popover open. */
interface View { run: Run; phase: "intro" | "locating" | "showing"; index: number; dir: 1 | -1; skipped: number[] }

interface TourApi {
  /** Runs the given chapters (those that exist); `intro` opens with the welcome card. */
  start: (chapters: ChapterId[], opts?: { intro?: boolean }) => void
  active: boolean
  /** The chapters offered to the current user that exist in the registry. */
  recommended: ChapterId[]
}
const Ctx = createContext<(TourApi & { autoStart: () => void }) | null>(null)

const anchorKey = (p: PlannedStep) => `${p.chapter}.${p.step.name}`

function findAnchor(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour~="${key}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

/**
 * Resolves with the anchor once `ready` (the step's route is committed) and the anchor is on screen, or null.
 * The route gets ANCHOR_WAIT_MS to commit, and the anchor ANCHOR_WAIT_MS from then on.
 */
function waitForAnchor(key: string, isCancelled: () => boolean, ready: () => boolean): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let timer = 0
    let arrived = false
    const observer = new MutationObserver(check)
    function done(el: HTMLElement | null) {
      observer.disconnect()
      clearTimeout(timer)
      resolve(el)
    }
    function check() {
      if (isCancelled()) return done(null)
      if (!ready()) return
      if (!arrived) {
        arrived = true
        clearTimeout(timer)
        timer = window.setTimeout(() => done(findAnchor(key)), ANCHOR_WAIT_MS)
      }
      const el = findAnchor(key)
      if (el) done(el)
    }
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    timer = window.setTimeout(() => done(ready() ? findAnchor(key) : null), ANCHOR_WAIT_MS)
    check()
  })
}

/** The nearest step in a direction that is not known to be skipped, or null at the end. */
function nextIndex(v: View, from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < v.run.steps.length; i += dir) if (!v.skipped.includes(i)) return i
  return null
}

const pathOf = (route: string) => route.split(/[?#]/)[0]

/**
 * The engine's own navigation. react-router commits a navigation later, inside a transition, so until the step's
 * path is committed the old page is still on screen (and may carry an anchor with the same key, e.g. a tab link).
 */
interface EngineNav {
  /** The path the current step needs. */
  target: string | null
  /** The committed path is the target (or a page redirected from it). */
  arrived: boolean
  /** Paths the engine navigated to that have not been committed yet. */
  pending: string[]
}
const idleNav = (): EngineNav => ({ target: null, arrived: true, pending: [] })

export function TourProvider({ children }: { children: ReactNode }) {
  const { me, canAny } = useAuth()
  const qc = useQueryClient()
  const { close: closeAssistant } = useAssistant()
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  // Latest known state, ahead of the server when a save failed, so every save carries the full state.
  const local = useRef<{ state: TourState | null } | null>(null)
  const autoTried = useRef<number | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const startToken = useRef(0)
  // A start is loading its context; the automatic start must not replace a run the user asked for.
  const starting = useRef(false)
  const nav = useRef<EngineNav>(idleNav())
  const committedPath = useRef(location.pathname)

  const recommended = useMemo(
    () => (me ? recommendedChapters(me.roles, canAny, me.permissions).filter((c) => CHAPTERS[c]) : []),
    [me, canAny],
  )
  const currentState = useCallback(
    () => (local.current ? local.current.state : me ? readTourState(me.preferences) : null),
    [me],
  )

  const save = useCallback((state: TourState) => {
    local.current = { state }
    qc.setQueryData<Me | null>(["me"], (m) => (m ? { ...m, preferences: { ...m.preferences, tour: state } } : m))
    api.patch("/auth/me", { preferences: { tour: state } }).catch((e) => {
      if (e instanceof ApiError && e.status === 422) console.error("The tour state was rejected by the server", e.detail)
    })
  }, [qc])

  const close = useCallback(() => {
    // Cleared at once, so a second end in the same event (popstate and the location change) is a no-op.
    viewRef.current = null
    setView(null)
    nav.current = idleNav()
    const back = returnFocus.current
    returnFocus.current = null
    if (back?.isConnected) back.focus()
    else document.querySelector<HTMLElement>("main")?.focus()
  }, [])

  /** Ends the run. `complete`: the last step was passed; otherwise the user ended early. */
  const finish = useCallback((complete: boolean, from?: View) => {
    const v = from ?? viewRef.current
    if (!v) return
    const passed = complete ? v.run.steps.length : v.phase === "intro" ? 0 : v.index
    const chapters = [...new Set(v.run.steps.map((s) => s.chapter))]
    const completed = chapters.filter((c) => {
      const idx = v.run.steps.flatMap((s, i) => (s.chapter === c ? [i] : []))
      return idx.every((i) => i < passed) && idx.some((i) => !v.skipped.includes(i))
    })
    const shown = v.run.steps.some((_, i) => i < passed && !v.skipped.includes(i))
    close()
    if (complete && !shown) { toast("Nothing to show here yet."); return }
    const prev = currentState()
    const next = afterRun(prev, completed, v.run.recommended)
    if (JSON.stringify(prev) !== JSON.stringify(next)) save(next)
    if (!complete) toast(ENDED)
  }, [close, currentState, save])

  const notNow = useCallback(() => {
    const prev = currentState()
    close()
    save({ version: TOUR_VERSION, status: "dismissed", chapters_done: prev?.version === TOUR_VERSION ? prev.chapters_done : [] })
    toast(ENDED)
  }, [close, currentState, save])

  const loadContext = useCallback(async (): Promise<TourContext> => {
    const first = async (perm: string, path: string): Promise<number | null> => {
      if (!canAny(perm)) return null
      try {
        const rows = await qc.fetchQuery({ queryKey: ["tour", path], queryFn: () => api.get<{ id: number }[]>(path), staleTime: 60_000 })
        return rows[0]?.id ?? null
      } catch {
        return null
      }
    }
    return {
      firstProjectId: await first("projects.read", "/projects"),
      firstAssessmentId: await first("assessments.read", "/assessments"),
      firstRiskId: await first("risks.read", "/risks"),
      firstIncidentId: await first("incidents.read", "/incidents"),
      firstSupplierId: await first("suppliers.read", "/suppliers"),
    }
  }, [canAny, qc])

  const start = useCallback((chapters: ChapterId[], opts?: { intro?: boolean }) => {
    if (viewRef.current || !me) return
    const steps = chapters.flatMap((id) => {
      const chapter = CHAPTERS[id]
      return chapter ? chapter.steps.filter((s) => !s.perm || canAny(s.perm)).map((step) => ({ chapter: id, step })) : []
    })
    const token = ++startToken.current
    starting.current = true
    void (async () => {
      const ctx = steps.some((s) => typeof s.step.route === "function") ? await loadContext() : NO_CONTEXT
      if (token !== startToken.current) return
      starting.current = false
      if (viewRef.current) return
      if (steps.length === 0) { toast("Nothing to show here yet."); return }
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // The open window would cover the launcher, which the Assistant step points at; its conversation stays.
      closeAssistant()
      const present = [...new Set(steps.map((s) => s.chapter))]
      const intro = opts?.intro ? { chapters: present.length, minutes: Math.max(1, Math.ceil(steps.length * MINUTES_PER_STEP)) } : null
      setView({ run: { steps, recommended, intro, ctx }, phase: intro ? "intro" : "locating", index: 0, dir: 1, skipped: [] })
    })()
  }, [me, canAny, loadContext, recommended, closeAssistant])

  const autoStart = useCallback(() => {
    if (!me || me.must_change_password || viewRef.current || autoTried.current === me.id) return
    autoTried.current = me.id
    if (starting.current) return
    const state = currentState()
    if (!shouldAutoStart(state)) return
    if (recommended.length === 0) return
    // Stored first, so a reload or a closed browser never starts the tour again for this version.
    save({ version: TOUR_VERSION, status: "started", chapters_done: [] })
    start(recommended, { intro: true })
  }, [me, currentState, recommended, save, start])

  const skipCurrent = useCallback(() => {
    const v = viewRef.current
    if (!v) return
    const skipped = [...v.skipped, v.index]
    const marked = { ...v, skipped }
    let j = nextIndex(marked, v.index, v.dir)
    let dir = v.dir
    if (j === null && dir === -1) { dir = 1; j = nextIndex(marked, v.index, 1) }
    if (j === null) { finish(true, marked); return }
    setView({ ...marked, phase: "locating", index: j, dir })
  }, [finish])

  const next = useCallback(() => {
    const v = viewRef.current
    if (!v) return
    if (v.phase === "intro") { setView({ ...v, phase: "locating" }); return }
    const j = nextIndex(v, v.index, 1)
    if (j === null) finish(true)
    else setView({ ...v, phase: "locating", index: j, dir: 1 })
  }, [finish])

  const back = useCallback(() => {
    const v = viewRef.current
    if (!v || v.phase !== "showing") return
    const j = nextIndex(v, v.index, -1)
    if (j !== null) setView({ ...v, phase: "locating", index: j, dir: -1 })
  }, [])

  const end = useCallback(() => {
    if (viewRef.current?.phase === "intro") notNow()
    else finish(false)
  }, [finish, notNow])

  // Locate the current step: go to its route, wait for its anchor, skip it when there is none.
  // Runs once per step: `navigate` changes with every committed path, and re-running on that would navigate back
  // to the step's route after a page redirected away from it (and redirect again, forever).
  const locatingKey = view?.phase === "locating" ? `${view.index}:${view.run.steps.length}:${view.skipped.length}` : null
  const locateDeps = useRef({ navigate, skipCurrent })
  locateDeps.current = { navigate, skipCurrent }
  useEffect(() => {
    const skipCurrent = () => locateDeps.current.skipCurrent()
    const v = viewRef.current
    if (!v || v.phase !== "locating") return
    let cancelled = false
    const planned = v.run.steps[v.index]
    void (async () => {
      const route = typeof planned.step.route === "function" ? planned.step.route(v.run.ctx) : planned.step.route
      if (!route) return skipCurrent()
      const path = pathOf(route)
      const n = nav.current
      n.target = path
      if (path !== committedPath.current || n.pending.length > 0) {
        n.arrived = false
        n.pending.push(path)
        locateDeps.current.navigate(route)
      } else {
        n.arrived = true
      }
      const el = await waitForAnchor(anchorKey(planned), () => cancelled, () => nav.current.arrived)
      if (cancelled) return
      if (!el) {
        if (import.meta.env.DEV) console.warn(`Tour: anchor "${anchorKey(planned)}" not found, step skipped`)
        return skipCurrent()
      }
      // An element taller than most of the screen (a long table) is shown from its start, not from its middle.
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6
      el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest" })
      setView((cur) => (cur && cur.phase === "locating" && cur.index === v.index ? { ...cur, phase: "showing" } : cur))
    })()
    return () => { cancelled = true }
  }, [locatingKey])

  // Leaving the page by the sidebar, a link or the back button ends the tour in every phase; the engine's own
  // navigation does not, nor does a page redirecting itself (e.g. /reports to /reports/management), which replaces the
  // history entry. A layout effect, so the arrival is known before the new page's DOM changes are observed.
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (committedPath.current === location.pathname) return
    committedPath.current = location.pathname
    const n = nav.current
    const own = n.pending.indexOf(location.pathname)
    if (own >= 0) {
      n.pending.splice(0, own + 1)
      n.arrived = location.pathname === n.target
      return
    }
    if (navigationType === "REPLACE") return
    if (viewRef.current) end()
  }, [location.pathname, navigationType, end])

  const handlers = useRef({ next, back, end })
  handlers.current = { next, back, end }
  const running = view !== null
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); handlers.current.end(); return }
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return
      const phase = viewRef.current?.phase
      if (phase === "locating") return
      if (e.key === "ArrowRight" || (e.key === "Enter" && !t?.closest("button, a"))) { e.preventDefault(); handlers.current.next() }
      else if (e.key === "ArrowLeft" && phase === "showing") { e.preventDefault(); handlers.current.back() }
    }
    // The engine only pushes, so a history traversal is the user's back or forward button. It ends the tour even
    // while the engine's own navigation is still loading: that one is then dropped and never committed.
    const onPop = () => handlers.current.end()
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("popstate", onPop)
    }
  }, [running])

  const value = useMemo(() => ({ start, active: running, recommended, autoStart }), [start, running, recommended, autoStart])

  let layer: ReactNode = null
  if (view && view.phase !== "locating") {
    const planned = view.run.steps[view.index]
    const skippedBefore = view.skipped.filter((i) => i <= view.index).length
    layer = (
      <TourLayer
        intro={view.phase === "intro" ? view.run.intro : null}
        step={view.phase === "showing" ? planned.step : null}
        anchor={anchorKey(planned)}
        n={view.index + 1 - skippedBefore}
        m={view.run.steps.length - view.skipped.length}
        canBack={nextIndex(view, view.index, -1) !== null}
        isLast={nextIndex(view, view.index, 1) === null}
        onNext={next} onBack={back} onEnd={end} onNotNow={notNow}
      />
    )
  }
  return <Ctx.Provider value={value}>{children}{layer}</Ctx.Provider>
}

export function useTour(): TourApi {
  const v = useContext(Ctx)
  if (!v) throw new Error("useTour outside TourProvider")
  return { start: v.start, active: v.active, recommended: v.recommended }
}

/** The Dashboard calls this once it has loaded; it starts the tour for a user who has not been offered it yet. */
export function useTourAutoStart(ready: boolean) {
  const v = useContext(Ctx)
  const autoStart = v?.autoStart
  useEffect(() => { if (ready) autoStart?.() }, [ready, autoStart])
}
