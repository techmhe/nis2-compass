import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Repeat } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Code, EntityTag, ErrorState, KV } from "@/components/common/basics"
import { Field, OptionSelect, Segmented } from "@/components/common/fields"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { eur, type Recurring, type RecurringGroup, type ReportingOverview } from "./reporting-types"

export function useReporting(incidentId: number) {
  const qc = useQueryClient()
  const key = ["incidents", "reporting", incidentId]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<ReportingOverview>(`/incident-reporting/incidents/${incidentId}`), enabled: Number.isFinite(incidentId) })
  /** Store a fresh overview and refresh the incident (significance, timeline, legacy clock) and the list. */
  const update = (o: ReportingOverview) => {
    qc.setQueryData(key, o)
    qc.invalidateQueries({ queryKey: ["incidents", "detail", incidentId] })
    qc.invalidateQueries({ queryKey: ["incidents", "list"] })
  }
  const reload = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ["incidents", "detail", incidentId] })
    qc.invalidateQueries({ queryKey: ["incidents", "list"] })
  }
  return { ...q, update, reload }
}

/** IR 2024/2690 Art. 4: incidents with the same root cause within 6 months may jointly be significant. */
export function RecurringBanner({ r, currentId }: { r: Recurring; currentId: number }) {
  return (
    <div className="mb-5 flex gap-3 rounded-md border border-brass/50 bg-brass-50/60 px-4 py-3 text-[13px]" role="note">
      <Repeat className="mt-0.5 size-4 shrink-0 text-brass" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">
          Recurring incident: {r.count} incidents with the root cause “{r.category_label}” within 6 months
        </p>
        <p className="mt-0.5 text-ink-2">
          Under IR 2024/2690 Art. 4, incidents that individually are not significant count as one significant incident if they occurred at least twice
          within 6 months, have the same apparent root cause and together exceed the financial threshold. Combined loss {eur(r.combined_loss_eur)} against
          a threshold of {eur(r.threshold_eur)}{r.turnover_known ? "" : " (turnover not recorded)"}:{" "}
          <span className={r.meets_financial_criterion ? "font-medium text-alarm" : "text-ink"}>
            {r.meets_financial_criterion ? "the financial criterion is met, reassess significance" : "the financial criterion is not met so far"}
          </span>.
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {r.incidents.map((i) => (
            <li key={i.id} className="text-[12.5px]">
              {i.id === currentId ? <span className="text-ink-3"><Code>{i.code}</Code> this incident</span> : (
                <Link to={`/incidents/${i.id}`} className="hover:text-petrol"><Code>{i.code}</Code> {i.title}</Link>
              )}
              <span className="ml-1 text-ink-3">{fmtDate(i.at)}{i.financial_loss_eur != null ? `, ${eur(i.financial_loss_eur)}` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Group-wide list of recurring-incident clusters (incidents page). */
export function RecurringGroups() {
  const q = useQuery({ queryKey: ["incidents", "recurring"], queryFn: () => api.get<RecurringGroup[]>("/incident-reporting/recurring") })
  if (!q.data?.length) return null
  return (
    <div className="mb-5 flex gap-3 rounded-md border border-brass/50 bg-brass-50/60 px-4 py-3 text-[13px]" role="note">
      <Repeat className="mt-0.5 size-4 shrink-0 text-brass" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-ink">Recurring incidents in the last 6 months (IR 2024/2690 Art. 4)</p>
        {q.data.map((g) => (
          <div key={`${g.entity.id}-${g.category}`} className="flex flex-wrap items-baseline gap-x-2 text-ink-2">
            <EntityTag code={g.entity.code} name={g.entity.name} />
            <span>{g.count} incidents “{g.category_label}”, combined loss {eur(g.combined_loss_eur)}</span>
            {g.meets_financial_criterion && <span className="font-medium text-alarm">above the threshold of {eur(g.threshold_eur)}</span>}
            <span className="flex flex-wrap gap-x-2">
              {g.incidents.map((i) => <Link key={i.id} to={`/incidents/${i.id}`} className="hover:text-petrol"><Code>{i.code}</Code></Link>)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const tri = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : null)
const fromTri = (v: string | null) => (v === "Yes" ? true : v === "No" ? false : null)

/** Affected entities, root-cause category, loss estimate and parallel-obligation flags. */
export function ScopePanel({ data, primaryEntityId, onChanged }: { data: ReportingOverview; primaryEntityId: number | null; onChanged: (o: ReportingOverview) => void }) {
  const entities = useEntities()
  const p = data.profile
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(p)
  const [loss, setLoss] = useState(p.financial_loss_eur == null ? "" : String(p.financial_loss_eur))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.put<ReportingOverview>(`/incident-reporting/incidents/${data.incident_id}/profile`, {
      affected_entity_ids: f.affected_entity_ids, root_cause_category: f.root_cause_category,
      financial_loss_eur: loss.trim() === "" ? null : Number(loss.replace(/[^\d.]/g, "")),
      personal_data_breach: f.personal_data_breach, product_affected: f.product_affected }),
    onMutate: () => setError(null),
    onSuccess: (o) => { toast.success("Scope saved"); setEditing(false); onChanged(o) },
    onError: (e: Error) => setError(e.message),
  })
  if (!editing) {
    return (
      <div>
        <KV label="Affected entities">
          {data.affected.length ? <span className="flex flex-wrap gap-1">{data.affected.map((a) => <EntityTag key={a.entity.id} code={a.entity.code} name={a.entity.name} />)}</span> : null}
        </KV>
        <KV label="Root cause category">{p.root_cause_category ? data.root_cause_categories[p.root_cause_category] : null}</KV>
        <KV label="Estimated financial loss">{p.financial_loss_eur != null ? eur(p.financial_loss_eur) : null}</KV>
        <KV label="Personal data affected">{tri(p.personal_data_breach) ?? "Not assessed"}</KV>
        <KV label="Product with digital elements affected">{tri(p.product_affected) ?? "Not assessed"}</KV>
        {data.can_edit && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { setF(p); setLoss(p.financial_loss_eur == null ? "" : String(p.financial_loss_eur)); setEditing(true) }}>
            Edit scope and root cause
          </Button>
        )}
      </div>
    )
  }
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field label="Affected entities" className="sm:col-span-2" hint="Each affected entity reports in its own jurisdiction">
        <div className="flex flex-wrap gap-3">
          {(entities.data ?? []).map((e) => (
            <label key={e.id} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox checked={f.affected_entity_ids.includes(e.id)} disabled={e.id === primaryEntityId}
                onCheckedChange={(v) => setF((s) => ({ ...s, affected_entity_ids: v ? [...s.affected_entity_ids, e.id] : s.affected_entity_ids.filter((x) => x !== e.id) }))} />
              <span className="font-mono text-[12px] text-ink-2">{e.code}</span><span className="text-ink-3">{e.country}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Root cause category" hint="Used to detect recurring incidents (IR Art. 4)">
        <OptionSelect value={f.root_cause_category} onChange={(v) => setF((s) => ({ ...s, root_cause_category: v }))} allowNone noneLabel="Not known yet"
          options={Object.entries(data.root_cause_categories).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Estimated financial loss (EUR)" htmlFor="scope-loss" hint="Direct loss incl. recovery costs">
        <Input id="scope-loss" inputMode="numeric" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder="e.g. 120000" />
      </Field>
      <Field label="Personal data affected" hint="GDPR Art. 33: DPA notification within 72 h">
        <div><Segmented value={tri(f.personal_data_breach)} onChange={(v) => setF((s) => ({ ...s, personal_data_breach: fromTri(v) }))} options={["Yes", "No"]} /></div>
      </Field>
      <Field label="Product with digital elements affected" hint="Cyber Resilience Act Art. 14 reporting">
        <div><Segmented value={tri(f.product_affected)} onChange={(v) => setF((s) => ({ ...s, product_affected: fromTri(v) }))} options={["Yes", "No"]} /></div>
      </Field>
      {error && <ErrorState className="sm:col-span-2" error={error} />}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={save.isPending}>Save scope</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>
  )
}
