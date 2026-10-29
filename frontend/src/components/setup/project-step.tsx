import { useEffect, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"
import { Code, Section } from "@/components/common/basics"
import { Field, Segmented } from "@/components/common/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, ApiError } from "@/lib/api"
import { fmtDate } from "@/lib/format"

export interface ProjectDraft {
  name: string
  start: string
  /** null = the proposed end date applies and the field follows it. */
  end: string | null
  capacity: "part_time" | "dedicated"
  assessment: "sequential" | "parallel"
  starting_point: "none" | "partial" | "iso27001"
  external_support: boolean
  /** Gate dates the user typed; the server applies them on top of the computed ones. */
  gates: Record<string, string>
}

export interface PlanPreview {
  proposed_end: string
  end: string
  earliest_end: string
  fit_factor: number
  warning: string | null
  phases: { name: string; start: string; finish: string }[]
  gates: { code: string; decision: string; date: string }[]
}

export interface PlanState {
  data: PlanPreview | undefined
  /** The shown data answers the current inputs. */
  ready: boolean
  loading: boolean
  /** Field errors of a 422, keyed "start", "end", "name", "gates.Gate 2". */
  fieldErrors: Record<string, string>
  failure: string | null
}

export const DEFAULT_NAME = "NIS2 Implementation"
const DEBOUNCE_MS = 300

export function nextMonday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7))
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function blankProject(): ProjectDraft {
  return { name: DEFAULT_NAME, start: nextMonday(), end: null, capacity: "part_time", assessment: "parallel", starting_point: "partial", external_support: false, gates: {} }
}

