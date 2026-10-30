import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, Check, ChevronLeft, Download, Keyboard, Lock, MessageSquare, Paperclip, Pencil, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Code, Empty, EntityTag, ErrorState, Loading, Meter, Pill, ScoreChip, StatusPill } from "@/components/common/basics"
import { OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { AnswerPanel, SaveIndicator } from "@/components/assess/answer-panel"
import { AssessmentMetaDialog } from "@/components/assess/assessment-meta"
import { CorePill, IdeTiles, computeStats, isTypingTarget, useChapters } from "@/components/assess/shared"
import { answersKey, useAnswerPatcher } from "@/components/assess/use-answers"
import { useAuth } from "@/hooks/useAuth"
import { api, download } from "@/lib/api"
import { EFFORT_VALUES, IMPL_VALUES, SCOPE_VALUES } from "@/lib/constants"
import { pct, scoreColor } from "@/lib/format"
import type { ActionItem, AnswerRow, AssessmentDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LegalDot, useEntityLegal } from "@/components/governance/shared"
import type { LegalTag } from "@/components/governance/types"

type FilterKey = "all" | "unanswered" | "findings" | "core" | "central" | "binding"
type LegalMap = Map<number, LegalTag>
const FILTERS: { key: FilterKey; label: string; test: (r: AnswerRow, legal?: LegalMap) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "binding", label: "Binding", test: (r, legal) => legal?.get(r.requirement_id)?.status === "binding" },
  { key: "unanswered", label: "Unanswered", test: (r) => r.scope === "In Scope" && !r.implemented },
  { key: "findings", label: "Findings", test: (r) => !!r.wp_required },
  { key: "core", label: "Core only", test: (r) => r.is_core },
  { key: "central", label: "Central at HQ", test: (r) => r.scope === "Central at HQ" },
]

interface ChapterStat { number: number; title: string; target: number | null; total: number; inScope: number; assessed: number; average: number | null; findings: number }

function matchesText(r: AnswerRow, q: string) {
  if (!q) return true
  const s = q.toLowerCase()
  return r.number.toLowerCase().startsWith(s) || r.section.toLowerCase().includes(s) || r.text.toLowerCase().includes(s)
    || (r.finding_id ?? "").toLowerCase().includes(s) || (r.gap_description ?? "").toLowerCase().includes(s)
}

const SHORTCUTS: [string, string][] = [
  ["J or ↓", "Next requirement"],
  ["K or ↑", "Previous requirement"],
  ["1 2 3 4", "Implemented: Yes, Partial, No, N/A"],
  ["X", "Select or deselect the row"],
  ["/", "Search requirements"],
]

