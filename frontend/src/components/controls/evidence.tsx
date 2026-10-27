import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { FileCheck2, Search } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Code, EntityTag, Empty, ErrorState, Loading, Section } from "@/components/common/basics"
import { EntitySelect, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useRounds } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { FRESHNESS_LABEL, FreshnessPill } from "./shared"
import type { EvidenceData, Freshness } from "./types"

const FILTERS: { value: string; label: string; match: (s: Freshness) => boolean }[] = [
  { value: "attention", label: "Stale or ageing", match: (s) => s === "stale" || s === "ageing" },
  { value: "stale", label: "Stale", match: (s) => s === "stale" },
  { value: "ageing", label: "Ageing", match: (s) => s === "ageing" },
  { value: "none", label: "No evidence", match: (s) => s === "none" },
  { value: "fresh", label: "Fresh", match: (s) => s === "fresh" },
  { value: "all", label: "All statuses", match: () => true },
]

const BAR: Record<Freshness, string> = { fresh: "bg-petrol", ageing: "bg-amber", stale: "bg-alarm", none: "bg-muted" }

export function EvidenceTab() {
  const { canAny } = useAuth()
  const rounds = useRounds()
  const [roundId, setRoundId] = useState<number | null>(null)
  const [entity, setEntity] = useState<number | null>(null)
  const [filter, setFilter] = useState("attention")
  const [onlyImplemented, setOnlyImplemented] = useState(true)
  const [q, setQ] = useState("")
  const current = roundId ?? rounds.data?.find((r) => r.is_current)?.id ?? null
  const data = useQuery({
    queryKey: ["controls", "evidence", current, entity],
    queryFn: () => api.get<EvidenceData>("/controls/evidence", { round_id: current, entity_id: entity }),
    enabled: canAny("assessments.read"),
  })
  const match = FILTERS.find((f) => f.value === filter)!.match
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data.data?.items ?? []).filter((r) => match(r.status)
      && (r.status !== "none" || !onlyImplemented || r.implemented === "Yes" || r.implemented === "Partial")
      && (!needle || `${r.requirement.number} ${r.requirement.section} ${r.source_label ?? ""}`.toLowerCase().includes(needle)))
  }, [data.data, match, q, onlyImplemented])

  if (!canAny("assessments.read")) {
    return <Empty title="No access to assessments">Evidence freshness is derived from the assessment answers, which you cannot view.</Empty>
  }
  return (
    <div className="space-y-5">
      <p className="max-w-[90ch] text-[13px] text-ink-3">
        For each in-scope answer, the newest evidence is the latest version of a document linked to the answer or the last effective occurrence of a control
        activity linked to the requirement. Evidence is ageing after 80% of the validity period and stale after it; the validity comes from the linked activity (default 365 days).
      </p>

      {data.data && data.data.summary.length > 0 && (
        <Section title="Freshness per entity">
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {data.data.summary.map((s) => {
              const total = s.fresh + s.ageing + s.stale + s.none
              return (
                <li key={s.entity.id}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2"><EntityTag code={s.entity.code} name={s.entity.name} /> {s.entity.name}</span>
                    <span className="tabular text-[12px] text-ink-3">{s.stale} stale, {s.ageing} ageing, {s.fresh} fresh</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img"
                    aria-label={`${s.entity.code}: ${s.fresh} fresh, ${s.ageing} ageing, ${s.stale} stale, ${s.none} without evidence`}>
                    {(["fresh", "ageing", "stale", "none"] as Freshness[]).map((k) => (
                      <div key={k} className={BAR[k]} style={{ width: `${total ? (s[k] / total) * 100 : 0}%` }} title={`${FRESHNESS_LABEL[k]}: ${s[k]}`} />
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requirement or source" className="pl-8" aria-label="Search evidence" />
        </div>
        <div className="w-60">
          <OptionSelect value={current ? String(current) : null} onChange={(v) => setRoundId(v ? Number(v) : null)}
            options={(rounds.data ?? []).map((r) => ({ value: String(r.id), label: r.name + (r.is_current ? " (current)" : "") }))} />
        </div>
        <div className="w-48"><EntitySelect value={entity} onChange={setEntity} groupLabel="All entities" /></div>
        <div className="w-44"><OptionSelect value={filter} onChange={(v) => setFilter(v ?? "attention")} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} /></div>
        {(filter === "none" || filter === "all") && (
          <label className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-[13px] text-ink-2">
            <Checkbox checked={onlyImplemented} onCheckedChange={(v) => setOnlyImplemented(v === true)} />
            Without evidence: only answers marked implemented
          </label>
        )}
      </div>

      <div className="rounded-md border bg-card">
        {data.isLoading ? <Loading /> : data.error ? <ErrorState error={data.error} className="m-4" /> : rows.length === 0 ? (
          <Empty title={filter === "attention" ? "No stale or ageing evidence" : "No answers match these filters"} icon={<FileCheck2 className="size-6" />}>
            {filter === "attention" ? "All evidence is within its validity period." : "Change the filters to see more answers."}
          </Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Requirement</th>
                  <th className="px-2 py-2 font-medium">Implemented</th>
                  <th className="px-2 py-2 font-medium">Newest evidence</th>
                  <th className="px-2 py-2 text-right font-medium">Age</th>
                  <th className="px-2 py-2 pr-4 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.answer_id} className="border-b align-top last:border-0 hover:bg-muted/50">
                    <td className="py-2 pr-2 pl-4"><FreshnessPill status={r.status} /></td>
                    <td className="px-2 py-2"><EntityTag code={r.entity.code} name={r.entity.name} /></td>
                    <td className="px-2 py-2">
                      <Link to={`/assessments/${r.assessment_id}?req=${r.requirement.id}&chapter=${r.requirement.chapter}`} className="flex items-baseline gap-2 hover:text-petrol">
                        <Code className="shrink-0">{r.requirement.number}</Code>
                        <span className="line-clamp-1">{r.requirement.section.replace(/^[\d.]+\s*/, "")}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-ink-2">{r.implemented ?? <span className="text-ink-3">–</span>}</td>
                    <td className="tabular px-2 py-2 whitespace-nowrap text-ink-2">{fmtDate(r.last_evidence_at)}</td>
                    <td className="tabular px-2 py-2 text-right whitespace-nowrap text-ink-2">
                      {r.age_days != null ? `${r.age_days} of ${r.validity_days} d` : <span className="text-ink-3">{r.validity_days} d valid</span>}
                    </td>
                    <td className="px-2 py-2 pr-4 text-[12.5px] text-ink-2">
                      {r.source === "control" && r.activities.length ? (
                        <Link to={`/controls/activities?activity=${r.activities[0].id}`} className="hover:text-petrol">{r.source_label}</Link>
                      ) : r.source_label ?? (r.activities.length ? (
                        <span className="text-ink-3">Planned by {r.activities.map((a) => a.code).join(", ")}</span>
                      ) : <span className="text-ink-3">Link a document to the answer or a control activity to the requirement</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <p className="px-4 py-2 text-[12px] text-ink-3">Showing the first 500 of {rows.length} answers. Narrow the filters to see the rest.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