export function projectProblems(d: ProjectDraft): Record<string, string> {
  const e: Record<string, string> = {}
  const name = d.name.trim()
  if (!name) e["name"] = "Project name is required"
  else if (name.length > 200) e["name"] = "At most 200 characters"
  if (!d.start) e["start"] = "Start date is required"
  return e
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** The request body of the plan (also the cache key); the server computes every date. */
export function projectBody(d: ProjectDraft) {
  return {
    name: d.name.trim(), start: d.start, end: d.end || undefined, capacity: d.capacity, assessment: d.assessment,
    starting_point: d.starting_point, external_support: d.external_support, gates: d.gates,
  }
}

/** The schedule for the current answers from `POST /setup/plan-preview`, debounced; keeps the last good one on screen. */
export function usePlanPreview(draft: ProjectDraft, companies: number, enabled: boolean): PlanState {
  const key = JSON.stringify({ ...projectBody(draft), companies })
  const debounced = useDebounced(key, DEBOUNCE_MS)
  const valid = enabled && Object.keys(projectProblems(draft)).length === 0
  const q = useQuery({
    queryKey: ["setup-plan-preview", debounced],
    queryFn: () => api.post<PlanPreview>("/setup/plan-preview", JSON.parse(debounced)),
    enabled: valid,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const lastGood = useRef<PlanPreview | undefined>(undefined)
  if (q.data && !q.isPlaceholderData) lastGood.current = q.data

  const fieldErrors: Record<string, string> = {}
  let failure: string | null = null
  if (valid && key === debounced && q.error) {
    const items = q.error instanceof ApiError && q.error.status === 422 ? (q.error.detail as { errors?: unknown } | null)?.errors : null
    if (Array.isArray(items)) {
      for (const it of items as { loc?: (string | number)[]; msg?: string }[]) {
        const msg = (it.msg ?? "Invalid value").replace(/^Value error, /, "")
        const path = (it.loc ?? []).slice(1).map(String)
        const k = path[0] === "gates" && path.length === 2 ? `gates.${path[1]}` : path.length === 1 ? path[0] : null
        if (k) fieldErrors[k] = msg
        else failure = failure ? `${failure}. ${msg}` : msg
      }
    } else {
      failure = q.error instanceof ApiError && q.error.status === 409
        ? "Setup was already completed by someone else. Reload to sign in."
        : "The plan could not be calculated. Check the connection and change an answer to try again."
    }
  }
  const ready = valid && key === debounced && q.isSuccess && !q.isPlaceholderData && !q.isFetching
  return { data: q.data ?? lastGood.current, ready, loading: valid && !q.isError && !ready, fieldErrors, failure }
}

function Choice<T extends string | boolean>({ label, hint, value, options, onChange }: {
  label: string
  hint: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <div role="group" aria-label={label}>
        <Segmented value={options.find((o) => o.value === value)?.label} options={options.map((o) => o.label)}
          onChange={(l) => { const o = options.find((x) => x.label === l); if (o) onChange(o.value) }} />
      </div>
    </Field>
  )
}

const PHASE_TONES = ["var(--petrol)", "var(--brass)", "var(--sage)", "var(--score-2)", "var(--ink-3)", "var(--score-5)"]

/** One bar, each phase placed and sized by its dates on a shared scale (layout only, the dates come from the server). */
function PhaseBar({ phases }: { phases: PlanPreview["phases"] }) {
  const t = (s: string) => Date.parse(s)
  const from = Math.min(...phases.map((p) => t(p.start)))
  const to = Math.max(...phases.map((p) => t(p.finish)))
  const span = Math.max(to - from, 1)
  return (
    <div>
      <div role="img" aria-label="Phases to scale" className="relative h-3 overflow-hidden rounded-[4px] bg-muted">
        {phases.map((p, i) => (
          <div key={p.name} title={`${p.name}: ${fmtDate(p.start)} to ${fmtDate(p.finish)}`} className="absolute inset-y-0 border-r border-card opacity-90"
            style={{ left: `${((t(p.start) - from) / span) * 100}%`, width: `${Math.max(((t(p.finish) - t(p.start)) / span) * 100, 0.8)}%`, background: PHASE_TONES[i % PHASE_TONES.length] }} />
        ))}
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
        {phases.map((p, i) => (
          <li key={p.name} className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: PHASE_TONES[i % PHASE_TONES.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{p.name}</span>
            <span className="tabular shrink-0 text-ink-3">{fmtDate(p.start)} to {fmtDate(p.finish)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProjectStep({ draft, plan, errors, recalculated, onChange, onGate }: {
  draft: ProjectDraft
  plan: PlanState
  /** Errors of the last setup request, keyed "project.start", "project.gates.Gate 2". */
  errors: Record<string, string>
  recalculated: boolean
  /** `recalc`: the change re-plans, so typed gate dates are dropped. */
  onChange: (patch: Partial<ProjectDraft>, recalc?: boolean) => void
  onGate: (code: string, date: string) => void
}) {
  const problems = projectProblems(draft)
  const err = (k: string) => problems[k] ?? plan.fieldErrors[k] ?? errors[`project.${k}`]
  const data = plan.data
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-3">
        The project plan is calculated from the start date, the end date and four questions about your organisation. You can change all of it later.
      </p>
      <Section title="Project" bodyClassName="grid gap-3 sm:grid-cols-6">
        <Field label="Project name" htmlFor="pj-name" className="sm:col-span-6">
          <Input id="pj-name" value={draft.name} maxLength={200} aria-invalid={!!err("name")} aria-describedby={err("name") ? "pj-name-error" : undefined}
            onChange={(e) => onChange({ name: e.target.value })} />
          {err("name") && <p id="pj-name-error" role="alert" className="text-[12px] text-alarm">{err("name")}</p>}
        </Field>
        <Field label="Start date" htmlFor="pj-start" className="sm:col-span-3">
          <Input id="pj-start" type="date" value={draft.start} aria-invalid={!!err("start")} aria-describedby={err("start") ? "pj-start-error" : undefined}
            onChange={(e) => onChange({ start: e.target.value }, true)} />
          {err("start") && <p id="pj-start-error" role="alert" className="text-[12px] text-alarm">{err("start")}</p>}
        </Field>
        <Field label="End date" htmlFor="pj-end" className="sm:col-span-3"
          hint={data ? <>Proposed: <span className="tabular">{fmtDate(data.proposed_end)}</span></> : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="pj-end" type="date" value={draft.end ?? data?.proposed_end ?? ""} aria-invalid={!!err("end")}
              aria-describedby={err("end") ? "pj-end-error" : undefined} className="w-44"
              onChange={(e) => onChange({ end: e.target.value || null }, true)} />
            {draft.end !== null && <Button size="sm" variant="outline" onClick={() => onChange({ end: null }, true)}>Use proposed end date</Button>}
          </div>
          {err("end") && <p id="pj-end-error" role="alert" className="text-[12px] text-alarm">{err("end")}</p>}
        </Field>
      </Section>

      <Section title="Sizing" bodyClassName="grid gap-4 sm:grid-cols-2">
        <Choice label="Capacity" hint="How much time the team can give the project."
          value={draft.capacity} onChange={(capacity) => onChange({ capacity }, true)}
          options={[{ value: "part_time", label: "Part-time" }, { value: "dedicated", label: "Dedicated" }]} />
        <Choice label="Assessment" hint="Companies assessed one after another or at the same time."
          value={draft.assessment} onChange={(assessment) => onChange({ assessment }, true)}
          options={[{ value: "sequential", label: "Sequential" }, { value: "parallel", label: "Parallel" }]} />
        <Choice label="Starting point" hint="How much of an ISMS exists today."
          value={draft.starting_point} onChange={(starting_point) => onChange({ starting_point }, true)}
          options={[{ value: "none", label: "None" }, { value: "partial", label: "Partial" }, { value: "iso27001", label: "ISO 27001" }]} />
        <Choice label="External support" hint="Whether external advisers help with the assessments and the policies."
          value={draft.external_support} onChange={(external_support) => onChange({ external_support }, true)}
          options={[{ value: false, label: "No" }, { value: true, label: "Yes" }]} />
      </Section>

      {plan.failure && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-alarm/30 bg-alarm-50 px-3 py-2 text-[13px] text-alarm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{plan.failure}</span>
        </div>
      )}
      {data?.warning && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber/30 bg-amber-50 px-3 py-2 text-[13px] text-amber">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{data.warning}</span>
        </div>
      )}

      {data && (
        <Section title="Timeline" bodyClassName="space-y-4" actions={plan.loading ? <span className="text-[12px] text-ink-3">Calculating…</span> : undefined}>
          <PhaseBar phases={data.phases} />
          <div>
            <h3 className="mb-1 text-[12.5px] font-medium text-ink-2">Gates</h3>
            {recalculated && <p role="status" className="mb-1 text-[12px] text-ink-3">Gate dates were recalculated.</p>}
            <ul className="divide-y">
              {data.gates.map((g) => {
                const gerr = err(`gates.${g.code}`)
                return (
                  <li key={g.code} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_9.5rem]">
                    <Code>{g.code}</Code>
                    <span className="min-w-0 break-words text-[13px] text-ink-2">{g.decision}</span>
                    <Input type="date" aria-label={`${g.code} date`} value={draft.gates[g.code] ?? g.date} aria-invalid={!!gerr}
                      className="col-span-2 h-8 sm:col-span-1" onChange={(e) => e.target.value && onGate(g.code, e.target.value)} />
                    {gerr && <p role="alert" className="col-span-2 text-[12px] text-alarm sm:col-span-3">{gerr}</p>}
                  </li>
                )
              })}
            </ul>
          </div>
        </Section>
      )}
    </div>
  )
}
