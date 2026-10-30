import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Empty, ErrorState, Loading } from "@/components/common/basics"
import { Field, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { projectKeys } from "./shared"

interface RaciData {
  columns: { id: number; name: string; stakeholder_id: number | null }[]
  rows: { id: number; name: string }[]
  cells: Record<string, string>
}
interface Col { key: string; name: string; stakeholder_id: number | null }
interface Row { key: string; name: string }
interface Matrix { cols: Col[]; rows: Row[]; cells: Record<string, string> }

const CYCLE = ["", "R", "A", "C", "I", "A/R", "-"]
const LEGEND: [string, string][] = [
  ["R", "Responsible: does the work"], ["A", "Accountable: approves, exactly one per activity"], ["C", "Consulted: gives input"],
  ["I", "Informed: kept up to date"], ["A/R", "Accountable and responsible"], ["-", "Not involved"],
]
let uid = 0
const newKey = (p: string) => `${p}new${++uid}`
const ck = (r: string, c: string) => `${r}|${c}`

function fromServer(d: RaciData): Matrix {
  const cells: Record<string, string> = {}
  for (const [k, v] of Object.entries(d.cells)) {
    const [a, c] = k.split(":")
    if (v) cells[ck(`r${a}`, `c${c}`)] = v
  }
  return {
    cols: d.columns.map((c) => ({ key: `c${c.id}`, name: c.name, stakeholder_id: c.stakeholder_id })),
    rows: d.rows.map((r) => ({ key: `r${r.id}`, name: r.name })),
    cells,
  }
}

function serialise(m: Matrix) {
  const cells: Record<string, string> = {}
  m.rows.forEach((r, ri) => m.cols.forEach((c, ci) => {
    const v = m.cells[ck(r.key, c.key)]
    if (v) cells[`${ri}:${ci}`] = v
  }))
  return {
    columns: m.cols.map((c) => ({ name: c.name.trim() || "Unnamed role", stakeholder_id: c.stakeholder_id })),
    rows: m.rows.map((r) => ({ name: r.name.trim() || "Unnamed activity" })),
    cells,
  }
}

function cellClass(v: string): string {
  switch (v) {
    case "A": case "A/R": return "bg-petrol text-white font-semibold"
    case "R": return "bg-petrol-50 text-petrol font-semibold"
    case "C": return "bg-brass-50 text-brass font-medium"
    case "I": return "bg-muted text-ink-2"
    case "-": return "text-ink-3"
    default: return "text-transparent"
  }
}

export function RaciMatrix({ projectId }: { projectId: number }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const qc = useQueryClient()
  const q = useQuery({ queryKey: projectKeys.raci(projectId), queryFn: () => api.get<RaciData>(`/projects/${projectId}/raci`) })
  const [m, setM] = useState<Matrix | null>(null)
  const [base, setBase] = useState<string>("")
  const [seen, setSeen] = useState<RaciData | undefined>(undefined)
  if (q.data && q.data !== seen) {
    setSeen(q.data)
    const mm = fromServer(q.data)
    setM(mm)
    setBase(JSON.stringify(serialise(mm)))
  }
  const dirty = !!m && JSON.stringify(serialise(m)) !== base

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const save = useMutation({
    mutationFn: () => api.put(`/projects/${projectId}/raci`, serialise(m!)),
    onSuccess: () => { toast.success("RACI matrix saved"); qc.invalidateQueries({ queryKey: projectKeys.raci(projectId) }) },
    onError: (e: Error) => toast.error(`Could not save the RACI matrix: ${e.message}`),
  })

  const warnings = useMemo(() => {
    const w: Record<string, string> = {}
    if (!m) return w
    for (const r of m.rows) {
      const a = m.cols.filter((c) => ["A", "A/R"].includes(m.cells[ck(r.key, c.key)] ?? "")).length
      if (a === 0) w[r.key] = "No one is accountable. Assign exactly one A."
      else if (a > 1) w[r.key] = `${a} roles are accountable. Keep exactly one A.`
    }
    return w
  }, [m])

  if (q.isLoading || (!m && !q.error)) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  if (!m) return null

  const update = (fn: (m: Matrix) => Matrix) => setM((p) => (p ? fn(p) : p))
  const setCell = (r: string, c: string, v: string) => update((p) => {
    const cells = { ...p.cells }
    if (v) cells[ck(r, c)] = v
    else delete cells[ck(r, c)]
    return { ...p, cells }
  })
  const cycle = (r: string, c: string, dir = 1) => {
    const cur = m.cells[ck(r, c)] ?? ""
    setCell(r, c, CYCLE[(CYCLE.indexOf(cur) + dir + CYCLE.length) % CYCLE.length])
  }
  const moveRow = (i: number, d: -1 | 1) => update((p) => {
    const rows = [...p.rows]; const j = i + d
    if (j < 0 || j >= rows.length) return p
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
    return { ...p, rows }
  })
  const moveCol = (i: number, d: -1 | 1) => update((p) => {
    const cols = [...p.cols]; const j = i + d
    if (j < 0 || j >= cols.length) return p
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
    return { ...p, cols }
  })
  const addRow = () => {
    const key = newKey("r")
    update((p) => ({ ...p, rows: [...p.rows, { key, name: "" }] }))
    setTimeout(() => (document.querySelector(`[data-row-input="${key}"]`) as HTMLInputElement | null)?.focus(), 0)
  }
  const addCol = () => update((p) => ({ ...p, cols: [...p.cols, { key: newKey("c"), name: "New role", stakeholder_id: null }] }))

  const onCellKey = (e: KeyboardEvent<HTMLButtonElement>, ri: number, ci: number) => {
    const r = m.rows[ri].key, c = m.cols[ci].key
    const focus = (rr: number, cc: number) => {
      const el = document.querySelector(`[data-cell="${rr}:${cc}"]`) as HTMLButtonElement | null
      el?.focus()
    }
    const k = e.key.toLowerCase()
    if (e.key === "ArrowRight") { e.preventDefault(); focus(ri, Math.min(m.cols.length - 1, ci + 1)) }
    else if (e.key === "ArrowLeft") { e.preventDefault(); focus(ri, Math.max(0, ci - 1)) }
    else if (e.key === "ArrowDown") { e.preventDefault(); focus(Math.min(m.rows.length - 1, ri + 1), ci) }
    else if (e.key === "ArrowUp") { e.preventDefault(); focus(Math.max(0, ri - 1), ci) }
    else if (!canManage) return
    else if (k === "r" || k === "c" || k === "i") { e.preventDefault(); setCell(r, c, k.toUpperCase()) }
    else if (k === "a") { e.preventDefault(); setCell(r, c, e.shiftKey ? "A/R" : "A") }
    else if (k === "-") { e.preventDefault(); setCell(r, c, "-") }
    else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setCell(r, c, "") }
  }

  const warnCount = Object.keys(warnings).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
          {LEGEND.map(([v, l]) => (
            <span key={v} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-flex h-5 min-w-7 items-center justify-center rounded-[3px] border px-1 font-mono text-[11px]", cellClass(v), v === "-" && "border-border")}>{v}</span>
              {l}
            </span>
          ))}
        </div>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-[12.5px] text-amber">Unsaved changes</span>}
            <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => { const mm = fromServer(q.data!); setM(mm) }}>Discard changes</Button>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          </div>
        )}
      </div>

      {warnCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber/30 bg-amber-50 px-3 py-2 text-[13px] text-amber">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{warnCount} {warnCount === 1 ? "activity does" : "activities do"} not have exactly one accountable role (A or A/R). Rows are marked below.</span>
        </div>
      )}
      {canManage && <p className="text-[12.5px] text-ink-3">Click a cell to cycle through R, A, C, I, A/R, - and empty. With keyboard focus type R, A, C, I, Shift+A for A/R, - or Backspace, and use the arrow keys to move.</p>}

      <div data-tour="project.raci" className="overflow-auto rounded-md border bg-card scroll-thin max-h-[calc(100vh-280px)]">
        {m.rows.length === 0 && m.cols.length === 0 ? (
          <Empty title="The RACI matrix is empty" action={canManage && <div className="flex gap-2"><Button variant="outline" onClick={addCol}><Plus /> Add role</Button><Button onClick={addRow}><Plus /> Add activity</Button></div>}>
            Add roles as columns and activities as rows, then assign responsibilities.
          </Empty>
        ) : (
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-20 bg-card">
              <tr>
                <th className="sticky left-0 z-30 min-w-[330px] border-r border-b bg-card px-3 py-2 text-left align-bottom text-[12px] font-medium text-ink-3">Activity</th>
                {m.cols.map((c, ci) => (
                  <th key={c.key} className="w-[92px] min-w-[92px] border-b px-1 py-2 align-bottom">
                    <div className="flex flex-col items-center gap-1">
                      <span className="line-clamp-3 text-center text-[12px] leading-tight font-medium text-ink-2" title={c.name}>{c.name || "Unnamed role"}</span>
                      {canManage && <ColumnMenu col={c} first={ci === 0} last={ci === m.cols.length - 1}
                        onChange={(patch) => update((p) => ({ ...p, cols: p.cols.map((x) => (x.key === c.key ? { ...x, ...patch } : x)) }))}
                        onMove={(d) => moveCol(ci, d)}
                        onRemove={() => update((p) => ({ ...p, cols: p.cols.filter((x) => x.key !== c.key) }))} />}
                    </div>
                  </th>
                ))}
                {canManage && (
                  <th className="border-b px-2 align-bottom">
                    <Button size="sm" variant="ghost" onClick={addCol} className="mb-0.5"><Plus /> Role</Button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, ri) => (
                <tr key={r.key} className="group">
                  <td className="sticky left-0 z-10 border-r border-b bg-card px-2 py-1 group-hover:bg-muted">
                    <div className="flex items-center gap-1">
                      {warnings[r.key] ? (
                        <Tooltip>
                          <TooltipTrigger asChild><AlertTriangle className="size-3.5 shrink-0 text-amber" aria-label={warnings[r.key]} /></TooltipTrigger>
                          <TooltipContent>{warnings[r.key]}</TooltipContent>
                        </Tooltip>
                      ) : <span className="size-3.5 shrink-0" />}
                      {canManage ? (
                        <Input value={r.name} data-row-input={r.key} placeholder="Activity name" aria-label={`Activity ${ri + 1}`}
                          className="h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-border focus-visible:border-input"
                          onChange={(e) => update((p) => ({ ...p, rows: p.rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)) }))} />
                      ) : <span className="px-1.5 py-1 text-ink">{r.name}</span>}
                      {canManage && (
                        <span className="hidden shrink-0 group-focus-within:flex group-hover:flex">
                          <Button size="icon-xs" variant="ghost" aria-label="Move row up" disabled={ri === 0} onClick={() => moveRow(ri, -1)}><ArrowUp /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label="Move row down" disabled={ri === m.rows.length - 1} onClick={() => moveRow(ri, 1)}><ArrowDown /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label="Remove row" className="hover:text-alarm"
                            onClick={() => update((p) => ({ ...p, rows: p.rows.filter((x) => x.key !== r.key) }))}><Trash2 /></Button>
                        </span>
                      )}
                    </div>
                  </td>
                  {m.cols.map((c, ci) => {
                    const v = m.cells[ck(r.key, c.key)] ?? ""
                    return (
                      <td key={c.key} className="border-b p-[3px] group-hover:bg-muted/50">
                        <button data-cell={`${ri}:${ci}`}
                          aria-label={`${r.name || "Activity"}, ${c.name}: ${v || "empty"}`}
                          className={cn("flex h-7 w-full items-center justify-center rounded-[3px] font-mono text-[12px] transition-colors",
                            cellClass(v), canManage ? "hover:ring-1 hover:ring-petrol/40" : "cursor-default", !v && canManage && "hover:bg-muted")}
                          onClick={(e) => canManage && cycle(r.key, c.key, e.shiftKey ? -1 : 1)}
                          onKeyDown={(e) => onCellKey(e, ri, ci)}>
                          {v || "\u00a0"}
                        </button>
                      </td>
                    )
                  })}
                  {canManage && <td className="border-b" />}
                </tr>
              ))}
              {canManage && (
                <tr>
                  <td className="sticky left-0 z-10 bg-card px-2 py-2" colSpan={1}>
                    <Button size="sm" variant="ghost" onClick={addRow}><Plus /> Add activity</Button>
                  </td>
                  <td colSpan={m.cols.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ColumnMenu({ col, first, last, onChange, onMove, onRemove }: {
  col: Col; first: boolean; last: boolean
  onChange: (p: Partial<Col>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Edit column ${col.name}`} className="text-ink-3"><Settings2 /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="center">
        <Field label="Role name"><Input value={col.name} onChange={(e) => onChange({ name: e.target.value })} autoFocus /></Field>
        <Field label="Linked stakeholder" hint="Optional. Links the column to a stakeholder role.">
          <StakeholderSelect value={col.stakeholder_id} onChange={(v) => onChange({ stakeholder_id: v })} placeholder="No stakeholder" />
        </Field>
        <div className="flex items-center gap-1 border-t pt-2">
          <Button size="sm" variant="ghost" disabled={first} onClick={() => onMove(-1)}><ArrowLeft /> Move left</Button>
          <Button size="sm" variant="ghost" disabled={last} onClick={() => onMove(1)}>Move right <ArrowRight /></Button>
          <Button size="sm" variant="ghost" className="ml-auto text-alarm hover:text-alarm" onClick={onRemove}><Trash2 /> Remove</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
