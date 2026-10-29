import { useMemo, useState } from "react"
import { Link, useParams } from "react-router"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, KV, Loading, Meter, PageHeader, Pill, PriorityPill, ScoreBar, Section, Stat, StatusPill } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { LegalFormSelect } from "@/components/common/legal-form-select"
import { REGISTRATION_STATUS, useChapters } from "@/components/assess/shared"
import { EntityGovernanceSection } from "@/components/governance/entity-section"
import { useAuth } from "@/hooks/useAuth"
import { useEntityOptions, useRounds } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { NIS2_CLASS } from "@/lib/constants"
import { fmtDate, fmtDateTime, pct } from "@/lib/format"
import type { ActionItem, AssessmentDetail, AssessmentListItem, DocumentItem, Entity, Incident } from "@/lib/types"

const CLASS_OPTIONS = Object.entries(NIS2_CLASS).map(([value, label]) => ({ value, label }))
const REG_OPTIONS = Object.entries(REGISTRATION_STATUS).map(([value, label]) => ({ value, label }))

function EditEntityDialog({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(entity)
  const qc = useQueryClient()
  const set = <K extends keyof Entity>(k: K, v: Entity[K]) => setF((x) => ({ ...x, [k]: v }))
  const txt = (v: string | null) => (v && v.trim() ? v.trim() : null)
  const save = useMutation({
    mutationFn: () => api.put<Entity>(`/entities/${entity.id}`, {
      code: f.code.trim(), name: f.name.trim(), finding_prefix: f.finding_prefix.trim(), country: txt(f.country)?.toUpperCase() ?? null,
      is_headquarters: f.is_headquarters, legal_form: txt(f.legal_form), size_class: f.size_class, activity_sector: txt(f.activity_sector), nis2_classification: f.nis2_classification,
      competent_authority: txt(f.competent_authority), csirt: txt(f.csirt), registration_status: f.registration_status,
      registration_date: f.registration_date || null, registration_reference: txt(f.registration_reference),
      employees: f.employees, annual_turnover_meur: f.annual_turnover_meur, address: txt(f.address), contact_name: txt(f.contact_name),
      contact_email: txt(f.contact_email), notes: txt(f.notes), sort_order: f.sort_order, is_active: f.is_active,
    }),
    onSuccess: (e) => {
      toast.success(`${e.name} saved`)
      qc.setQueryData(["entity", entity.id], e)
      qc.invalidateQueries({ queryKey: ["entities"] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const entityOptions = useEntityOptions().data
  const sectors = entityOptions?.sectors
  const sectorOptions = (sectors ?? []).map((x) => ({ value: x.key, label: x.label }))
  const legalForms = entityOptions?.jurisdictions.find((j) => j.code === f.country)?.legal_forms ?? []
  const sizeOptions = (entityOptions?.size_classes ?? []).map((x) => ({ value: x, label: x.charAt(0).toUpperCase() + x.slice(1) }))
  const num = (v: string) => (v.trim() === "" ? null : Number(v))
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setF(entity) }}>
      <DialogTrigger asChild><Button variant="outline"><Pencil /> Edit master data</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {entity.name}</DialogTitle>
          <DialogDescription>Master data used for NIS2 classification, registration and reporting.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1 md:grid-cols-3">
          <Field label="Name" className="col-span-2" htmlFor="e-name"><Input id="e-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Code" htmlFor="e-code"><Input id="e-code" value={f.code} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Finding prefix" hint="Used in finding IDs such as ATL-1.1.1" htmlFor="e-prefix"><Input id="e-prefix" value={f.finding_prefix} onChange={(e) => set("finding_prefix", e.target.value)} /></Field>
          <Field label="Country"><OptionSelect value={f.country} onChange={(v) => set("country", v)} allowNone noneLabel="Not set" options={(entityOptions?.jurisdictions ?? []).map((j) => ({ value: j.code, label: j.name }))} /></Field>
          <Field label="NIS2 classification"><OptionSelect value={f.nis2_classification} onChange={(v) => set("nis2_classification", v)} allowNone noneLabel="Not set" options={CLASS_OPTIONS} /></Field>
          <Field label="Legal form" htmlFor="e-legal">
            <LegalFormSelect id="e-legal" allowNone country={f.country} forms={legalForms} value={f.legal_form}
              onChange={(v) => set("legal_form", v)} />
          </Field>
          <Field label="Size class"><OptionSelect value={f.size_class} onChange={(v) => set("size_class", v)} allowNone noneLabel="Not set" options={sizeOptions} /></Field>
          <Field label="Activity sector" className="col-span-2 md:col-span-3"><OptionSelect value={f.activity_sector} onChange={(v) => set("activity_sector", v)} allowNone noneLabel="Not set" options={sectorOptions} /></Field>
          <Field label="Competent authority" htmlFor="e-auth"><Input id="e-auth" value={f.competent_authority ?? ""} onChange={(e) => set("competent_authority", e.target.value)} /></Field>
          <Field label="CSIRT" htmlFor="e-csirt"><Input id="e-csirt" value={f.csirt ?? ""} onChange={(e) => set("csirt", e.target.value)} /></Field>
          <Field label="Registration status"><OptionSelect value={f.registration_status} onChange={(v) => set("registration_status", v)} allowNone noneLabel="Not set" options={REG_OPTIONS} /></Field>
          <Field label="Registration date" htmlFor="e-regdate"><Input id="e-regdate" type="date" value={f.registration_date ?? ""} onChange={(e) => set("registration_date", e.target.value || null)} /></Field>
          <Field label="Registration reference" className="md:col-span-2" htmlFor="e-regref"><Input id="e-regref" value={f.registration_reference ?? ""} onChange={(e) => set("registration_reference", e.target.value)} /></Field>
          <Field label="Employees" htmlFor="e-emp"><Input id="e-emp" type="number" min={0} value={f.employees ?? ""} onChange={(e) => set("employees", num(e.target.value))} /></Field>
          <Field label="Annual turnover (million EUR)" htmlFor="e-turn"><Input id="e-turn" type="number" min={0} step="0.1" value={f.annual_turnover_meur ?? ""} onChange={(e) => set("annual_turnover_meur", num(e.target.value))} /></Field>
          <Field label="Sort order" htmlFor="e-sort"><Input id="e-sort" type="number" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} /></Field>
          <Field label="Address" className="col-span-2 md:col-span-3" htmlFor="e-addr"><Input id="e-addr" value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Contact name" htmlFor="e-cname"><Input id="e-cname" value={f.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} /></Field>
          <Field label="Contact e-mail" className="md:col-span-2" htmlFor="e-cmail"><Input id="e-cmail" type="email" value={f.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} /></Field>
          <Field label="Notes" className="col-span-2 md:col-span-3" htmlFor="e-notes"><Textarea id="e-notes" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          <label className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 md:col-span-1">
            <span className="text-[13px]">Headquarters</span>
            <Switch checked={f.is_headquarters} onCheckedChange={(v) => set("is_headquarters", v)} aria-label="Headquarters" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 md:col-span-1">
            <span className="text-[13px]">Active</span>
            <Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Active" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || !f.code.trim() || !f.finding_prefix.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function EntityPage() {
  const { id } = useParams()
  const entityOptions = useEntityOptions().data
  const sectors = entityOptions?.sectors
  const entityId = Number(id)
  const { can, canAny } = useAuth()
  const q = useQuery({ queryKey: ["entity", entityId], queryFn: () => api.get<Entity>(`/entities/${entityId}`), enabled: !!entityId })
  const rounds = useRounds()
  const canAssess = can("assessments.read", entityId)
  const perRound = useQueries({
    queries: (rounds.data ?? []).map((r) => ({
      queryKey: ["assessments", r.id],
      queryFn: () => api.get<AssessmentListItem[]>("/assessments", { round_id: r.id }),
      enabled: canAssess,
    })),
  })
  const assessments = perRound.flatMap((x) => x.data ?? []).filter((a) => a.entity_id === entityId)
  const currentRoundId = rounds.data?.find((r) => r.is_current)?.id
  const current = assessments.find((a) => a.round_id === currentRoundId) ?? assessments[0]
  const detail = useQuery({ queryKey: ["assessment", current?.id], queryFn: () => api.get<AssessmentDetail>(`/assessments/${current!.id}`), enabled: !!current })
  const chapters = useChapters(canAny("catalog.read") && !!current)
  const items = useQuery({
    queryKey: ["action-items", { entity_id: entityId }],
    queryFn: () => api.get<ActionItem[]>("/action-items", { entity_id: entityId }),
    enabled: can("findings.read", entityId),
  })
  const docs = useQuery({
    queryKey: ["documents", "entity", entityId],
    queryFn: () => api.get<DocumentItem[]>("/documents", { entity_id: entityId }),
    enabled: canAny("documents.read"),
  })
  const incidents = useQuery({ queryKey: ["incidents"], queryFn: () => api.get<Incident[]>("/incidents"), enabled: can("incidents.read", entityId) })

  const openItems = useMemo(() => (items.data ?? []).filter((i) => i.status !== "Completed")
    .sort((a, b) => (a.due_status === "Overdue" ? -1 : 0) - (b.due_status === "Overdue" ? -1 : 0) || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")), [items.data])
  const entityIncidents = (incidents.data ?? []).filter((i) => i.entity?.id === entityId)

  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState error={q.error ?? "Entity not found"} />
  const e = q.data
  const s = current?.stats

  return (
    <div>
      <PageHeader title={e.name}
        actions={
          <>
            {current && <Button variant="outline" asChild><Link to={`/assessments/${current.id}`}>Open assessment</Link></Button>}
            {can("entities.manage", e.id) && <EditEntityDialog entity={e} />}
          </>
        }>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EntityTag code={e.code} />
          {e.country && <Pill tone="outline">{e.country}</Pill>}
          {e.is_headquarters && <Pill tone="brass">Headquarters</Pill>}
          {e.nis2_classification && <Pill tone={e.nis2_classification === "essential" || e.nis2_classification === "important" ? "petrol" : "neutral"}>{NIS2_CLASS[e.nis2_classification] ?? e.nis2_classification}</Pill>}
          {!e.is_active && <Pill tone="alarm">Inactive</Pill>}
        </div>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Section title="Master data">
          <div className="grid gap-x-8 md:grid-cols-2">
            <div>
              <KV label="NIS2 classification">{e.nis2_classification ? NIS2_CLASS[e.nis2_classification] : null}</KV>
              <KV label="Activity sector">{sectors?.find((x) => x.key === e.activity_sector)?.label ?? e.activity_sector}</KV>
              <KV label="Competent authority">{e.competent_authority}</KV>
              <KV label="CSIRT">{e.csirt}</KV>
              <KV label="Registration">
                {e.registration_status ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Pill tone={e.registration_status === "confirmed" ? "sage" : e.registration_status === "submitted" ? "brass" : "alarm"}>{REGISTRATION_STATUS[e.registration_status] ?? e.registration_status}</Pill>
                    {e.registration_date && <span className="text-ink-2">{fmtDate(e.registration_date)}</span>}
                  </span>
                ) : null}
              </KV>
              <KV label="Registration reference">{e.registration_reference ? <Code>{e.registration_reference}</Code> : null}</KV>
            </div>
            <div>
              <KV label="Finding prefix"><Code>{e.finding_prefix}</Code></KV>
              <KV label="Employees">{e.employees != null ? <span className="tabular">{e.employees.toLocaleString("en")}</span> : null}</KV>
              <KV label="Annual turnover">{e.annual_turnover_meur != null ? <span className="tabular">{e.annual_turnover_meur.toLocaleString("en")} million EUR</span> : null}</KV>
              <KV label="Address">{e.address}</KV>
              <KV label="Contact">{e.contact_name || e.contact_email ? (
                <span>{e.contact_name}{e.contact_email && <><br /><a className="text-petrol hover:underline" href={`mailto:${e.contact_email}`}>{e.contact_email}</a></>}</span>
              ) : null}</KV>
            </div>
          </div>
          {e.notes && <div className="mt-3 border-t pt-3 text-[13px] whitespace-pre-wrap text-ink-2">{e.notes}</div>}
        </Section>

        <Section title={current ? `Assessment ${current.round_name}` : "Assessment"}
          actions={current ? <StatusPill value={current.status} /> : undefined}>
          {!canAssess ? <p className="text-[13px] text-ink-3">You do not have access to this entity's assessment.</p>
            : perRound.some((x) => x.isLoading) ? <Loading /> : !current || !s ? <Empty title="No assessment yet">An assessment is created for every entity when a round starts.</Empty> : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Coverage" value={pct(s.coverage)} hint={`${s.assessed} of ${s.in_scope}`} />
                  <Stat label="Average score" value={pct(s.average_score)} tone="petrol" />
                  <Stat label="Findings" value={s.work_packages} hint={`Core ${s.core_assessed}/${s.core_total}`} />
                </div>
                <Meter value={s.coverage ?? 0} className="mt-3" />
                {detail.data && chapters.data && (
                  <ul className="mt-4 space-y-1.5 border-t pt-3">
                    {chapters.data.map((c) => {
                      const cs = detail.data.chapters[String(c.number)]
                      return (
                        <li key={c.id}>
                          <Link to={`/assessments/${current.id}?chapter=${c.number}`} className="grid grid-cols-[22px_minmax(0,1fr)_140px] items-center gap-2 rounded px-1 text-[12.5px] hover:bg-muted/60">
                            <Code className="text-right text-[11.5px] text-ink-3">{c.number}</Code>
                            <span className="truncate text-ink-2">{c.title}</span>
                            <ScoreBar value={cs?.average ?? null} target={c.target} />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
        </Section>
      </div>

      {canAssess && assessments.length > 1 && (
        <Section title="Assessments by round" className="mt-5" bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b text-left text-[12px] text-ink-3">
              <th className="px-4 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Coverage</th><th className="px-3 py-2 text-right font-medium">Average score</th>
              <th className="px-3 py-2 text-right font-medium">Findings</th><th className="px-3 py-2 font-medium">Assessment date</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>
              {assessments.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{a.round_name}</td>
                  <td className="px-3 py-2"><StatusPill value={a.status} /></td>
                  <td className="tabular px-3 py-2 text-right">{pct(a.stats.coverage)}</td>
                  <td className="tabular px-3 py-2 text-right">{pct(a.stats.average_score)}</td>
                  <td className="tabular px-3 py-2 text-right">{a.stats.work_packages}</td>
                  <td className="tabular px-3 py-2 text-ink-2">{fmtDate(a.assessment_date)}</td>
                  <td className="px-4 py-2 text-right"><Link to={`/assessments/${a.id}`} className="text-petrol hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {can("findings.read", entityId) && (
        <Section title={`Open action plan items (${openItems.length})`} className="mt-5" bodyClassName="p-0"
          actions={<Link to={`/action-plan?entity=${entityId}`} className="text-[12.5px] text-petrol hover:underline">Full action plan</Link>}>
          {items.isLoading ? <Loading /> : items.error ? <ErrorState error={items.error} className="m-4" /> : openItems.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-3">No open action plan items for this entity.</p>
          ) : (
            <ul>
              {openItems.slice(0, 25).map((i) => (
                <li key={i.id} className="grid grid-cols-[70px_60px_minmax(0,1fr)_80px_100px_90px] items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0">
                  <Code>{i.code}</Code>
                  <Code className="text-ink-3">{i.requirement.number}</Code>
                  <Link to={`/action-plan?item=${i.id}`} className="truncate hover:text-petrol">{i.title}</Link>
                  <PriorityPill value={i.priority} />
                  <span className="tabular text-[12.5px] text-ink-3">{fmtDate(i.target_date)}</span>
                  <StatusPill value={i.due_status ?? i.status} />
                </li>
              ))}
              {openItems.length > 25 && <li className="px-4 py-2 text-[12.5px] text-ink-3">{openItems.length - 25} more in the <Link to={`/action-plan?entity=${entityId}`} className="text-petrol hover:underline">action plan</Link>.</li>}
            </ul>
          )}
        </Section>
      )}

      <EntityGovernanceSection entityId={entityId} />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {canAny("documents.read") && (
          <Section title={`Documents (${docs.data?.length ?? 0})`} bodyClassName="p-0"
            actions={<Link to="/documents" className="text-[12.5px] text-petrol hover:underline">All documents</Link>}>
            {docs.isLoading ? <Loading /> : docs.error ? <ErrorState error={docs.error} className="m-4" /> : !docs.data?.length ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No documents are assigned to this entity. Assign the entity when uploading a document.</p>
            ) : (
              <ul>
                {docs.data.map((d) => (
                  <li key={d.id} className="flex items-center gap-2.5 border-b px-4 py-2 text-[13px] last:border-0">
                    <FileText className="size-4 shrink-0 text-ink-3" />
                    <Link to={`/documents/${d.id}`} className="min-w-0 flex-1 truncate hover:text-petrol">{d.title}</Link>
                    <span className="text-[12px] text-ink-3">{d.doc_type}</span>
                    {d.review_overdue && <Pill tone="alarm">Review overdue</Pill>}
                    <StatusPill value={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        {can("incidents.read", entityId) && (
          <Section title={`Incidents (${entityIncidents.length})`} bodyClassName="p-0"
            actions={<Link to="/incidents" className="text-[12.5px] text-petrol hover:underline">Incident register</Link>}>
            {incidents.isLoading ? <Loading /> : incidents.error ? <ErrorState error={incidents.error} className="m-4" /> : entityIncidents.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No incidents recorded for this entity.</p>
            ) : (
              <ul>
                {entityIncidents.map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5 border-b px-4 py-2 text-[13px] last:border-0">
                    <Code className="w-16">{i.code}</Code>
                    <Link to={`/incidents/${i.id}`} className="min-w-0 flex-1 truncate hover:text-petrol">{i.title}</Link>
                    {i.is_significant && <Pill tone="alarm">Significant</Pill>}
                    <StatusPill value={i.severity} />
                    <StatusPill value={i.status} />
                    <span className="tabular w-32 text-right text-[12px] text-ink-3">{fmtDateTime(i.detected_at ?? i.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}
