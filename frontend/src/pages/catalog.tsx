import { Fragment, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Search, Target, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, ErrorState, Loading, PageHeader, Pill, ScoreBar, Section } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { CorePill, useChapters, useRequirements, type TargetChange } from "@/components/assess/shared"
import { answersKey } from "@/components/assess/use-answers"
import { JurisdictionPills, useLegalTags } from "@/components/governance/shared"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDateTime, pct, scoreColor } from "@/lib/format"
import type { AnswerRow, AssessmentListItem, Chapter } from "@/lib/types"
import { cn } from "@/lib/utils"

const combineData = (results: { data?: AnswerRow[] }[]) => results.map((r) => r.data)

interface Cell { assessmentId: number; code: string; name: string; row: AnswerRow }

function StatusTile({ c, requirementId }: { c: Cell; requirementId: number }) {
  const r = c.row
  const out = r.scope !== "In Scope"
  const label = out ? r.scope : r.score == null ? "Not assessed" : `Score ${pct(r.score)}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={`/assessments/${c.assessmentId}?req=${requirementId}`} onClick={(e) => e.stopPropagation()}
          aria-label={`${c.name}: ${label}`}
          className={cn("tabular flex h-6 w-full items-center justify-center rounded-[3px] text-[11px] font-medium transition-[filter] hover:brightness-110",
            out ? "border border-dashed text-ink-3" : r.score == null ? "bg-muted text-ink-3" : "text-white")}
          style={!out && r.score != null ? { background: scoreColor(r.score) } : undefined}>
          {out ? (r.scope === "Central at HQ" ? "HQ" : "n/a") : r.score == null ? "–" : Math.round(r.score * 100)}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {c.name}: {label}{r.finding_id ? `, finding ${r.finding_id}` : ""}
      </TooltipContent>
    </Tooltip>
  )
}

function TargetDialog({ chapter }: { chapter: Chapter }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(Math.round(chapter.target * 100)))
  const [reason, setReason] = useState("")
  const qc = useQueryClient()
  const n = Number(value)
  const valid = value !== "" && Number.isFinite(n) && n >= 0 && n <= 100 && reason.trim().length >= 3 && n / 100 !== chapter.target
  const save = useMutation({
    mutationFn: () => api.post<Chapter>(`/chapters/${chapter.id}/target`, { target: n / 100, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(`Target of chapter ${chapter.number} set to ${n}%`)
      qc.invalidateQueries({ queryKey: ["chapters"] })
      qc.invalidateQueries({ queryKey: ["target-history"] })
      qc.invalidateQueries({ queryKey: ["dash-gap"] })
      setOpen(false); setReason("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setValue(String(Math.round(chapter.target * 100))); setReason("") } }}>
      <DialogTrigger asChild><Button size="xs" variant="ghost" aria-label={`Change target of chapter ${chapter.number}`}><Target /> Change</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change target of chapter {chapter.number}</DialogTitle>
          <DialogDescription>{chapter.title}. The change and its reason are recorded in the target history.</DialogDescription>
        </DialogHeader>
        <Field label="New target (percent)" hint={`Currently ${pct(chapter.target)}`} htmlFor="tgt-value">
          <Input id="tgt-value" type="number" min={0} max={100} step={5} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
        </Field>
        <Field label="Reason" hint="Required, for example the decision of the steering committee" htmlFor="tgt-reason">
          <Textarea id="tgt-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save target</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function CatalogPage() {
  const { canAny, canGlobal } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const chapterParam = params.get("chapter")
  const chapter = chapterParam ? Number(chapterParam) : null
  const tab = params.get("tab") === "targets" ? "targets" : "requirements"
  const [text, setText] = useState("")
  const [coreOnly, setCoreOnly] = useState(false)
  const [findingsOnly, setFindingsOnly] = useState(false)
  const [bindingIn, setBindingIn] = useState<"DE" | "NL" | null>(null)
  const legal = useLegalTags()

  const chaptersQ = useChapters()
  const reqsQ = useRequirements()
  const canAssess = canAny("assessments.read")
  const asmQ = useQuery({ queryKey: ["assessments", "current"], queryFn: () => api.get<AssessmentListItem[]>("/assessments"), enabled: canAssess })
  const answerData = useQueries({
    queries: (asmQ.data ?? []).map((a) => ({
      queryKey: answersKey(a.id),
      queryFn: () => api.get<AnswerRow[]>(`/assessments/${a.id}/answers`),
      staleTime: 30_000,
    })),
    combine: combineData,
  })
  const historyQ = useQuery({ queryKey: ["target-history"], queryFn: () => api.get<TargetChange[]>("/chapters/target-history"), enabled: tab === "targets" })

  const assessments = asmQ.data ?? []
  const answersReady = answerData.every(Boolean)
  const byReq = useMemo(() => {
    const m = new Map<number, Cell[]>()
    assessments.forEach((a, i) => {
      for (const row of answerData[i] ?? []) {
        const list = m.get(row.requirement_id) ?? []
        list[i] = { assessmentId: a.id, code: a.entity.code, name: a.entity.name, row }
        m.set(row.requirement_id, list)
      }
    })
    return m
  }, [assessments, answerData])

  const chapterById = useMemo(() => new Map((chaptersQ.data ?? []).map((c) => [c.id, c])), [chaptersQ.data])
  const chapterAvg = useMemo(() => {
    const m = new Map<number, { sum: number; n: number; findings: number }>()
    for (const r of reqsQ.data ?? []) {
      const acc = m.get(r.chapter_id) ?? { sum: 0, n: 0, findings: 0 }
      for (const c of byReq.get(r.id) ?? []) {
        if (!c) continue
        if (c.row.score != null) { acc.sum += c.row.score; acc.n++ }
        if (c.row.wp_required) acc.findings++
      }
      m.set(r.chapter_id, acc)
    }
    return m
  }, [reqsQ.data, byReq])

  const visible = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (reqsQ.data ?? []).filter((r) => {
      if (chapter != null && chapterById.get(r.chapter_id)?.number !== chapter) return false
      if (coreOnly && !r.is_core) return false
      if (findingsOnly && !(byReq.get(r.id) ?? []).some((c) => c?.row.wp_required)) return false
      if (bindingIn && legal.byReq.get(r.id)?.[bindingIn]?.status !== "binding") return false
      if (!q) return true
      return r.number.toLowerCase().startsWith(q) || r.section.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)
        || (r.legal_reference ?? "").toLowerCase().includes(q) || (r.iso_reference ?? "").toLowerCase().includes(q)
    })
  }, [reqsQ.data, chapter, coreOnly, findingsOnly, bindingIn, legal.byReq, text, chapterById, byReq])

  const setParam = (k: string, v: string | null) => setParams((p) => { if (v == null) p.delete(k); else p.set(k, v); return p }, { replace: true })
  const loading = chaptersQ.isLoading || reqsQ.isLoading
  const error = chaptersQ.error ?? reqsQ.error

  let lastChapter: number | null = null
  return (
    <div>
      <PageHeader title="Requirement catalogue"
        description="The 161 measures of Implementing Regulation (EU) 2024/2690 and the national requirements, grouped in chapters with a target score each." />

      <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "targets" ? "targets" : null)}>
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="targets">Chapters and targets</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-72">
              <OptionSelect value={chapter != null ? String(chapter) : null} onChange={(v) => setParam("chapter", v)} allowNone noneLabel="All chapters"
                options={(chaptersQ.data ?? []).map((c) => ({ value: String(c.number), label: `${c.number} ${c.title}` }))} />
            </div>
            <div className="relative w-72">
              <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Number, text or legal reference" className="pl-8" aria-label="Search requirements" />
              {text && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear search"><X className="size-4" /></button>}
            </div>
            <button type="button" aria-pressed={coreOnly} onClick={() => setCoreOnly(!coreOnly)}
              className={cn("h-9 rounded-md border px-3 text-[13px]", coreOnly ? "border-petrol bg-petrol-50 text-petrol" : "bg-card text-ink-2 hover:bg-muted")}>Core only</button>
            {canAssess && (
              <button type="button" aria-pressed={findingsOnly} onClick={() => setFindingsOnly(!findingsOnly)}
                className={cn("h-9 rounded-md border px-3 text-[13px]", findingsOnly ? "border-petrol bg-petrol-50 text-petrol" : "bg-card text-ink-2 hover:bg-muted")}>With findings</button>
            )}
            <div className="w-52">
              <OptionSelect value={bindingIn} onChange={(v) => setBindingIn(v as "DE" | "NL" | null)} allowNone noneLabel="Binding and benchmark" placeholder="Binding and benchmark"
                options={[{ value: "DE", label: "Binding in Germany" }, { value: "NL", label: "Binding in the Netherlands" }]} />
            </div>
            <span className="ml-auto text-[12.5px] text-ink-3"><span className="tabular font-medium text-ink">{visible.length}</span> of {reqsQ.data?.length ?? 0} requirements</span>
          </div>

          <Section bodyClassName="p-0">
            {loading ? <Loading /> : error ? <ErrorState error={error} className="m-4" /> : visible.length === 0 ? (
              <Empty title="No requirements match" action={<Button size="sm" variant="outline" onClick={() => { setText(""); setCoreOnly(false); setFindingsOnly(false); setBindingIn(null); setParam("chapter", null) }}>Clear filters</Button>}>
                Try another chapter or search term.
              </Empty>
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[900px] text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      <th className="w-[70px] px-4 py-2 font-medium">No.</th>
                      <th className="px-3 py-2 font-medium">Requirement</th>
                      <th className="w-[200px] px-3 py-2 font-medium">References</th>
                      {canAssess && assessments.map((a) => (
                        <th key={a.id} className="w-[52px] px-1 py-2 text-center font-medium">
                          <Link to={`/assessments/${a.id}`} className="font-mono text-[11.5px] text-ink-2 hover:text-petrol" title={a.entity.name}>{a.entity.code}</Link>
                        </th>
                      ))}
                      {canAssess && <th className="w-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const ch = chapterById.get(r.chapter_id)
                      const header = ch && ch.number !== lastChapter
                      lastChapter = ch?.number ?? lastChapter
                      const cells = byReq.get(r.id) ?? []
                      return (
                        <Fragment key={r.id}>
                          {header && (
                            <tr className="border-b bg-muted/60">
                              <td colSpan={3 + (canAssess ? assessments.length + 1 : 0)} className="px-4 py-1.5">
                                <div className="flex items-center gap-2 text-[12.5px]">
                                  <Code className="text-ink-3">{ch.number}</Code>
                                  <button className="font-medium text-ink-2 hover:text-petrol" onClick={() => setParam("chapter", String(ch.number))}>{ch.title}</button>
                                  <Pill tone="brass" className="ml-2" title="Chapter target">Target {pct(ch.target)}</Pill>
                                  {canAssess && answersReady && (
                                    <span className="ml-auto flex w-[180px] items-center gap-2 text-[12px] text-ink-3">
                                      Group
                                      <ScoreBar className="flex-1" value={(() => { const a = chapterAvg.get(ch.id); return a && a.n ? a.sum / a.n : null })()} target={ch.target} />
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => navigate(`/catalog/${r.id}`)}>
                            <td className="px-4 py-2 align-top">
                              <Link to={`/catalog/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-petrol"><Code className="text-ink">{r.number}</Code></Link>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                                <span className="truncate">{r.section.replace(/^[\d.]+\s*/, "")}</span>
                                {r.is_core && <CorePill className="h-4 px-1 text-[10.5px]" />}
                              </div>
                              <div className="line-clamp-2 text-ink">{r.text}</div>
                            </td>
                            <td className="px-3 py-2 align-top text-[12px] text-ink-3">
                              {r.legal_reference && <div className="font-mono text-[11.5px] text-ink-2">{r.legal_reference}</div>}
                              {r.iso_reference && <div className="line-clamp-1">ISO <span className="font-mono text-[11.5px]">{r.iso_reference}</span></div>}
                              <JurisdictionPills tags={legal.byReq.get(r.id)} />
                            </td>
                            {canAssess && assessments.map((a, i) => (
                              <td key={a.id} className="px-1 py-2 align-top">
                                {cells[i] ? <StatusTile c={cells[i]} requirementId={r.id} /> : <div className="h-6 rounded-[3px] bg-muted/50" />}
                              </td>
                            ))}
                            {canAssess && <td />}
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {canAssess && assessments.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
              <span className="flex items-center gap-1.5">Score per entity in the current round
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => <span key={v} className="size-3 rounded-[2px]" style={{ background: scoreColor(v) }} />)}
              </span>
              <span>HQ = central at headquarters, n/a = not applicable. Click a tile to open the answer.</span>
            </div>
          )}
        </TabsContent>

        <TabsContent value="targets" className="space-y-5">
          <Section title="Chapter targets" bodyClassName="p-0">
            {loading ? <Loading /> : error ? <ErrorState error={error} className="m-4" /> : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      <th className="w-[50px] px-4 py-2 font-medium">No.</th>
                      <th className="px-3 py-2 font-medium">Chapter</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Requirements</th>
                      <th className="px-3 py-2 text-right font-medium">Target</th>
                      {canAssess && <th className="w-[220px] px-3 py-2 font-medium">Group average vs. target</th>}
                      {canAssess && <th className="px-3 py-2 text-right font-medium">Findings</th>}
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(chaptersQ.data ?? []).map((c) => {
                      const a = chapterAvg.get(c.id)
                      const avg = a && a.n ? a.sum / a.n : null
                      return (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="px-4 py-2"><Code>{c.number}</Code></td>
                          <td className="px-3 py-2">
                            <Link to={`/catalog?chapter=${c.number}`} className="hover:text-petrol">{c.title}</Link>
                            {c.description && <div className="text-[12px] text-ink-3">{c.description}</div>}
                          </td>
                          <td className="px-3 py-2 text-[12.5px] text-ink-2">{c.source}</td>
                          <td className="tabular px-3 py-2 text-right">{c.requirement_count}</td>
                          <td className="tabular px-3 py-2 text-right font-semibold text-brass">{pct(c.target)}</td>
                          {canAssess && <td className="px-3 py-2">{answersReady ? <ScoreBar value={avg} target={c.target} /> : <span className="text-[12px] text-ink-3">Loading…</span>}</td>}
                          {canAssess && <td className="tabular px-3 py-2 text-right text-ink-2">{a?.findings ?? "–"}</td>}
                          <td className="px-4 py-2 text-right">{canGlobal("catalog.manage") && <TargetDialog chapter={c} />}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Target history" bodyClassName="p-0">
            {historyQ.isLoading ? <Loading /> : historyQ.error ? <ErrorState error={historyQ.error} className="m-4" /> : !historyQ.data?.length ? (
              <Empty title="No target changes yet">Targets are 75% for most chapters and 100% for the registration and reporting chapters. Changes made here are listed with their reason.</Empty>
            ) : (
              <ul>
                {historyQ.data.map((t) => (
                  <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_160px] gap-3 border-b px-4 py-2.5 text-[13px] last:border-0 md:grid-cols-[minmax(0,1fr)_140px_200px]">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{t.chapter}</div>
                      <div className="text-[12.5px] text-ink-2">{t.reason}</div>
                    </div>
                    <div className="tabular text-[13px]"><span className="text-ink-3 line-through">{pct(t.old_target)}</span> <span className="font-semibold text-brass">{pct(t.new_target)}</span></div>
                    <div className="text-[12px] text-ink-3 md:text-right">{t.changed_by ?? "Unknown"}<div>{fmtDateTime(t.changed_at)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
