import { useMemo, useState } from "react"
import { Link, NavLink, Navigate, Route, Routes } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, Camera, Download, FileArchive, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, Empty, ErrorState, Loading, PageHeader, Pill, ScoreBar, ScoreChip, Section, Stat, StatusPill } from "@/components/common/basics"
import { EntitySelect, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { fmtDate, fmtDateTime, pct } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ManagementReport {
  title: string
  generated_at: string
  round: { id: number; name: string }
  scope: { entity_id: number | null; entity_name: string | null }
  totals: { in_scope: number; assessed: number; work_packages: number; average_score: number | null; coverage: number | null }
  entities: { code: string; name: string; coverage: number | null; average_score: number | null; work_packages: number; status: string }[]
  chapters: { chapter: number; title: string; target: number; group_average: number | null; gap_to_target: number | null; work_packages: number }[]
  trend: { round: string; average_score: number | null; coverage: number | null }[]
  action_plan: { total: number; by_status: Record<string, number>; overdue: number; unplanned_findings: number
    overdue_items: { code: string; title: string; entity: string; priority: string; target_date: string | null; responsible: string | null }[] }
  project: { name: string; planned_finish: string | null; progress: number; completed: number; total: number
    overdue: { code: string; title: string; planned_finish: string | null }[]
    gates: { code: string; decision: string | null; planned_date: string | null; status: string }[] } | null
  incidents: { last_12_months: number; significant: number; early_warning_on_time: number; open: number } | null
  documents: { total: number; review_overdue: number; policies_not_approved: number } | null
  sections: Record<string, { title: string; items: { label: string; value: string | number; tone?: string }[]; notes?: string[] }>
}

interface SoA {
  title: string
  round: string
  generated_at: string
  summary: Record<string, number>
  note: string
  rows: { key: string; title: string; kind: string; group: string; requirements: string[]; answers: number; status: string; average_score: number | null; findings: number; gaps: string[] }[]
}

const SOA_TONE: Record<string, string> = {
  Implemented: "sage", "Partially implemented": "amber", "Not implemented": "alarm", "Not assessed": "outline",
  "Not applicable": "neutral", "Inherited (central at HQ)": "petrol", "Not covered by NIS-2 catalogue": "outline",
}

function Tabs() {
  const { canAny } = useAuth()
  const tab = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => cn("border-b-2 px-1 pb-2 text-[13.5px]", isActive ? "border-petrol font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
      {label}
    </NavLink>
  )
  return (
    <div data-tour="programme.reports" className="mb-5 flex gap-5 border-b print:hidden">
      {tab("/reports/management", "Management report")}
      {tab("/reports/soa", "ISO 27001 applicability")}
      {tab("/reports/evidence", "Evidence pack")}
      {canAny("reports.export") && tab("/reports/snapshots", "Saved snapshots")}
    </div>
  )
}

function ManagementView({ data }: { data: ManagementReport }) {
  const top = data.chapters.filter((c) => (c.gap_to_target ?? 0) > 0).slice(0, 8)
  return (
    <article className="space-y-5 print:space-y-4">
      <header className="rounded-md border bg-card px-5 py-4">
        <h2 className="text-[20px] font-semibold">{data.title}</h2>
        <p className="text-[13px] text-ink-3">Assessment round {data.round.name}. Generated {fmtDate(data.generated_at)}.</p>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Assessment coverage" value={pct(data.totals.coverage)} hint={`${data.totals.assessed} of ${data.totals.in_scope}`} />
          <Stat label="Average score" value={pct(data.totals.average_score)} tone="petrol" />
          <Stat label="Findings" value={data.totals.work_packages} hint={`${data.action_plan.unplanned_findings} not yet planned`} />
          <Stat label="Overdue actions" value={data.action_plan.overdue} tone={data.action_plan.overdue ? "alarm" : undefined} hint={`of ${data.action_plan.total} in the action plan`} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2 print:grid-cols-2">
        <Section title="Entities">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[12px] text-ink-3"><th className="pb-1.5 font-medium">Entity</th><th className="pb-1.5 font-medium">Coverage</th><th className="pb-1.5 text-right font-medium">Score</th><th className="pb-1.5 text-right font-medium">Findings</th></tr></thead>
            <tbody>
              {data.entities.map((e) => (
                <tr key={e.code} className="border-t">
                  <td className="py-1.5">{e.name} <Code className="text-ink-3">{e.code}</Code></td>
                  <td className="tabular py-1.5">{pct(e.coverage)}</td>
                  <td className="py-1.5 text-right"><ScoreChip value={e.average_score} /></td>
                  <td className="tabular py-1.5 text-right">{e.work_packages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Largest gaps to chapter target">
          {top.length === 0 ? <p className="text-[13px] text-ink-3">All assessed chapters meet their target.</p> : (
            <ul className="space-y-2">
              {top.map((c) => (
                <li key={c.chapter} className="grid grid-cols-[1fr_140px] items-center gap-3 text-[13px]">
                  <span className="truncate"><Code className="mr-1.5 text-ink-3">{c.chapter}</Code>{c.title}</span>
                  <ScoreBar value={c.group_average} target={c.target} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Overdue action plan items" bodyClassName="p-0">
        {data.action_plan.overdue_items.length === 0 ? <p className="p-4 text-[13px] text-ink-3">No overdue items.</p> : (
          <table className="w-full text-[13px]">
            <tbody>
              {data.action_plan.overdue_items.map((i) => (
                <tr key={i.code} className="border-b last:border-0">
                  <td className="px-4 py-2"><Code>{i.code}</Code></td>
                  <td className="py-2"><Code className="text-ink-3">{i.entity}</Code></td>
                  <td className="py-2">{i.title}</td>
                  <td className="py-2"><StatusPill value={i.priority} /></td>
                  <td className="py-2 text-ink-3">{i.responsible ?? "–"}</td>
                  <td className="tabular px-4 py-2 text-right text-alarm">{fmtDate(i.target_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-3 print:grid-cols-3">
        {data.project && (
          <Section title="Implementation project">
            <Stat label="Progress" value={pct(data.project.progress)} hint={`${data.project.completed} of ${data.project.total} activities completed`} />
            <ul className="mt-3 space-y-1 text-[12.5px]">
              {data.project.gates.slice(0, 6).map((g) => (
                <li key={g.code} className="flex justify-between gap-2"><span>{g.code}</span><span className="text-ink-3">{fmtDate(g.planned_date)}</span><StatusPill value={g.status} /></li>
              ))}
            </ul>
          </Section>
        )}
        {data.incidents && (
          <Section title="Incidents (last 12 months)">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Recorded" value={data.incidents.last_12_months} />
              <Stat label="Significant" value={data.incidents.significant} />
              <Stat label="Early warning within 24 h" value={`${data.incidents.early_warning_on_time}/${data.incidents.significant}`} />
              <Stat label="Open" value={data.incidents.open} />
            </div>
          </Section>
        )}
        {data.documents && (
          <Section title="Policies and documents">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Documents" value={data.documents.total} />
              <Stat label="Review overdue" value={data.documents.review_overdue} tone={data.documents.review_overdue ? "alarm" : undefined} />
              <Stat label="Policies not approved" value={data.documents.policies_not_approved} tone={data.documents.policies_not_approved ? "amber" : undefined} />
            </div>
          </Section>
        )}
      </div>

      {Object.entries(data.sections).map(([key, s]) => (
        <Section key={key} title={s.title}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {s.items.map((it) => <Stat key={it.label} label={it.label} value={it.value} tone={it.tone as "alarm" | undefined} />)}
          </div>
          {s.notes?.length ? <ul className="mt-3 list-disc pl-5 text-[13px] text-ink-2">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        </Section>
      ))}

      {data.trend.length > 1 && (
        <Section title="Progress over assessment rounds">
          <table className="w-full text-[13px]">
            <tbody>{data.trend.map((t) => <tr key={t.round} className="border-t first:border-0"><td className="py-1.5">{t.round}</td><td className="tabular">coverage {pct(t.coverage)}</td><td className="tabular text-right">score {pct(t.average_score)}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
    </article>
  )
}

function ManagementTab() {
  const { canAny } = useAuth()
  const qc = useQueryClient()
  const [entity, setEntity] = useState<number | null>(null)
  const q = useQuery({ queryKey: ["report-management", entity], queryFn: () => api.get<ManagementReport>("/reports/management", { entity_id: entity }) })
  const snap = useMutation({
    mutationFn: () => api.post<{ id: number }>("/reports/snapshots", { kind: "management", entity_id: entity }),
    onSuccess: () => { toast.success("Snapshot saved"); qc.invalidateQueries({ queryKey: ["report-snapshots"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <div className="w-72"><EntitySelect value={entity} onChange={setEntity} groupLabel="Whole group" /></div>
        {canAny("reports.export") && (
          <Button variant="outline" onClick={() => download(`/reports/management.pdf${entity ? `?entity_id=${entity}` : ""}`, "NIS2_management_report.pdf").catch((e) => toast.error(e.message))}>
            <Download /> Download PDF
          </Button>
        )}
        <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
        {canAny("reports.export") && <Button variant="outline" onClick={() => snap.mutate()} disabled={snap.isPending}><Camera /> Save snapshot</Button>}
        <span className="text-[12.5px] text-ink-3">Snapshots freeze the figures so later reports can be compared with what management saw.</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data && <ManagementView data={q.data} />}
    </div>
  )
}

function SoATab() {
  const [entity, setEntity] = useState<number | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [text, setText] = useState("")
  const q = useQuery({ queryKey: ["report-soa", entity], queryFn: () => api.get<SoA>("/reports/soa", { entity_id: entity }) })
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) =>
    (!filter || r.status === filter) &&
    (!text || `${r.key} ${r.title} ${r.requirements.join(" ")}`.toLowerCase().includes(text.toLowerCase()))), [q.data, filter, text])
  const exportCsv = () => {
    if (!q.data) return
    const esc = (v: string) => `"${v.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`
    const lines = [["Clause/control", "Title", "Status", "Average score", "Findings", "NIS-2 requirements", "Gaps"].map(esc).join(";")]
    for (const r of q.data.rows) lines.push([r.key, r.title, r.status, r.average_score == null ? "" : pct(r.average_score), String(r.findings), r.requirements.join(", "), r.gaps.join(" | ")].map(esc).join(";"))
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "statement_of_applicability.csv"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <div className="w-72"><EntitySelect value={entity} onChange={setEntity} groupLabel="Whole group" /></div>
        <div className="w-64"><OptionSelect value={filter} onChange={setFilter} allowNone noneLabel="All statuses" placeholder="All statuses" options={Object.keys(SOA_TONE)} /></div>
        <Input className="w-64" placeholder="Filter by control, title or requirement" value={text} onChange={(e) => setText(e.target.value)} />
        <Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
        <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(q.data.summary).map(([k, v]) => <Pill key={k} tone={SOA_TONE[k] ?? "neutral"}>{k}: {v}</Pill>)}
          </div>
          <p className="mb-3 max-w-[90ch] text-[12.5px] text-ink-3">{q.data.note}</p>
          <div className="overflow-hidden rounded-md border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-ink-3">
                <tr><th className="px-3 py-2 font-medium">Control</th><th className="py-2 font-medium">Title</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Score</th><th className="py-2 font-medium">NIS-2 requirements</th><th className="px-3 py-2 text-right font-medium">Findings</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t align-top">
                    <td className="px-3 py-2"><Code>{r.key}</Code></td>
                    <td className="py-2 pr-3">{r.title}{r.gaps.length > 0 && <div className="mt-1 text-[12px] text-ink-3">{r.gaps[0]}{r.gaps.length > 1 ? ` (+${r.gaps.length - 1} more)` : ""}</div>}</td>
                    <td className="py-2 pr-3"><Pill tone={SOA_TONE[r.status] ?? "neutral"}>{r.status}</Pill></td>
                    <td className="py-2 pr-3"><ScoreChip value={r.average_score} /></td>
                    <td className="py-2 pr-3"><span className="font-mono text-[12px] text-ink-2">{r.requirements.slice(0, 8).join(", ")}{r.requirements.length > 8 ? " …" : ""}</span></td>
                    <td className="tabular px-3 py-2 text-right">{r.findings || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Empty title="No controls match the filter" />}
          </div>
        </>
      )}
    </div>
  )
}

function EvidenceTab() {
  const { can } = useAuth()
  const { data: entities = [] } = useEntities()
  const [busy, setBusy] = useState<number | null>(null)
  const get = async (id: number, code: string) => {
    setBusy(id)
    try {
      await download(`/reports/evidence-pack?entity_id=${id}`, `NIS2_evidence_pack_${code}.zip`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[13.5px] text-ink-2">
        For important entities, supervision in Germany (§ 62 BSIG) and the Netherlands (Cbw) is reactive: after an
        incident or a complaint the authority can ask for proof. The evidence pack bundles, per entity, the current
        assessment answers, the action plan, the list of documents with version hashes and the files of linked
        evidence and approved policies, ready to hand over.
      </p>
      <Section bodyClassName="p-0">
        <ul>
          {entities.map((e) => (
            <li key={e.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
              <FileArchive className="size-4 text-ink-3" />
              <span className="flex-1 text-[13.5px]">{e.name} <Code className="text-ink-3">{e.code}</Code></span>
              <Button size="sm" variant="outline" disabled={!can("reports.export", e.id) || !can("assessments.read", e.id) || busy === e.id}
                onClick={() => get(e.id, e.code)}>
                <Archive /> {busy === e.id ? "Preparing…" : "Download evidence pack"}
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function SnapshotsTab() {
  const { data: entities = [] } = useEntities()
  const [open, setOpen] = useState<number | null>(null)
  const list = useQuery({ queryKey: ["report-snapshots"], queryFn: () => api.get<{ id: number; kind: string; title: string; entity_id: number | null; created_at: string }[]>("/reports/snapshots") })
  const snap = useQuery({ queryKey: ["report-snapshot", open], queryFn: () => api.get<{ data: ManagementReport; kind: string }>(`/reports/snapshots/${open}`), enabled: open != null })
  if (open != null) {
    return (
      <div>
        <Button variant="outline" size="sm" className="mb-4 print:hidden" onClick={() => setOpen(null)}>Back to snapshots</Button>
        {snap.isLoading ? <Loading /> : snap.data?.kind === "management" ? <ManagementView data={snap.data.data} /> : <p className="text-[13px] text-ink-3">This snapshot type is shown as raw data.</p>}
      </div>
    )
  }
  return list.isLoading ? <Loading /> : (list.data ?? []).length === 0 ? (
    <Empty title="No snapshots yet" >Save a snapshot from the management report to keep a record of what was reported.</Empty>
  ) : (
    <Section bodyClassName="p-0">
      <ul>
        {(list.data ?? []).map((s) => (
          <li key={s.id}>
            <button className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-0 hover:bg-muted/60" onClick={() => setOpen(s.id)}>
              <span className="flex-1 text-[13.5px]">{s.title}</span>
              <span className="text-[12px] text-ink-3">{s.entity_id ? entities.find((e) => e.id === s.entity_id)?.code : "Group"}</span>
              <span className="tabular text-[12px] text-ink-3">{fmtDateTime(s.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export default function ReportsPage() {
  return (
    <div>
      <PageHeader className="print:hidden" title="Reports" description="Management reporting, ISO 27001 applicability derived from the assessment, and evidence packs for authorities and auditors." />
      <Tabs />
      <Routes>
        <Route index element={<Navigate to="management" replace />} />
        <Route path="management" element={<ManagementTab />} />
        <Route path="soa" element={<SoATab />} />
        <Route path="evidence" element={<EvidenceTab />} />
        <Route path="snapshots" element={<SnapshotsTab />} />
        <Route path="*" element={<Link to="/reports/management">Open the management report</Link>} />
      </Routes>
    </div>
  )
}
