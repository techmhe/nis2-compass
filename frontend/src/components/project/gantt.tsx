import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react"
import { useNavigate } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  addDays, differenceInCalendarDays, eachMonthOfInterval, eachWeekOfInterval, eachYearOfInterval, endOfWeek, format,
  getISOWeek, max as maxDate, min as minDate, parseISO, startOfWeek,
} from "date-fns"
import { ChevronDown, ChevronRight, Crosshair, Diamond } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, ErrorState, Loading } from "@/components/common/basics"
import { Segmented } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate, pct } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useActivityPatch } from "./plan"
import { projectKeys, ScheduleDot, type GanttData, type GanttRow } from "./shared"

type Zoom = "Weeks" | "Months"
const PX_PER_DAY: Record<Zoom, number> = { Weeks: 6, Months: 2 }
const ROW_H = 30
const HEAD_H = 46
const LABEL_W = 320
const EDGE = 7

type Line =
  | { kind: "gates" }
  | { kind: "group"; name: string; rows: GanttRow[] }
  | { kind: "row"; row: GanttRow }

interface Drag {
  id: number
  mode: "move" | "start" | "end"
  originX: number
  start: Date
  finish: Date
  delta: number
  moved: boolean
}

const TONE: Record<string, string> = {
  Completed: "var(--sage)", Blocked: "var(--alarm)", Red: "var(--alarm)", Amber: "var(--amber)", Green: "var(--petrol)", "Not Planned": "var(--ink-3)",
}

function toneOf(r: GanttRow): string {
  if (r.status === "Completed") return TONE.Completed
  if (r.status === "Blocked") return TONE.Blocked
  return TONE[r.schedule_status] ?? TONE.Green
}

function stateLabel(r: GanttRow): string {
  if (r.status === "Completed") return "Completed"
  if (r.status === "Blocked") return "Blocked"
  return { Red: "Overdue", Amber: "Finishing soon", Green: "On schedule", "Not Planned": "Not planned" }[r.schedule_status] ?? r.schedule_status
}

function readZoom(): Zoom {
  try {
    return localStorage.getItem("gantt-zoom") === "Months" ? "Months" : "Weeks"
  } catch {
    return "Weeks"
  }
}

