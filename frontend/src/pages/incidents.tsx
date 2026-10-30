import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search, Siren, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Code, EntityTag, Empty, ErrorState, Loading, PageHeader, Stat, StatusPill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { CreateIncidentDialog } from "@/components/incidents/create-dialog"
import { RecurringGroups } from "@/components/incidents/reporting"
import type { IncidentX } from "@/components/incidents/reporting-types"
import { ClockBadge, clockSummary, SeverityPill, SignificantTag, useNow } from "@/components/incidents/shared"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { INCIDENT_SEVERITY, INCIDENT_STATUS } from "@/lib/constants"
import { fmtDateTime, toDate } from "@/lib/format"
import type { Incident } from "@/lib/types"

const SEV_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }

export default function IncidentsPage() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const now = useNow()
  const entities = useEntities()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [severity, setSeverity] = useState<string | null>(null)
  const [entity, setEntity] = useState<string | null>(null)
  const [significantOnly, setSignificantOnly] = useState(false)
  const [showClosed, setShowClosed] = useState(true)

  const list = useQuery({ queryKey: ["incidents", "list"], queryFn: () => api.get<Incident[]>("/incidents"), refetchInterval: 60_000 })
  const all = list.data ?? []

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((i) => {
      if (status && i.status !== status) return false
      if (!showClosed && !status && i.status === "Closed") return false
      if (severity && i.severity !== severity) return false
      if (entity && String(i.entity?.id ?? "group") !== entity) return false
      if (significantOnly && !i.is_significant) return false
      if (needle && !`${i.code} ${i.title} ${i.category ?? ""} ${i.description ?? ""}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [all, q, status, severity, entity, significantOnly, showClosed])

  const stats = useMemo(() => {
    const open = all.filter((i) => i.status === "Open" || i.status === "Contained")
    let overdue = 0, dueSoon = 0
    for (const i of all as IncidentX[]) {
      if (i.track_count) {
        // report tracks: count the next open deadline per incident
        const n = i.next_deadline
        if (n) {
          const due = toDate(n.due_at)!.getTime()
          if (due < now) overdue += 1
          else if (due - now < 24 * 3_600_000) dueSoon += 1
        }
        continue
      }
      for (const s of i.reporting) {
        if (s.done_at) continue
        const due = toDate(s.due)!.getTime()
        if (due < now) overdue += 1
        else if (due - now < 24 * 3_600_000) dueSoon += 1
      }
    }
    return {
      open: open.length,
      significant: open.filter((i) => i.is_significant).length,
      unassessed: open.filter((i) => i.is_significant == null).length,
      overdue,
      dueSoon,
    }
  }, [all, now])

  const canCreate = canAny("incidents.manage")
  const filtersActive = !!(q || status || severity || entity || significantOnly)

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Security incident register with the NIS-2 Art. 23 reporting duties per affected entity and authority: early warning within 24 hours, incident notification within 72 hours and a final report within one month."
        actions={canCreate && (
          <CreateIncidentDialog onCreated={(i) => navigate(`/incidents/${i.id}`)} trigger={<Button data-tour="incidents.record"><Plus /> Record incident</Button>} />
        )}
      />

      {list.data && all.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-4">
          <Stat label="Open incidents" value={stats.open} hint="Open or contained" />
          <Stat label="Significant and open" value={stats.significant} tone={stats.significant ? "alarm" : undefined}
            hint={stats.unassessed ? `${stats.unassessed} not yet assessed` : "all assessed"} />
          <Stat label="Reports overdue" value={stats.overdue} tone={stats.overdue ? "alarm" : undefined} hint="Early warning, notification or final report" />
          <Stat label="Reports due within 24 h" value={stats.dueSoon} tone={stats.dueSoon ? "amber" : undefined} />
        </div>
      )}

      <RecurringGroups />

      <div data-tour="incidents.list" className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[300px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title, category" className="pl-8" aria-label="Search incidents" />
        </div>
        <OptionSelect className="w-36" value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses" options={INCIDENT_STATUS} />
        <OptionSelect className="w-36" value={severity} onChange={setSeverity} allowNone noneLabel="All severities" placeholder="All severities" options={INCIDENT_SEVERITY} />
        <OptionSelect className="w-44" value={entity} onChange={setEntity} allowNone noneLabel="All entities" placeholder="All entities"
          options={[{ value: "group", label: "Group-wide" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))]} />
        <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
          <Switch id="sig-only" checked={significantOnly} onCheckedChange={setSignificantOnly} />
          <Label htmlFor="sig-only" className="text-[13px] font-normal text-ink-2">Significant only</Label>
        </div>
        <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
          <Switch id="show-closed" checked={showClosed} onCheckedChange={setShowClosed} />
          <Label htmlFor="show-closed" className="text-[13px] font-normal text-ink-2">Show closed</Label>
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setStatus(null); setSeverity(null); setEntity(null); setSignificantOnly(false) }}><X /> Clear filters</Button>
        )}
      </div>

      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : all.length === 0 ? (
          <Empty title="No incidents recorded" icon={<Siren className="size-6" />}
            action={canCreate && <CreateIncidentDialog onCreated={(i) => navigate(`/incidents/${i.id}`)} trigger={<Button size="sm"><Plus /> Record incident</Button>} />}>
            Record security incidents here, including near misses. For significant incidents the page tracks the reporting deadlines to the authorities.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="No incidents match these filters">Remove a filter or search for something else.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Incident</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Severity</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Significance</th>
                  <th className="px-2 py-2 font-medium">Next deadline</th>
                  <th className="px-2 py-2 font-medium">Aware since</th>
                  <th className="px-2 py-2 pr-4 font-medium">Handler</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => {
                  const ra = clockSummary(a, now).tone === "alarm" ? 0 : 1, rb = clockSummary(b, now).tone === "alarm" ? 0 : 1
                  if (ra !== rb) return ra - rb
                  const ca = a.status === "Closed" ? 1 : 0, cb = b.status === "Closed" ? 1 : 0
                  if (ca !== cb) return ca - cb
                  return (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || b.id - a.id
                }).map((i) => (
                  <tr key={i.id} className="border-b align-top last:border-0 hover:bg-muted/50">
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{i.code}</Code>
                        <div className="min-w-0">
                          <Link to={`/incidents/${i.id}`} className="font-medium text-ink hover:text-petrol">{i.title}</Link>
                          {i.category && <div className="mt-0.5 text-[12px] text-ink-3">{i.category}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">{i.entity ? <EntityTag code={i.entity.code} name={i.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}</td>
                    <td className="px-2 py-2"><SeverityPill value={i.severity} /></td>
                    <td className="px-2 py-2"><StatusPill value={i.status} /></td>
                    <td className="px-2 py-2"><SignificantTag value={i.is_significant} /></td>
                    <td className="px-2 py-2">
                      <ClockBadge incident={i} now={now} />
                      {(i as IncidentX).next_deadline && (
                        <div className="mt-0.5 text-[12px] text-ink-3">{(i as IncidentX).next_deadline!.entity_code}, {(i as IncidentX).next_deadline!.authority}</div>
                      )}
                    </td>
                    <td className="tabular px-2 py-2 text-[12.5px] whitespace-nowrap text-ink-2">{fmtDateTime(i.aware_at ?? i.detected_at)}</td>
                    <td className="px-2 py-2 pr-4 text-ink-2">{i.handler_name ?? <span className="text-ink-3">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
