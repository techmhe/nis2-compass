import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Lock, Pencil, Plus, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, EntityTag, ErrorState, Loading, Meter, PageHeader, Pill, Section, Stat, StatusPill } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { AssessmentMetaDialog } from "@/components/assess/assessment-meta"
import { useAuth } from "@/hooks/useAuth"
import { useRounds, useUsers } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { fmtDate, pct, scoreColor } from "@/lib/format"
import type { AssessmentListItem, Round } from "@/lib/types"

const ROUND_STATUS = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
]

function Distribution({ dist, total }: { dist: Record<string, number>; total: number }) {
  const parts = [
    { k: "Yes", c: "var(--score-5)" },
    { k: "Partial", c: "var(--score-2)" },
    { k: "No", c: "var(--score-0)" },
    { k: "Not assessed", c: "var(--line-strong)" },
  ]
  if (!total) return <span className="text-[12px] text-ink-3">–</span>
  const label = parts.map((p) => `${p.k}: ${dist[p.k] ?? 0}`).join(", ")
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" title={label} aria-label={`Implemented answers. ${label}`}>
      {parts.map((p) => {
        const n = dist[p.k] ?? 0
        return n ? <div key={p.k} style={{ width: `${(n / total) * 100}%`, background: p.c }} /> : null
      })}
    </div>
  )
}