export default function AssessmentWorkspace() {
  const { id } = useParams()
  const assessmentId = Number(id)
  const [params, setParams] = useSearchParams()
  const { can, canAny } = useAuth()
  const qc = useQueryClient()

  const asmQ = useQuery({ queryKey: ["assessment", assessmentId], queryFn: () => api.get<AssessmentDetail>(`/assessments/${assessmentId}`), enabled: !!assessmentId })
  const answersQ = useQuery({ queryKey: answersKey(assessmentId), queryFn: () => api.get<AnswerRow[]>(`/assessments/${assessmentId}/answers`), enabled: !!assessmentId })
  const chaptersQ = useChapters(canAny("catalog.read"))
  const asm = asmQ.data
  const entityId = asm?.entity.id
  const itemsQ = useQuery({
    queryKey: ["action-items", { entity_id: entityId }],
    queryFn: () => api.get<ActionItem[]>("/action-items", { entity_id: entityId }),
    enabled: entityId != null && canAny("findings.read"),
  })
  const { patch, state: saveState, retry } = useAnswerPatcher(assessmentId, asm?.entity.finding_prefix)

  const rows = useMemo(() => answersQ.data ?? [], [answersQ.data])
  const canEdit = !!asm?.can_edit
  const chapterParam = params.get("chapter")
  const chapter = chapterParam ? Number(chapterParam) : null
  const reqParam = params.get("req") ? Number(params.get("req")) : null
  const [filter, setFilter] = useState<FilterKey>("all")
  const [text, setText] = useState("")
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [panelTab, setPanelTab] = useState("answer")
  const searchRef = useRef<HTMLInputElement>(null)
  const searchRefSmall = useRef<HTMLInputElement>(null)

  const plannedByReq = useMemo(() => new Map((itemsQ.data ?? []).map((i) => [i.requirement.id, i])), [itemsQ.data])

  const chapterStats = useMemo<ChapterStat[]>(() => {
    const titles = new Map((chaptersQ.data ?? []).map((c) => [c.number, c]))
    const m = new Map<number, ChapterStat>()
    for (const r of rows) {
      let c = m.get(r.chapter)
      if (!c) {
        const ch = titles.get(r.chapter)
        c = { number: r.chapter, title: ch?.title ?? r.section.replace(/^[\d.]+\s*/, ""), target: ch?.target ?? null, total: 0, inScope: 0, assessed: 0, average: null, findings: 0 }
        m.set(r.chapter, c)
      }
      c.total++
      if (r.scope === "In Scope") { c.inScope++; if (r.implemented) c.assessed++ }
      if (r.wp_required) c.findings++
    }
    for (const c of m.values()) {
      const scores = rows.filter((r) => r.chapter === c.number && r.score != null).map((r) => r.score!)
      c.average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    }
    return [...m.values()].sort((a, b) => a.number - b.number)
  }, [rows, chaptersQ.data])

  const legal = useEntityLegal(asm?.entity.id)
  const legalMap = legal.map
  const inChapter = useMemo(() => (chapter == null ? rows : rows.filter((r) => r.chapter === chapter)), [rows, chapter])
  const filterCounts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, inChapter.filter((r) => f.test(r, legalMap)).length])) as Record<FilterKey, number>, [inChapter, legalMap])
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    const q = text.trim()
    return inChapter.filter((r) => f.test(r, legalMap) && matchesText(r, q))
  }, [inChapter, filter, text, legalMap])

  const selected = useMemo(
    () => (reqParam != null ? rows.find((r) => r.requirement_id === reqParam) : undefined) ?? visible[0] ?? inChapter[0],
    [rows, reqParam, visible, inChapter],
  )
  const selectedIndex = selected ? visible.findIndex((r) => r.id === selected.id) : -1
  const stats = useMemo(() => computeStats(rows), [rows])

  const select = useCallback((r: AnswerRow) => {
    setParams((p) => { p.set("req", String(r.requirement_id)); return p }, { replace: true })
  }, [setParams])

  const move = useCallback((delta: number) => {
    if (!visible.length) return
    let idx: number
    if (selectedIndex >= 0) idx = Math.min(visible.length - 1, Math.max(0, selectedIndex + delta))
    else if (selected) {
      // the selected row left the filtered list (e.g. just answered under "Unanswered"): continue from its position
      const order = new Map(rows.map((r, i) => [r.id, i]))
      const pos = order.get(selected.id) ?? -1
      const after = visible.findIndex((r) => (order.get(r.id) ?? 0) > pos)
      idx = delta > 0 ? (after === -1 ? visible.length - 1 : after) : (after === -1 ? visible.length - 1 : Math.max(0, after - 1))
    } else idx = 0
    select(visible[idx])
  }, [visible, selectedIndex, selected, rows, select])

  const pickChapter = (n: number | null) => {
    setParams((p) => {
      if (n == null) p.delete("chapter")
      else p.set("chapter", String(n))
      const first = rows.find((r) => (n == null || r.chapter === n) && FILTERS.find((f) => f.key === filter)!.test(r, legalMap) && matchesText(r, text.trim()))
      if (n != null && selected?.chapter !== n && first) p.set("req", String(first.requirement_id))
      return p
    }, { replace: true })
  }

  const toggleChecked = useCallback((answerId: number) => {
    setChecked((s) => { const n = new Set(s); if (n.has(answerId)) n.delete(answerId); else n.add(answerId); return n })
  }, [])

  // keep the selected row visible
  useEffect(() => {
    if (!selected) return
    document.getElementById(`ws-row-${selected.id}`)?.scrollIntoView({ block: "nearest" })
  }, [selected?.id])

  // keyboard navigation and quick answers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      if (isTypingTarget(e.target)) return
      // the floating assistant window is non-modal: keys typed inside it are its own, otherwise the page keeps its shortcuts
      if (e.target instanceof Element && e.target.closest("[data-assistant-window]")) return
      if (document.querySelector("[role=dialog]:not([data-assistant-window]), [role=alertdialog]")) return
      const k = e.key
      if (k === "j" || k === "ArrowDown") { e.preventDefault(); move(1) }
      else if (k === "k" || k === "ArrowUp") { e.preventDefault(); move(-1) }
      else if (k === "/") { e.preventDefault(); (searchRef.current?.offsetParent ? searchRef.current : searchRefSmall.current)?.focus() }
      else if ((k === "x" || k === "X") && selected && canEdit) { e.preventDefault(); toggleChecked(selected.id) }
      else if (["1", "2", "3", "4"].includes(k) && selected) {
        if (!canEdit) { toast.info("You cannot change answers in this assessment."); return }
        e.preventDefault()
        const v = IMPL_VALUES[Number(k) - 1]
        patch(selected.id, { implemented: v })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [move, selected, canEdit, patch, toggleChecked])

  // drop selections that are no longer visible
  useEffect(() => {
    setChecked((s) => {
      if (!s.size) return s
      const ids = new Set(visible.map((r) => r.id))
      const n = new Set([...s].filter((x) => ids.has(x)))
      return n.size === s.size ? s : n
    })
  }, [visible])

  const bulk = useMutation({
    mutationFn: (changes: Record<string, unknown>) => api.post(`/assessments/${assessmentId}/answers/bulk`, { answer_ids: [...checked], changes }),
    onSuccess: () => {
      toast.success(`${checked.size} ${checked.size === 1 ? "answer" : "answers"} updated`)
      qc.invalidateQueries({ queryKey: answersKey(assessmentId) })
      qc.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      qc.invalidateQueries({ queryKey: ["action-items", "unplanned"] })
      setChecked(new Set())
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (asmQ.isLoading || answersQ.isLoading) return <Loading className="h-[calc(100vh-56px)] justify-center" />
  if (asmQ.error || answersQ.error || !asm) {
    return <div className="p-6"><ErrorState error={asmQ.error ?? answersQ.error ?? "Assessment not found"} /><Link to="/assessments" className="mt-3 inline-block text-[13px] text-petrol hover:underline">Back to assessments</Link></div>
  }

  const groups: { ch: ChapterStat; rows: AnswerRow[] }[] = []
  for (const r of visible) {
    const last = groups[groups.length - 1]
    if (last && last.ch.number === r.chapter) last.rows.push(r)
    else groups.push({ ch: chapterStats.find((c) => c.number === r.chapter)!, rows: [r] })
  }
  const allVisibleChecked = visible.length > 0 && visible.every((r) => checked.has(r.id))
  const someChecked = checked.size > 0

  const searchInput = (small: boolean) => (
    <div className="relative">
      <Search className="absolute top-2 left-2.5 size-3.5 text-ink-3" />
      <Input ref={small ? searchRefSmall : searchRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by number or text"
        aria-label="Filter requirements" className="h-8 pl-8 text-[13px]"
        onKeyDown={(e) => { if (e.key === "Escape") { setText(""); (e.target as HTMLInputElement).blur() } }} />
      {text && <button className="absolute top-2 right-2 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear filter"><X className="size-3.5" /></button>}
    </div>
  )
  const filterChips = (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
      {FILTERS.map((f) => (
        <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
          className={cn("inline-flex h-6 items-center gap-1 rounded-[4px] border px-2 text-[12px] transition-colors",
            filter === f.key ? "border-petrol bg-petrol-50 text-petrol" : "text-ink-2 hover:bg-muted")}>
          {f.label}<span className="tabular text-[11px] opacity-70">{filterCounts[f.key]}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/assessments" className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label="All assessments"><ChevronLeft className="size-4" /></Link>
          <h1 className="truncate text-[16px] font-semibold text-ink">{asm.entity.name}</h1>
          <EntityTag code={asm.entity.code} />
          <span className="hidden truncate text-[12.5px] text-ink-3 lg:inline">{asm.round.name}</span>
          <StatusPill value={asm.status} />
          {asm.locked && <Pill tone="outline"><Lock className="size-3" /> Locked</Pill>}
        </div>
        <div className="flex items-center gap-5 text-[12px] text-ink-3">
          <div className="w-[130px]">
            <div className="flex justify-between"><span>Assessed</span><span className="tabular font-medium text-ink">{stats.assessed}/{stats.inScope}</span></div>
            <Meter value={stats.inScope ? stats.assessed / stats.inScope : 0} className="mt-1" />
          </div>
          <div><div>Average</div><ScoreChip value={stats.average} /></div>
          <div><div>Findings</div><span className="tabular text-[12.5px] font-medium text-ink">{stats.findings}</span></div>
          <div className="hidden lg:block"><div>Core</div><span className="tabular text-[12.5px] font-medium text-ink">{stats.coreAssessed}/{stats.coreTotal}</span></div>
          <div className="hidden 2xl:block"><div>Reviewed</div><span className="tabular text-[12.5px] font-medium text-ink">{stats.reviewed}</span></div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 hidden xl:inline"><SaveIndicator state={saveState} onRetry={retry} /></span>
          <Popover>
            <PopoverTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Keyboard shortcuts" data-tour="assess.shortcuts"><Keyboard /></Button></PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="mb-2 text-[13px] font-semibold">Keyboard shortcuts</div>
              <dl className="space-y-1.5 text-[12.5px]">
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <dt className="text-ink-2">{d}</dt>
                    <dd><kbd className="rounded border bg-muted px-1.5 font-mono text-[11px] text-ink-2">{k}</kbd></dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-ink-3">Shortcuts work while the cursor is not in a text field.</p>
            </PopoverContent>
          </Popover>
          {(asm.can_manage || can("assessments.edit", asm.entity.id)) && (
            <AssessmentMetaDialog assessment={asm} canManage={asm.can_manage} canEdit={can("assessments.edit", asm.entity.id)} roundName={asm.round.name}
              trigger={<Button size="sm" variant="outline"><Pencil /> Details</Button>} />
          )}
          {canAny("entities.read") && (
            <Button size="sm" variant="ghost" asChild><Link to={`/entities/${asm.entity.id}`}><Building2 /> Entity</Link></Button>
          )}
          {can("reports.export") && (
            <Button size="sm" variant="ghost" onClick={() => download(`/export/gap-workbook?round_id=${asm.round_id}`, "NIS2_GAP_Analysis.xlsx").catch((e) => toast.error(e.message))}>
              <Download /> Export
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* chapter navigator */}
        <nav aria-label="Chapters" className="hidden w-[248px] shrink-0 flex-col border-r bg-card xl:flex">
          <div className="space-y-2 border-b p-3">{searchInput(false)}{filterChips}</div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin py-1">
            <button type="button" onClick={() => pickChapter(null)}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]", chapter == null ? "bg-petrol-50 font-medium text-petrol" : "text-ink-2 hover:bg-muted/60")}>
              <span className="flex-1">All chapters</span>
              <span className="tabular text-[11.5px] text-ink-3">{stats.assessed}/{stats.inScope}</span>
            </button>
            {chapterStats.map((c) => {
              const active = chapter === c.number
              return (
                <button key={c.number} type="button" onClick={() => pickChapter(c.number)} aria-current={active ? "true" : undefined}
                  title={`${c.number} ${c.title}${c.target != null ? ` (target ${pct(c.target)})` : ""}`}
                  className={cn("block w-full border-l-2 px-3 py-1.5 text-left", active ? "border-petrol bg-petrol-50" : "border-transparent hover:bg-muted/60")}>
                  <div className="flex items-baseline gap-2">
                    <Code className={cn("w-5 shrink-0 text-right text-[12px]", active ? "text-petrol" : "text-ink-3")}>{c.number}</Code>
                    <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", active ? "font-medium text-ink" : "text-ink-2")}>{c.title}</span>
                    <span className="tabular shrink-0 text-[11.5px] font-medium" style={{ color: c.average != null ? scoreColor(c.average) : "var(--ink-3)" }}>
                      {pct(c.average)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-7">
                    <Meter value={c.inScope ? c.assessed / c.inScope : 0} className="h-1 flex-1" />
                    <span className="tabular w-10 text-right text-[11px] text-ink-3">{c.assessed}/{c.inScope}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </nav>

        {/* requirement list */}
        <section aria-label="Requirements" data-tour="answer.list assess.workspace" className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="space-y-2 border-b bg-card px-3 py-2 xl:hidden">
            <div className="flex gap-2">
              <div className="w-56 shrink-0">
                <OptionSelect size="sm" value={chapter != null ? String(chapter) : null} onChange={(v) => pickChapter(v ? Number(v) : null)} allowNone noneLabel="All chapters"
                  options={chapterStats.map((c) => ({ value: String(c.number), label: `${c.number} ${c.title}` }))} />
              </div>
              <div className="min-w-0 flex-1">{searchInput(true)}</div>
            </div>
            {filterChips}
          </div>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-card px-3 text-[12.5px]">
            {canEdit && (
              <Checkbox aria-label="Select all visible requirements" checked={allVisibleChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => setChecked(allVisibleChecked ? new Set() : new Set(visible.map((r) => r.id)))} />
            )}
            {someChecked ? (
              <>
                <span className="font-medium text-ink">{checked.size} selected</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="xs" variant="outline" disabled={bulk.isPending}>Set scope</Button></DropdownMenuTrigger>
                  <DropdownMenuContent>{SCOPE_VALUES.map((s) => <DropdownMenuItem key={s} onSelect={() => bulk.mutate({ scope: s })}>{s}</DropdownMenuItem>)}</DropdownMenuContent>
                </DropdownMenu>
                <BulkResponsible disabled={bulk.isPending} count={checked.size} onApply={(v) => bulk.mutate({ responsible_id: v })} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="xs" variant="outline" disabled={bulk.isPending}>Set effort</Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {EFFORT_VALUES.map((s) => <DropdownMenuItem key={s} onSelect={() => bulk.mutate({ effort: s })}>{s}</DropdownMenuItem>)}
                    <DropdownMenuItem onSelect={() => bulk.mutate({ effort: null })}>Clear effort</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="xs" variant="outline" disabled={bulk.isPending}>Review</Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => bulk.mutate({ review_status: "reviewed" })}>Mark as reviewed</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulk.mutate({ review_status: "draft" })}>Mark as draft</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setChecked(new Set())}>Clear selection</Button>
              </>
            ) : (
              <>
                <span className="text-ink-3">
                  <span className="tabular font-medium text-ink">{visible.length}</span> {visible.length === 1 ? "requirement" : "requirements"}
                  {chapter != null && <> in chapter {chapter}</>}
                </span>
                {(filter !== "all" || text) && (
                  <Button size="xs" variant="ghost" onClick={() => { setFilter("all"); setText("") }}>Clear filters</Button>
                )}
                <span className="ml-auto hidden text-[11.5px] text-ink-3 2xl:inline">J / K to move, 1 to 4 to answer Implemented</span>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin" role="list">
            {visible.length === 0 ? (
              <Empty title="No requirements match these filters" action={<Button size="sm" variant="outline" onClick={() => { setFilter("all"); setText(""); pickChapter(null) }}>Show all requirements</Button>}>
                Change the filter or search text to see more requirements.
              </Empty>
            ) : groups.map((g) => (
              <div key={g.ch.number} role="presentation">
                <div className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-muted/95 px-3 py-1 text-[12px] backdrop-blur">
                  <Code className="text-[12px] text-ink-3">{g.ch.number}</Code>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{g.ch.title}</span>
                  <span className="tabular text-ink-3">{g.ch.assessed}/{g.ch.inScope}</span>
                  <ScoreChip value={g.ch.average} />
                </div>
                {g.rows.map((r) => (
                  <Row key={r.id} r={r} legal={legalMap.get(r.requirement_id)} selected={r.id === selected?.id} checked={checked.has(r.id)} canCheck={canEdit}
                    onSelect={select} onCheck={toggleChecked} />
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* answer panel */}
        <aside aria-label="Answer" className="w-[440px] shrink-0 border-l 2xl:w-[560px]">
          {selected ? (
            <AnswerPanel key={selected.id} row={selected} assessment={asm} canEdit={canEdit} patch={patch} saveState={saveState} onRetry={retry}
              plannedItem={plannedByReq.get(selected.requirement_id)} canPlan={can("findings.manage", asm.entity.id)}
              onMove={move} position={{ index: selectedIndex, total: visible.length }} tab={panelTab} onTabChange={setPanelTab} />
          ) : (
            <Empty title="Select a requirement" className="h-full">Pick a requirement from the list to answer it.</Empty>
          )}
        </aside>
      </div>
    </div>
  )
}

function Row({ r, legal, selected, checked, canCheck, onSelect, onCheck }: {
  r: AnswerRow
  legal?: LegalTag
  selected: boolean
  checked: boolean
  canCheck: boolean
  onSelect: (r: AnswerRow) => void
  onCheck: (id: number) => void
}) {
  return (
    <div id={`ws-row-${r.id}`} role="listitem"
      className={cn("flex scroll-mt-7 items-start gap-2 border-b px-3 py-1.5 transition-colors",
        selected ? "bg-petrol-50 shadow-[inset_2px_0_0_var(--petrol)]" : checked ? "bg-muted/70" : "bg-card hover:bg-muted/50")}>
      {canCheck && (
        <Checkbox className="mt-[3px]" checked={checked} onCheckedChange={() => onCheck(r.id)} aria-label={`Select requirement ${r.number}`} />
      )}
      <button type="button" onClick={() => onSelect(r)} aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm text-left focus-visible:outline-offset-0">
        <Code className={cn("w-[46px] shrink-0 pt-px", selected ? "font-medium text-petrol" : "text-ink-2")}>{r.number}</Code>
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-1 text-[13px]", r.scope !== "In Scope" ? "text-ink-3" : "text-ink")}>{r.text}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
            <LegalDot tag={legal} />
            {r.is_core && <CorePill className="h-4 px-1 text-[10.5px]" />}
            {r.scope === "Central at HQ" && <span className="text-brass">Central at HQ</span>}
            {r.scope === "Not Applicable" && <span>Not applicable</span>}
            <span className="min-w-0 truncate">{r.section.replace(/^[\d.]+\s*/, "")}</span>
            {r.finding_id && <span className="shrink-0 font-mono text-[11px] text-alarm">{r.finding_id}</span>}
            {r.doc_count > 0 && <span className="inline-flex shrink-0 items-center gap-0.5" title={`${r.doc_count} evidence documents`}><Paperclip className="size-3" />{r.doc_count}</span>}
            {r.comment_count > 0 && <span className="inline-flex shrink-0 items-center gap-0.5" title={`${r.comment_count} comments`}><MessageSquare className="size-3" />{r.comment_count}</span>}
            {r.review_status === "reviewed" && <span className="inline-flex shrink-0 items-center text-sage" title="Reviewed"><Check className="size-3" /></span>}
          </span>
        </span>
        <IdeTiles row={r} className="mt-0.5 shrink-0" />
        <span className="w-[46px] shrink-0 pt-px text-right"><ScoreChip value={r.score} /></span>
      </button>
    </div>
  )
}

function BulkResponsible({ onApply, disabled, count }: { onApply: (v: number | null) => void; disabled: boolean; count: number }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<number | null>(null)
  return (
    <>
      <Button size="xs" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Set responsible</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set responsible</DialogTitle>
            <DialogDescription>Applies to the {count} selected {count === 1 ? "answer" : "answers"}. Leave empty to remove the responsible.</DialogDescription>
          </DialogHeader>
          <StakeholderSelect value={value} onChange={setValue} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { onApply(value); setOpen(false) }}>Apply to {count} {count === 1 ? "answer" : "answers"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
