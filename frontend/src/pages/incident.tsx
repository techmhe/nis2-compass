import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EntityTag, ErrorState, Loading, PageHeader, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks, UserAvatar } from "@/components/common/collab"
import { WritingHelp } from "@/components/ai/writing-help"
import { EntitySelect, Field, OptionSelect, Segmented, UserSelect } from "@/components/common/fields"
import { ReportingClock } from "@/components/incidents/clock"
import { FollowUpPanel } from "@/components/incidents/follow-up"
import { SignificanceGuidance } from "@/components/incidents/guidance"
import { RecurringBanner, ScopePanel, useReporting } from "@/components/incidents/reporting"
import { TrackCards } from "@/components/incidents/tracks"
import { SignificancePanel } from "@/components/incidents/wizard"
import {
  CATEGORIES, fmtDue, fromLocalInput, incidentBody, type IncidentIn, SeverityPill, SignificantTag, toLocalInput,
} from "@/components/incidents/shared"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, ApiError } from "@/lib/api"
import { INCIDENT_SEVERITY, INCIDENT_STATUS } from "@/lib/constants"
import { fmtDateTime, fromNow } from "@/lib/format"
import type { DocLink, Incident } from "@/lib/types"

interface IncidentDetail { incident: Incident; documents: DocLink[]; can_edit: boolean }

const DATE_FIELDS = ["detected_at", "aware_at", "early_warning_at", "notification_at", "intermediate_report_at", "final_report_at"] as const
type DateField = (typeof DATE_FIELDS)[number]
const REPORT_FIELDS: DateField[] = ["early_warning_at", "notification_at", "intermediate_report_at", "final_report_at"]