function NewRoundDialog({ rounds, onCreated }: { rounds: Round[]; onCreated: (r: Round) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const [makeCurrent, setMakeCurrent] = useState(true)
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () => api.post<Round>("/rounds", {
      name: name.trim(), description: description.trim() || null, start_date: start || null, end_date: end || null,
      copy_from_round_id: copyFrom ? Number(copyFrom) : null, make_current: makeCurrent,
    }),
    onSuccess: (r) => {
      toast.success(`Round "${r.name}" created`)
      qc.invalidateQueries({ queryKey: ["rounds"] })
      qc.invalidateQueries({ queryKey: ["assessments"] })
      qc.invalidateQueries({ queryKey: ["dash-gap"] })
      setOpen(false); setName(""); setDescription(""); setStart(""); setEnd(""); setCopyFrom(null); setMakeCurrent(true)
      onCreated(r)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o && !copyFrom) setCopyFrom(rounds.find((r) => r.is_current)?.id.toString() ?? null) }}>
      <DialogTrigger asChild><Button><Plus /> New round</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New assessment round</DialogTitle>
          <DialogDescription>Creates one assessment per active entity with a row for every active requirement.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2" htmlFor="round-name">
            <Input id="round-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Round 2 – 2027/28" />
          </Field>
          <Field label="Description" className="col-span-2" htmlFor="round-desc">
            <Textarea id="round-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Start date" htmlFor="round-start"><Input id="round-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End date" htmlFor="round-end"><Input id="round-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Copy answers from" className="col-span-2"
            hint="Scope, answers, evidence, gaps, actions, responsible, target dates and notes are pre-filled so assessors only confirm what changed.">
            <OptionSelect value={copyFrom} onChange={setCopyFrom} allowNone noneLabel="Start with empty answers"
              options={rounds.map((r) => ({ value: String(r.id), label: r.name }))} />
          </Field>
          <label className="col-span-2 flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
            <span className="text-[13px] text-ink">Make this the current round</span>
            <Switch checked={makeCurrent} onCheckedChange={setMakeCurrent} aria-label="Make this the current round" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create round"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditRoundDialog({ round }: { round: Round }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(round)
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      if (form.name.trim() !== round.name) body.name = form.name.trim()
      if ((form.description ?? "") !== (round.description ?? "")) body.description = form.description || null
      if ((form.start_date ?? "") !== (round.start_date ?? "")) body.start_date = form.start_date || null
      if ((form.end_date ?? "") !== (round.end_date ?? "")) body.end_date = form.end_date || null
      if (form.status !== round.status) body.status = form.status
      if (form.is_current && !round.is_current) body.is_current = true
      return Object.keys(body).length ? api.patch<Round>(`/rounds/${round.id}`, body) : Promise.resolve(null)
    },
    onSuccess: (r) => {
      if (r) {
        toast.success("Round saved")
        qc.invalidateQueries({ queryKey: ["rounds"] })
        qc.invalidateQueries({ queryKey: ["assessments"] })
      }
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(round) }}>
      <DialogTrigger asChild><Button variant="outline"><Settings2 /> Edit round</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit round</DialogTitle>
          <DialogDescription>Closing a round freezes the chapter targets that applied at that time.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2" htmlFor="er-name"><Input id="er-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description" className="col-span-2" htmlFor="er-desc">
            <Textarea id="er-desc" rows={2} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Start date" htmlFor="er-start"><Input id="er-start" type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value || null })} /></Field>
          <Field label="End date" htmlFor="er-end"><Input id="er-end" type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value || null })} /></Field>
          <Field label="Status"><OptionSelect value={form.status} onChange={(v) => setForm({ ...form, status: v ?? "active" })} options={ROUND_STATUS} /></Field>
          <label className="flex items-end justify-between gap-3 pb-2">
            <span className="text-[13px] text-ink">Current round</span>
            <Switch checked={form.is_current} disabled={round.is_current} onCheckedChange={(v) => setForm({ ...form, is_current: v })} aria-label="Current round" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function AssessmentsPage() {
  const { can, canGlobal } = useAuth()
  const rounds = useRounds()
  const users = useUsers()
  const [params, setParams] = useSearchParams()
  const roundParam = params.get("round")
  const roundId = roundParam ? Number(roundParam) : rounds.data?.find((r) => r.is_current)?.id ?? rounds.data?.[0]?.id ?? null
  const round = rounds.data?.find((r) => r.id === roundId)
  const list = useQuery({
    queryKey: ["assessments", roundId],
    queryFn: () => api.get<AssessmentListItem[]>("/assessments", { round_id: roundId }),
    enabled: roundId != null,
  })
  const userName = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.display_name])), [users.data])

  const totals = useMemo(() => {
    const rows = list.data ?? []
    const inScope = rows.reduce((s, r) => s + r.stats.in_scope, 0)
    const assessed = rows.reduce((s, r) => s + r.stats.assessed, 0)
    const scored = rows.filter((r) => r.stats.average_score != null)
    return {
      inScope, assessed,
      coverage: inScope ? assessed / inScope : null,
      findings: rows.reduce((s, r) => s + r.stats.work_packages, 0),
      completed: rows.filter((r) => r.status === "completed").length,
      average: scored.length ? scored.reduce((s, r) => s + (r.stats.average_score ?? 0), 0) / scored.length : null,
    }
  }, [list.data])

  const selectRound = (id: number) => setParams((p) => { p.set("round", String(id)); return p }, { replace: true })
  const manage = canGlobal("assessments.manage")

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="One GAP assessment per legal entity and round. Open an assessment to answer requirements, record findings and attach evidence."
        actions={
          <>
            <div className="w-64">
              <OptionSelect value={roundId != null ? String(roundId) : null} onChange={(v) => v && selectRound(Number(v))} placeholder="Select round"
                options={(rounds.data ?? []).map((r) => ({ value: String(r.id), label: r.name + (r.is_current ? " (current)" : "") }))} />
            </div>
            {manage && round && <EditRoundDialog round={round} />}
            {can("reports.export") && roundId != null && (
              <Button variant="outline" onClick={() => download(`/export/gap-workbook?round_id=${roundId}`, "NIS2_GAP_Analysis.xlsx").catch((e) => toast.error(e.message))}>
                <Download /> Export workbook
              </Button>
            )}
            {manage && <NewRoundDialog rounds={rounds.data ?? []} onCreated={(r) => selectRound(r.id)} />}
          </>
        }
      />

      {round && (
        <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Round" value={<span className="text-[16px]">{round.name}</span>}
            hint={<span className="inline-flex items-center gap-1.5"><Pill tone={round.status === "active" ? "petrol" : round.status === "closed" ? "outline" : "neutral"}>{ROUND_STATUS.find((x) => x.value === round.status)?.label ?? round.status}</Pill>{round.start_date ? `${fmtDate(round.start_date)} to ${fmtDate(round.end_date)}` : "No dates set"}</span>} />
          <Stat label="Coverage" value={pct(totals.coverage)} hint={`${totals.assessed} of ${totals.inScope} in-scope requirements assessed`} />
          <Stat label="Average score" value={pct(totals.average)} hint="Mean of the entity averages" tone="petrol" />
          <Stat label="Findings" value={totals.findings} hint="Answers that require a work package" />
          <Stat label="Completed" value={`${totals.completed} of ${list.data?.length ?? 0}`} hint="Entity assessments marked completed" />
        </div>
      )}

      <Section title={round ? `Entity assessments in ${round.name}` : "Entity assessments"} bodyClassName="p-0">
        {rounds.isLoading || list.isLoading ? <Loading /> : rounds.error ? <ErrorState error={rounds.error} className="m-4" /> : list.error ? <ErrorState error={list.error} className="m-4" /> :
          !rounds.data?.length ? (
            <Empty title="No assessment round yet" action={manage ? <NewRoundDialog rounds={[]} onCreated={(r) => selectRound(r.id)} /> : undefined}>
              {manage ? "Create the first round to start assessing the entities." : "An assessment manager has to create the first round."}
            </Empty>
          ) : !list.data?.length ? (
            <Empty title="No assessments you can see in this round">You only see the entities you have been given access to.</Empty>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[1080px] text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="px-4 py-2 font-medium">Entity</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="w-[180px] px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 text-right font-medium">Average score</th>
                    <th className="px-3 py-2 text-right font-medium">Findings</th>
                    <th className="px-3 py-2 text-right font-medium">Core covered</th>
                    <th className="w-[140px] px-3 py-2 font-medium">Implemented</th>
                    <th className="px-3 py-2 font-medium">Assessment date</th>
                    <th className="px-3 py-2 font-medium">Lead</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((a) => {
                    const s = a.stats
                    const canManage = can("assessments.manage", a.entity_id)
                    const canEdit = can("assessments.edit", a.entity_id)
                    return (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <EntityTag code={a.entity.code} name={a.entity.name} />
                            <Link to={`/entities/${a.entity.id}`} className="font-medium text-ink hover:text-petrol">{a.entity.name}</Link>
                            {a.entity.country && <span className="text-[12px] text-ink-3">{a.entity.country}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusPill value={a.status} />
                            {a.locked && (
                              <Tooltip>
                                <TooltipTrigger asChild><Lock className="size-3.5 text-ink-3" aria-label="Locked" /></TooltipTrigger>
                                <TooltipContent>Locked: only assessment managers can change answers</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Meter value={s.coverage ?? 0} className="flex-1" />
                            <span className="tabular w-[60px] text-right text-[12px] text-ink-2">{s.assessed}/{s.in_scope}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="tabular inline-flex items-center gap-1.5 font-medium">
                            <span className="size-2 rounded-[2px]" style={{ background: scoreColor(s.average_score) }} />
                            {pct(s.average_score)}
                          </span>
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">{s.work_packages || <span className="text-ink-3">0</span>}</td>
                        <td className="tabular px-3 py-2.5 text-right text-ink-2" title="Core requirements assessed of core requirements in scope">
                          {s.core_assessed}/{s.core_total}
                        </td>
                        <td className="px-3 py-2.5"><Distribution dist={s.answer_distribution} total={s.in_scope} /></td>
                        <td className="tabular px-3 py-2.5 text-ink-2">
                          {fmtDate(a.assessment_date)}
                          {a.due_date && <div className="text-[11.5px] text-ink-3">due {fmtDate(a.due_date)}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-ink-2">{a.lead_user_id ? userName.get(a.lead_user_id) ?? "–" : <span className="text-ink-3">Not set</span>}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {(canManage || canEdit) && (
                              <AssessmentMetaDialog assessment={a} canManage={canManage} canEdit={canEdit} roundName={a.round_name}
                                trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit details of ${a.entity.name}`}><Pencil /></Button>} />
                            )}
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/assessments/${a.id}`}>Open</Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Section>
      {list.data && list.data.some((a) => a.respondents || a.assessors) && (
        <Section title="Participants" className="mt-5" bodyClassName="p-0">
          <ul>
            {list.data.map((a) => (
              <li key={a.id} className="grid grid-cols-[160px_1fr_1fr] gap-4 border-b px-4 py-2 text-[13px] last:border-0">
                <span className="flex items-center gap-2"><Code>{a.entity.code}</Code><span className="truncate text-ink-2">{a.entity.name}</span></span>
                <span><span className="text-ink-3">Respondents </span>{a.respondents || <span className="text-ink-3">–</span>}</span>
                <span><span className="text-ink-3">Assessors </span>{a.assessors || <span className="text-ink-3">–</span>}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {round?.targets_snapshot && (
        <p className="mt-3 text-[12px] text-ink-3">
          <Pill tone="brass">Targets frozen</Pill> This round is closed; its dashboard uses the chapter targets that applied when it was closed.
        </p>
      )}
    </div>
  )
}