export function ProjectGantt({ projectId }: { projectId: number }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: projectKeys.gantt(projectId), queryFn: () => api.get<GanttData>(`/projects/${projectId}/gantt`) })
  const patch = useActivityPatch(projectId)
  const [zoom, setZoomState] = useState<Zoom>(readZoom)
  const [showWPs, setShowWPs] = useState(true)
  const [showDeps, setShowDeps] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  const ppd = PX_PER_DAY[zoom]
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const setZoom = (z: Zoom) => {
    setZoomState(z)
    try { localStorage.setItem("gantt-zoom", z) } catch { /* ignore */ }
  }

  const data = q.data
  const range = useMemo(() => {
    const ds: Date[] = [today]
    for (const r of data?.rows ?? []) {
      if (r.planned_start) ds.push(parseISO(r.planned_start))
      if (r.planned_finish) ds.push(parseISO(r.planned_finish))
    }
    for (const g of data?.gates ?? []) if (g.planned_date) ds.push(parseISO(g.planned_date))
    if (data?.project.planned_start) ds.push(parseISO(data.project.planned_start))
    if (data?.project.planned_finish) ds.push(parseISO(data.project.planned_finish))
    const start = startOfWeek(addDays(minDate(ds), -7), { weekStartsOn: 1 })
    const end = endOfWeek(addDays(maxDate(ds), 21), { weekStartsOn: 1 })
    return { start, end, days: differenceInCalendarDays(end, start) + 1 }
  }, [data, today])
  const totalW = range.days * ppd
  const x = (d: Date) => differenceInCalendarDays(d, range.start) * ppd

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [{ kind: "gates" }]
    const groups = new Map<string, { sort: number; rows: GanttRow[] }>()
    for (const r of data?.rows ?? []) {
      if (r.type === "work_package" && !showWPs) continue
      const name = r.type === "work_package" ? "Work packages" : r.phase?.name ?? "Unassigned"
      const sort = r.type === "work_package" ? 10_000 : r.phase?.sort_order ?? 9_999
      const g = groups.get(name) ?? { sort, rows: [] }
      g.rows.push(r)
      groups.set(name, g)
    }
    for (const [name, g] of [...groups.entries()].sort((a, b) => a[1].sort - b[1].sort)) {
      out.push({ kind: "group", name, rows: g.rows })
      if (!collapsed.has(name)) g.rows.forEach((row) => out.push({ kind: "row", row }))
    }
    return out
  }, [data, showWPs, collapsed])

  /** Effective dates of a row, taking an ongoing drag into account. */
  const datesOf = (r: GanttRow): { s: Date; f: Date } | null => {
    if (drag && r.type === "activity" && r.id === drag.id) {
      const s = drag.mode === "end" ? drag.start : addDays(drag.start, drag.delta)
      const f = drag.mode === "start" ? drag.finish : addDays(drag.finish, drag.delta)
      return drag.mode === "start" ? { s: s > f ? f : s, f } : drag.mode === "end" ? { s, f: f < s ? s : f } : { s, f }
    }
    if (!r.planned_start && !r.planned_finish) return null
    const s = parseISO(r.planned_start ?? r.planned_finish!)
    const f = parseISO(r.planned_finish ?? r.planned_start!)
    return { s, f }
  }

  // scroll so that today is visible (once)
  useLayoutEffect(() => {
    if (!data || didScroll.current || !scrollRef.current) return
    didScroll.current = true
    scrollRef.current.scrollLeft = Math.max(0, x(today) - 160)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  // keep today in view when zoom changes
  useEffect(() => {
    if (!scrollRef.current || !data) return
    scrollRef.current.scrollLeft = Math.max(0, x(today) - 160)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const jumpToday = () => scrollRef.current?.scrollTo({ left: Math.max(0, x(today) - 160), behavior: "smooth" })

  const commit = (r: GanttRow, s: Date, f: Date) => {
    const planned_start = isoDate(s)
    const planned_finish = isoDate(f)
    if (planned_start === r.planned_start && planned_finish === r.planned_finish) return
    // optimistic: update the gantt cache as well
    qc.setQueryData<GanttData>(projectKeys.gantt(projectId), (old) => old && {
      ...old, rows: old.rows.map((x) => (x.type === "activity" && x.id === r.id ? { ...x, planned_start, planned_finish } : x)),
    })
    patch.mutate({ id: r.id, patch: { planned_start, planned_finish } }, {
      onError: () => qc.invalidateQueries({ queryKey: projectKeys.gantt(projectId) }),
    })
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>, r: GanttRow) => {
    if (e.button !== 0 || r.type !== "activity" || !canManage || !r.planned_start || !r.planned_finish) return
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = e.clientX - rect.left
    const mode: Drag["mode"] = rect.width > EDGE * 3 && rel <= EDGE ? "start" : rect.width > EDGE * 3 && rel >= rect.width - EDGE ? "end" : "move"
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id: r.id, mode, originX: e.clientX, start: parseISO(r.planned_start), finish: parseISO(r.planned_finish), delta: 0, moved: false })
  }
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const dx = e.clientX - drag.originX
    const raw = dx / ppd
    const delta = zoom === "Months" ? Math.round(raw / 7) * 7 : Math.round(raw)
    if (delta !== drag.delta || (!drag.moved && Math.abs(dx) > 3)) setDrag({ ...drag, delta, moved: drag.moved || Math.abs(dx) > 3 })
  }
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>, r: GanttRow) => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const d = datesOf(r)
    const wasDrag = drag.moved
    setDrag(null)
    if (!wasDrag) {
      navigate(`/projects/${projectId}/plan?activity=${r.id}`)
      return
    }
    if (d) commit(r, d.s, d.f)
  }

  const onBarKey = (e: KeyboardEvent<HTMLDivElement>, r: GanttRow) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      navigate(r.type === "activity" ? `/projects/${projectId}/plan?activity=${r.id}` : `/work-packages/${r.id}`)
      return
    }
    if (r.type !== "activity" || !canManage || !r.planned_start || !r.planned_finish) return
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const step = e.key === "ArrowLeft" ? -7 : 7
    const s = parseISO(r.planned_start)
    const f = parseISO(r.planned_finish)
    if (e.shiftKey) {
      const nf = addDays(f, step)
      if (nf >= s) commit(r, s, nf)
    } else commit(r, addDays(s, step), addDays(f, step))
  }

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  if (!data) return null

  // row index of each activity (for dependency arrows)
  const rowIndex = new Map<number, number>()
  lines.forEach((l, i) => { if (l.kind === "row" && l.row.type === "activity") rowIndex.set(l.row.id, i) })
  const bodyH = lines.length * ROW_H

  const arrows: { d: string; late: boolean; key: string }[] = []
  if (showDeps) {
    for (const l of lines) {
      if (l.kind !== "row" || l.row.type !== "activity" || !l.row.dependencies?.length) continue
      const to = datesOf(l.row)
      const toIdx = rowIndex.get(l.row.id)
      if (!to || toIdx == null) continue
      for (const dep of l.row.dependencies) {
        const fromIdx = rowIndex.get(dep.id)
        const fromRow = fromIdx != null ? lines[fromIdx] : null
        if (fromIdx == null || !fromRow || fromRow.kind !== "row") continue
        const from = datesOf(fromRow.row)
        if (!from) continue
        const x1 = x(from.f) + ppd
        const y1 = fromIdx * ROW_H + ROW_H / 2
        const x2 = x(to.s)
        const y2 = toIdx * ROW_H + ROW_H / 2
        const late = from.f >= to.s
        let d: string
        if (x2 - 5 >= x1 + 5) d = `M${x1},${y1} H${x1 + 5} V${y2} H${x2 - 1}`
        else {
          const mid = y2 + (y1 < y2 ? -ROW_H / 2 : ROW_H / 2)
          d = `M${x1},${y1} h5 V${mid} H${x2 - 8} V${y2} H${x2 - 1}`
        }
        arrows.push({ d, late, key: `${dep.id}-${l.row.id}` })
      }
    }
  }

  const weeks = eachWeekOfInterval({ start: range.start, end: range.end }, { weekStartsOn: 1 })
  const months = eachMonthOfInterval({ start: range.start, end: range.end })
  const years = eachYearOfInterval({ start: range.start, end: range.end })
  const clampX = (d: Date) => Math.max(0, x(d))
  const todayX = x(today)
  const hasRows = data.rows.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={zoom} onChange={(v) => v && setZoom(v as Zoom)} options={["Weeks", "Months"]} size="sm" />
        <Button size="sm" variant="outline" onClick={jumpToday}><Crosshair /> Today</Button>
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={showWPs} onCheckedChange={setShowWPs} /> Work packages</label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={showDeps} onCheckedChange={setShowDeps} /> Dependencies</label>
        <span className="ml-auto text-[12.5px] text-ink-3">
          {canManage ? "Drag a bar to reschedule, drag its ends to change dates. With keyboard focus, arrow keys move by a week and Shift+arrow changes the finish." : "Select a bar to open the activity."}
        </span>
      </div>

      {!hasRows ? (
        <div className="rounded-md border bg-card"><Empty title="Nothing to schedule yet">Add activities with planned dates in the master plan to see them here.</Empty></div>
      ) : (
        <div ref={scrollRef} className="relative max-h-[calc(100vh-260px)] min-h-[420px] overflow-auto rounded-md border bg-card scroll-thin"
          style={{ cursor: drag ? (drag.mode === "move" ? "grabbing" : "ew-resize") : undefined }}>
          <div style={{ width: LABEL_W + totalW }} className="relative">
            {/* header */}
            <div className="sticky top-0 z-30 flex border-b bg-card" style={{ height: HEAD_H }}>
              <div className="sticky left-0 z-40 flex shrink-0 items-end border-r bg-card px-3 pb-1.5 text-[12px] font-medium text-ink-3" style={{ width: LABEL_W }}>
                Activity
              </div>
              <div className="relative shrink-0" style={{ width: totalW }}>
                <div className="absolute inset-x-0 top-0 h-[22px] border-b">
                  {(zoom === "Weeks" ? months : years).map((m, i, arr) => {
                    const next = arr[i + 1] ?? addDays(range.end, 1)
                    const left = clampX(m)
                    return (
                      <div key={m.toISOString()} className="absolute top-0 h-full overflow-hidden border-l px-1.5 text-[12px] leading-[22px] font-medium whitespace-nowrap text-ink-2"
                        style={{ left, width: x(next) - left }}>
                        {zoom === "Weeks" ? format(m, "MMM yyyy") : format(m, "yyyy")}
                      </div>
                    )
                  })}
                </div>
                <div className="absolute inset-x-0 bottom-0 h-[24px]">
                  {zoom === "Weeks" ? weeks.map((w) => (
                    <div key={w.toISOString()} title={`Week ${getISOWeek(w)}, starting ${fmtDate(w)}`}
                      className={cn("tabular absolute top-0 h-full border-l text-center text-[11px] leading-[24px] text-ink-3",
                        differenceInCalendarDays(today, w) >= 0 && differenceInCalendarDays(today, w) < 7 && "bg-petrol-50 font-semibold text-petrol")}
                      style={{ left: x(w), width: 7 * ppd }}>
                      {format(w, "d")}
                    </div>
                  )) : months.map((m, i) => {
                    const next = months[i + 1] ?? addDays(range.end, 1)
                    const left = clampX(m)
                    const cur = m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear()
                    return (
                      <div key={m.toISOString()} className={cn("absolute top-0 h-full overflow-hidden border-l text-center text-[11px] leading-[24px] text-ink-3", cur && "bg-petrol-50 font-semibold text-petrol")}
                        style={{ left, width: x(next) - left }}>
                        {format(m, "MMM")}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* body */}
            <div className="relative" style={{ height: bodyH }}>
              {/* background grid */}
              <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: LABEL_W, width: totalW }} aria-hidden>
                {months.map((m, i) => i % 2 === 1 && (
                  <div key={m.toISOString()} className="absolute top-0 bottom-0 bg-muted/45"
                    style={{ left: clampX(m), width: x(months[i + 1] ?? addDays(range.end, 1)) - clampX(m) }} />
                ))}
                {zoom === "Weeks" && weeks.map((w) => <div key={w.toISOString()} className="absolute top-0 bottom-0 border-l border-border/60" style={{ left: x(w) }} />)}
                {data.gates.filter((g) => g.planned_date).map((g) => (
                  <div key={g.id} className="absolute top-0 bottom-0 border-l border-dashed border-brass/70" style={{ left: x(parseISO(g.planned_date!)) + ppd / 2 }} />
                ))}
                <div className="absolute top-0 bottom-0 w-[2px] bg-petrol" style={{ left: todayX + ppd / 2 - 1 }} />
              </div>

              {/* dependency arrows */}
              {arrows.length > 0 && (
                <svg className="pointer-events-none absolute top-0 z-[5]" style={{ left: LABEL_W }} width={totalW} height={bodyH} aria-hidden>
                  <defs>
                    <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-3)" />
                    </marker>
                    <marker id="gantt-arrow-late" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0 L6,3 L0,6 z" fill="var(--alarm)" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.key} d={a.d} fill="none" stroke={a.late ? "var(--alarm)" : "var(--ink-3)"} strokeWidth={1} strokeOpacity={a.late ? 0.9 : 0.6}
                      markerEnd={`url(#${a.late ? "gantt-arrow-late" : "gantt-arrow"})`} />
                  ))}
                </svg>
              )}

              {lines.map((l, i) => {
                if (l.kind === "gates") {
                  return (
                    <div key="gates" className="absolute flex w-full border-b" style={{ top: i * ROW_H, height: ROW_H }}>
                      <div className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-card px-3 text-[12.5px] font-medium text-ink-2" style={{ width: LABEL_W }}>
                        <Diamond className="size-3.5 text-brass" /> Gates
                      </div>
                      <div className="relative z-10 shrink-0" style={{ width: totalW }}>
                        {data.gates.filter((g) => g.planned_date).map((g) => {
                          const gx = x(parseISO(g.planned_date!)) + ppd / 2
                          return (
                            <Tooltip key={g.id}>
                              <TooltipTrigger asChild>
                                <button className="group absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center"
                                  style={{ left: gx }} aria-label={`${g.code} on ${fmtDate(g.planned_date)}`}
                                  onClick={() => navigate(`/projects/${projectId}/gates`)}>
                                  <span className={cn("block size-3 rotate-45 border border-brass", g.status === "Completed" ? "bg-brass" : "bg-brass-50")} />
                                  <span className="pointer-events-none absolute left-3 font-mono text-[11px] whitespace-nowrap text-brass">{g.code.replace(/^Gate\s*/i, "G")}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="font-medium">{g.code}, {fmtDate(g.planned_date)}</div>
                                {g.decision && <div className="opacity-80">{g.decision}</div>}
                              </TooltipContent>
                            </Tooltip>
                          )
                        })}
                      </div>
                    </div>
                  )
                }
                if (l.kind === "group") {
                  const isCol = collapsed.has(l.name)
                  const dated = l.rows.filter((r) => r.planned_start && r.planned_finish)
                  const gs = dated.length ? minDate(dated.map((r) => parseISO(r.planned_start!))) : null
                  const gf = dated.length ? maxDate(dated.map((r) => parseISO(r.planned_finish!))) : null
                  const prog = l.rows.reduce((s, r) => s + (r.progress ?? 0), 0) / (l.rows.length || 1)
                  return (
                    <div key={`g-${l.name}`} className="absolute flex w-full border-b bg-muted/50" style={{ top: i * ROW_H, height: ROW_H }}>
                      <button className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r bg-muted px-2 text-left text-[12.5px] font-semibold text-ink"
                        style={{ width: LABEL_W }} aria-expanded={!isCol}
                        onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(l.name)) n.delete(l.name); else n.add(l.name); return n })}>
                        {isCol ? <ChevronRight className="size-4 text-ink-3" /> : <ChevronDown className="size-4 text-ink-3" />}
                        <span className="truncate">{l.name}</span>
                        <span className="ml-auto pr-1 text-[11.5px] font-normal text-ink-3 tabular">{pct(prog)}</span>
                      </button>
                      <div className="relative shrink-0" style={{ width: totalW }}>
                        {gs && gf && (
                          <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-[2px] bg-ink-3/50" style={{ left: x(gs), width: x(gf) - x(gs) + ppd }}>
                            <div className="h-full rounded-[2px] bg-ink-2" style={{ width: `${prog * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                const r = l.row
                const d = datesOf(r)
                const tone = toneOf(r)
                const isAct = r.type === "activity"
                const draggable = isAct && canManage && !!r.planned_start && !!r.planned_finish
                const isDragging = drag?.id === r.id && isAct
                const left = d ? x(d.s) : 0
                const width = d ? Math.max(ppd, x(d.f) - x(d.s) + ppd) : 0
                const pointMilestone = isAct && r.is_milestone && d && differenceInCalendarDays(d.f, d.s) === 0
                const openRow = () => navigate(isAct ? `/projects/${projectId}/plan?activity=${r.id}` : `/work-packages/${r.id}`)
                return (
                  <div key={`${r.type}-${r.id}`} className="group/row absolute flex w-full border-b hover:bg-petrol-50/30" style={{ top: i * ROW_H, height: ROW_H }}>
                    <button onClick={openRow}
                      className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-card px-3 text-left text-[12.5px] group-hover/row:bg-muted"
                      style={{ width: LABEL_W }} title={r.title}>
                      <Code className="w-[52px] shrink-0 text-[11.5px]">{r.code}</Code>
                      <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                      <ScheduleDot value={r.status === "Completed" ? "Green" : r.schedule_status} withLabel={false} />
                    </button>
                    <div className="relative shrink-0" style={{ width: totalW }}>
                      {!d ? (
                        <span className="absolute top-1/2 -translate-y-1/2 text-[11.5px] text-ink-3" style={{ left: Math.max(8, todayX + 12) }}>Not planned</span>
                      ) : pointMilestone ? (
                        <div role="button" tabIndex={0} aria-label={`${r.code} ${r.title}, milestone on ${fmtDate(d.f)}`}
                          className="absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer border"
                          style={{ left: left + ppd / 2, background: tone, borderColor: tone }}
                          onClick={openRow} onKeyDown={(e) => onBarKey(e, r)} />
                      ) : (
                        <Tooltip open={!drag && tip === `${r.type}-${r.id}`} onOpenChange={(o) => setTip((cur) => (o ? `${r.type}-${r.id}` : cur === `${r.type}-${r.id}` ? null : cur))}>
                          <TooltipTrigger asChild>
                            <div role="button" tabIndex={0}
                              aria-label={`${r.code} ${r.title}, ${fmtDate(d.s)} to ${fmtDate(d.f)}, ${stateLabel(r)}, ${pct(r.progress)} complete`}
                              className={cn("group/bar absolute top-1/2 z-10 -translate-y-1/2 touch-none rounded-[3px] border select-none",
                                isAct ? "h-[16px]" : "h-[12px] border-dashed",
                                draggable ? (isDragging && drag.mode === "move" ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer",
                                isDragging && "ring-2 ring-petrol/40")}
                              style={{
                                left, width, borderColor: tone,
                                background: r.status === "Blocked"
                                  ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${tone} 22%, var(--surface)) 0 4px, color-mix(in srgb, ${tone} 8%, var(--surface)) 4px 8px)`
                                  : `color-mix(in srgb, ${tone} 18%, var(--surface))`,
                              }}
                              onPointerDown={(e) => onPointerDown(e, r)}
                              onPointerMove={onPointerMove}
                              onPointerUp={(e) => onPointerUp(e, r)}
                              onPointerCancel={() => setDrag(null)}
                              onClick={(e) => { if (!draggable) { e.stopPropagation(); openRow() } }}
                              onKeyDown={(e) => onBarKey(e, r)}>
                              <div className="h-full rounded-l-[2px]" style={{ width: `${Math.min(1, r.progress ?? 0) * 100}%`, background: tone, opacity: 0.9 }} />
                              {draggable && width > EDGE * 3 && (
                                <>
                                  <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize rounded-l-[3px] opacity-0 group-hover/bar:bg-ink/15 group-hover/bar:opacity-100" />
                                  <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize rounded-r-[3px] opacity-0 group-hover/bar:bg-ink/15 group-hover/bar:opacity-100" />
                                </>
                              )}
                              {isAct && r.is_milestone && (
                                <span className="absolute top-1/2 -right-[5px] size-2.5 -translate-y-1/2 rotate-45 border border-card bg-ink" aria-hidden />
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <div className="font-medium">{r.code} {r.title}</div>
                            <div className="opacity-80">{fmtDate(d.s)} to {fmtDate(d.f)}, {stateLabel(r)}, {pct(r.progress)} complete</div>
                            {r.owner?.name && <div className="opacity-80">Owner: {r.owner.name}</div>}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {d && (
                        <span className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 font-mono text-[11px] whitespace-nowrap",
                          isDragging ? "font-medium text-petrol" : "text-ink-3")}
                          style={{ left: left + width + (isAct && r.is_milestone ? 10 : 6) }}>
                          {isDragging ? `${format(d.s, "d MMM")} – ${format(d.f, "d MMM yyyy")}` : r.code}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <GanttLegend />
    </div>
  )
}

function GanttLegend() {
  const sw = (tone: string, label: string, dashed = false) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-5 rounded-[2px] border", dashed && "border-dashed")} style={{ borderColor: tone, background: `color-mix(in srgb, ${tone} 18%, var(--surface))` }} />
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
      {sw(TONE.Green, "On schedule")}
      {sw(TONE.Amber, "Finishing within two weeks")}
      {sw(TONE.Red, "Overdue or blocked")}
      {sw(TONE.Completed, "Completed")}
      {sw(TONE.Green, "Work package", true)}
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 overflow-hidden rounded-[2px] border border-petrol"><span className="block h-full w-1/2 bg-petrol" /></span> Progress</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rotate-45 border border-brass bg-brass-50" /> Gate</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-ink" /> Milestone</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[2px] bg-petrol" /> Today</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[1px] w-4 bg-alarm" /> Dependency conflict</span>
    </div>
  )
}