export default function IncidentPage() {
  const { id } = useParams()
  const incidentId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const key = ["incidents", "detail", incidentId]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<IncidentDetail>(`/incidents/${incidentId}`), enabled: Number.isFinite(incidentId) })
  const [dirty, setDirty] = useState(false)
  const rep = useReporting(incidentId)

  const setData = (i: Incident) => {
    qc.setQueryData<IncidentDetail>(key, (d) => (d ? { ...d, incident: i } : d))
    qc.invalidateQueries({ queryKey: ["incidents", "list"] })
    qc.invalidateQueries({ queryKey: ["incidents", "reporting", incidentId] })
  }
  const patch = useMutation({
    mutationFn: ({ fields }: { fields: Partial<IncidentIn>; message: string }) =>
      api.put<Incident>(`/incidents/${incidentId}`, { ...incidentBody(q.data!.incident), ...fields }),
    onSuccess: (i, v) => { toast.success(v.message); setData(i) },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/incidents/${incidentId}`),
    onSuccess: () => { toast.success("Incident deleted"); qc.invalidateQueries({ queryKey: ["incidents"] }); navigate("/incidents") },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.isLoading) return <Loading />
  if (q.error) {
    return (
      <div>
        <BackLink />
        <ErrorState error={(q.error as ApiError).status === 404 ? "This incident does not exist." : (q.error as ApiError).status === 403 ? "You have no access to incidents of this entity." : q.error} />
      </div>
    )
  }
  if (!q.data) return null
  const { incident: inc, documents, can_edit } = q.data
  const hasTracks = (rep.data?.tracks.length ?? 0) > 0

  return (
    <div>
      <BackLink />
      <PageHeader
        title={<span><span className="mr-2 font-mono text-[18px] font-medium text-ink-3">{inc.code}</span>{inc.title}</span>}
        actions={can_edit && !inc.is_significant && (
          <Confirm title={`Delete ${inc.code}?`} description="The incident, its timeline, comments and document links are removed permanently."
            confirmLabel="Delete incident" onConfirm={() => del.mutate()}
            trigger={<Button variant="outline" className="text-alarm"><Trash2 /> Delete</Button>} />
        )}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
          <SeverityPill value={inc.severity} />
          <StatusPill value={inc.status} />
          <SignificantTag value={inc.is_significant} />
          {inc.entity ? <EntityTag code={inc.entity.code} name={inc.entity.name} /> : <span>Group-wide</span>}
          {inc.category && <span className="text-ink-2">{inc.category}</span>}
          {inc.handler_name && <span>Handled by <span className="text-ink-2">{inc.handler_name}</span></span>}
          <span>Updated {fromNow(inc.updated_at)}</span>
        </div>
      </PageHeader>

      {rep.data?.recurring && <RecurringBanner r={rep.data.recurring} currentId={inc.id} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <div data-tour="incidents.significance">
          <Section title="Significance assessment">
            {rep.isLoading ? <Loading /> : rep.error ? <ErrorState error={rep.error} /> : rep.data && (
              <SignificancePanel data={rep.data} awareAt={inc.aware_at} onChanged={rep.update} />
            )}
          </Section>
          </div>

          <div data-tour="incidents.deadlines incidents.draft">
          <Section title="Reporting to authorities">
            {hasTracks && rep.data ? (
              <TrackCards data={rep.data} onChanged={rep.update} onReload={rep.reload} />
            ) : (
              <>
                <ReportingClock incident={inc} canEdit={can_edit} blocked={dirty} pending={patch.isPending}
                  onPatch={(fields, message) => patch.mutate({ fields, message })} />
                {rep.data && can_edit && <div className="mt-3"><TrackCards data={rep.data} onChanged={rep.update} onReload={rep.reload} /></div>}
              </>
            )}
          </Section>
          </div>

          <Section title="Scope and root cause">
            {rep.data ? <ScopePanel key={rep.data.profile.affected_entity_ids.join(",") + (rep.data.profile.root_cause_category ?? "")}
              data={rep.data} primaryEntityId={inc.entity?.id ?? null} onChanged={rep.update} /> : rep.isLoading ? <Loading /> : null}
          </Section>

          {rep.data && (
            <Section title="Follow-up">
              <FollowUpPanel data={rep.data} incidentId={inc.id} entityId={inc.entity?.id ?? null} lessons={inc.lessons_learned} onChanged={rep.update} />
            </Section>
          )}

          <IncidentForm key={inc.updated_at} incident={inc} canEdit={can_edit} hasTracks={hasTracks} onDirtyChange={setDirty} onSaved={setData} />

          <Section title="Documents and evidence">
            <DocumentLinks targetType="incident" targetId={inc.id} documents={documents} entityId={inc.entity?.id ?? null}
              canEdit={can_edit} onChange={() => qc.invalidateQueries({ queryKey: key })} />
          </Section>

          <Section title="Comments">
            <CommentsPanel targetType="incident" targetId={inc.id} canComment={can_edit} />
          </Section>
        </div>

        <div className="space-y-5">
          <div data-tour="incidents.timeline"><Timeline incident={inc} canEdit={can_edit} onAdded={setData} /></div>
          <Section title="Significance and reporting">
            <SignificanceGuidance country={inc.entity?.country} />
          </Section>
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/incidents" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol">
      <ChevronLeft className="size-3.5" /> Incidents
    </Link>
  )
}

type FormState = Omit<IncidentIn, DateField> & Record<DateField, string>

function toForm(i: Incident): FormState {
  const b = incidentBody(i)
  const f = { ...b } as unknown as FormState
  for (const k of DATE_FIELDS) f[k] = toLocalInput(b[k])
  return f
}

function fromForm(f: FormState, original: Incident): IncidentIn {
  const out = { ...f } as unknown as IncidentIn
  for (const k of DATE_FIELDS) out[k] = fromLocalInput(f[k], original[k])
  const trim = ["title", "description", "category", "significance_rationale", "authority", "authority_reference", "impact",
    "indicators_of_compromise", "root_cause", "measures", "lessons_learned"] as const
  for (const k of trim) {
    const v = out[k]
    ;(out as unknown as Record<string, unknown>)[k] = typeof v === "string" ? (v.trim() || (k === "title" ? v : null)) : v
  }
  return out
}

const triState = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : null)
const fromTri = (v: string | null) => (v === "Yes" ? true : v === "No" ? false : null)

function IncidentForm({ incident, canEdit, hasTracks, onDirtyChange, onSaved }: {
  incident: Incident
  canEdit: boolean
  /** Report dates are maintained by the reporting tracks once they exist. */
  hasTracks: boolean
  onDirtyChange: (d: boolean) => void
  onSaved: (i: Incident) => void
}) {
  const { can } = useAuth()
  const entities = useEntities()
  const initial = toForm(incident)
  const [f, setF] = useState<FormState>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const save = useMutation({
    mutationFn: () => api.put<Incident>(`/incidents/${incident.id}`, fromForm(f, incident)),
    onMutate: () => setError(null),
    onSuccess: (i) => { toast.success("Incident saved"); onSaved(i) },
    onError: (e: Error) => setError(e.message),
  })

  const country = entities.data?.find((e) => e.id === f.entity_id)?.country ?? incident.entity?.country
  const authorities = country === "DE"
    ? ["BSI (BSI/BBK reporting portal)"]
    : country === "NL" ? ["NCSC (CSIRT)", "Sector CSIRT and competent authority"] : ["BSI (BSI/BBK reporting portal)", "NCSC (CSIRT)"]
  const ro = !canEdit
  const HELPED: (keyof FormState)[] = ["description", "significance_rationale", "impact", "root_cause", "measures", "lessons_learned"]
  const txt = (k: keyof FormState, label: string, rows = 3, placeholder?: string, className = "col-span-2") => (
    <Field label={label} className={className} htmlFor={`inc-${k}`} action={HELPED.includes(k) && (
      <WritingHelp target={{ type: "incident", id: incident.id }} field={k} value={(f[k] as string | null) ?? ""} onApply={(t) => set(k, t as never)} autosave={false} disabled={ro} />
    )}>
      <Textarea id={`inc-${k}`} rows={rows} value={(f[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} disabled={ro} placeholder={placeholder} />
    </Field>
  )
  const dt = (k: DateField, label: string, hint?: string) => (
    <Field label={label} htmlFor={`inc-${k}`} hint={hasTracks && REPORT_FIELDS.includes(k) ? "Maintained by the reporting tracks above" : hint}>
      <Input id={`inc-${k}`} type="datetime-local" value={f[k]} onChange={(e) => set(k, e.target.value)} disabled={ro || (hasTracks && REPORT_FIELDS.includes(k))} />
    </Field>
  )
  const groupAllowed = can("incidents.manage")

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-5">
      <Section title="Incident">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2" htmlFor="inc-title">
            <Input id="inc-title" value={f.title} onChange={(e) => set("title", e.target.value)} disabled={ro} required maxLength={400} />
          </Field>
          <Field label="Entity">
            <EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} allowGroup={groupAllowed} groupLabel="Group-wide" disabled={ro} />
          </Field>
          <Field label="Category" htmlFor="inc-category">
            <Input id="inc-category" list="incident-categories-edit" value={f.category ?? ""} onChange={(e) => set("category", e.target.value)} disabled={ro} />
            <datalist id="incident-categories-edit">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Severity">
            <OptionSelect value={f.severity} onChange={(v) => set("severity", v ?? "Medium")} options={INCIDENT_SEVERITY} disabled={ro} />
          </Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Open")} options={INCIDENT_STATUS} disabled={ro} />
          </Field>
          <Field label="Handler">
            <UserSelect value={f.handler_id} onChange={(v) => set("handler_id", v)} disabled={ro} placeholder="Who handles the incident?" />
          </Field>
          <div />
          {txt("description", "Description", 3, "What happened, which systems and services are affected")}
        </div>
      </Section>

      <Section title="Classification">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Significant (Art. 23(3))" hint="Click again to reset to not assessed">
            <div><Segmented value={triState(f.is_significant)} onChange={(v) => set("is_significant", fromTri(v))} options={["Yes", "No"]} disabled={ro} /></div>
          </Field>
          <Field label="Suspected malicious">
            <div><Segmented value={triState(f.suspected_malicious)} onChange={(v) => set("suspected_malicious", fromTri(v))} options={["Yes", "No"]} disabled={ro} /></div>
          </Field>
          <Field label="Cross-border impact">
            <div><Segmented value={triState(f.cross_border_impact)} onChange={(v) => set("cross_border_impact", fromTri(v))} options={["Yes", "No"]} disabled={ro} /></div>
          </Field>
          {txt("significance_rationale", "Significance rationale", 2, "Why the incident is or is not significant (disruption, financial loss, damage to others)", "sm:col-span-3")}
          {txt("impact", "Impact", 2, "Affected services, users, data and duration", "sm:col-span-3")}
        </div>
      </Section>

      <Section title="Times and reporting">
        <div className="grid gap-3 sm:grid-cols-2">
          {dt("detected_at", "Detected at")}
          {dt("aware_at", "Became aware at", "Starts the 24 h and 72 h deadlines")}
          {dt("early_warning_at", "Early warning sent")}
          {dt("notification_at", "Notification sent", "The final report is due one month later")}
          {dt("intermediate_report_at", "Intermediate report sent")}
          {dt("final_report_at", "Final report sent")}
          <Field label="Authority" htmlFor="inc-authority">
            <Input id="inc-authority" list="incident-authorities" value={f.authority ?? ""} onChange={(e) => set("authority", e.target.value)} disabled={ro}
              placeholder={country === "NL" ? "e.g. NCSC" : "e.g. BSI"} />
            <datalist id="incident-authorities">{authorities.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Authority reference" htmlFor="inc-authref">
            <Input id="inc-authref" value={f.authority_reference ?? ""} onChange={(e) => set("authority_reference", e.target.value)} disabled={ro} placeholder="Case number of the report" />
          </Field>
        </div>
      </Section>

      <Section title="Analysis and follow-up">
        <div className="grid gap-3 sm:grid-cols-2">
          {txt("indicators_of_compromise", "Indicators of compromise", 3, "IP addresses, domains, hashes", "")}
          {txt("root_cause", "Root cause", 3, "Type of threat or underlying cause", "")}
          {txt("measures", "Measures", 3, "Containment, mitigation and recovery steps", "")}
          {txt("lessons_learned", "Lessons learned", 3, "What changes to prevent recurrence", "")}
        </div>
      </Section>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
          {error && <ErrorState error={error} className="mr-2 flex-1 py-2" />}
          <Button type="submit" disabled={!dirty || !f.title.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          {dirty && <Button type="button" variant="ghost" onClick={() => { setF(initial); setError(null) }}>Discard changes</Button>}
          {!dirty && !error && <span className="text-[12px] text-ink-3">All changes saved</span>}
        </div>
      )}
    </form>
  )
}

function Timeline({ incident, canEdit, onAdded }: { incident: Incident; canEdit: boolean; onAdded: (i: Incident) => void }) {
  const [text, setText] = useState("")
  const [at, setAt] = useState("")
  const add = useMutation({
    mutationFn: () => api.post<Incident>(`/incidents/${incident.id}/timeline`, { text: text.trim(), at: at ? fromLocalInput(at) : null }),
    onSuccess: (i) => { toast.success("Timeline entry added"); setText(""); setAt(""); onAdded(i) },
    onError: (e: Error) => toast.error(e.message),
  })
  const entries = [...(incident.timeline ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return (
    <Section title={<span>Timeline <span className="tabular font-normal text-ink-3">{entries.length}</span></span>}>
      {canEdit && (
        <form className="mb-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate() }}>
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened or was decided? e.g. Firewall rule deployed, backups verified"
            aria-label="Timeline entry" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) add.mutate() }} />
          <div className="flex items-center gap-2">
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 flex-1 text-[12.5px]" aria-label="Time of the entry (default now)" title="Leave empty to use the current time" />
            <Button type="submit" size="sm" disabled={!text.trim() || add.isPending}>Add entry</Button>
          </div>
        </form>
      )}
      {entries.length === 0 ? (
        <p className="text-[13px] text-ink-3">No entries yet. Log detection, containment steps, decisions and reports as they happen.</p>
      ) : (
        <ol className="relative space-y-3 border-l pl-4">
          {entries.map((e, idx) => (
            <li key={`${e.at}-${idx}`} className="relative">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-ink-3" aria-hidden />
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <span className="tabular" title={fmtDateTime(e.at)}>{fmtDue(e.at)}</span>
                {e.by && <span className="inline-flex items-center gap-1"><UserAvatar name={e.by} className="size-4" />{e.by}</span>}
              </div>
              <p className="mt-0.5 text-[13px] whitespace-pre-line text-ink">{e.text}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
