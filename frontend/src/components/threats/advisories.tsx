import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Bug, ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, Empty, ErrorState, KV, Loading, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Combo, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useSupplierOptions } from "@/components/inventory/shared"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AssetPicker } from "./asset-picker"
import { ADVISORY_STATUS_LABEL, AdvisoryStatusPill, SEVERITY_LABEL, SeverityPill, SOURCE_LABEL } from "./shared"
import type { Advisory, AdvisorySource, Relevant, Severity, YesNo } from "./types"

interface AdvList { items: Advisory[]; can_create: boolean }

const SOURCES: AdvisorySource[] = ["CERT-Bund", "NCSC-NL", "BSI", "vendor_psirt", "supplier", "other"]
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]

export function AdvisoriesTab() {
  const [params, setParams] = useSearchParams()
  const selected = params.get("advisory") ? Number(params.get("advisory")) : null
  const [status, setStatus] = useState<string | null>(null)
  const [severity, setSeverity] = useState<string | null>(null)
  const [editing, setEditing] = useState<Advisory | "new" | null>(null)
  const list = useQuery({ queryKey: ["threats", "advisories"], queryFn: () => api.get<AdvList>("/threats/advisories") })
  const items = list.data?.items ?? []
  const rows = useMemo(() => items.filter((a) =>
    (!status || (status === "overdue" ? a.overdue : a.status === status)) && (!severity || a.severity === severity)),
    [items, status, severity])
  const open = (id: number | null) => setParams((p) => { if (id) p.set("advisory", String(id)); else p.delete("advisory"); return p })
  const current = items.find((a) => a.id === selected) ?? null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-48">
          <OptionSelect value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
            options={[{ value: "overdue", label: "Assessment overdue" },
              ...(Object.keys(ADVISORY_STATUS_LABEL) as (keyof typeof ADVISORY_STATUS_LABEL)[]).map((s) => ({ value: s, label: ADVISORY_STATUS_LABEL[s] }))]} />
        </div>
        <div className="w-40">
          <OptionSelect value={severity} onChange={setSeverity} allowNone noneLabel="All severities" placeholder="All severities"
            options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
        </div>
        <p className="flex-1 text-[12.5px] text-ink-3">Threat information received from a CSIRT, vendor or supplier must be assessed in writing (Cbb Art. 17).</p>
        {list.data?.can_create && <Button onClick={() => setEditing("new")}><Plus /> Log advisory</Button>}
      </div>
      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : items.length === 0 ? (
          <Empty title="No advisories logged" icon={<AlertTriangle className="size-6" />}
            action={list.data?.can_create && <Button size="sm" onClick={() => setEditing("new")}><Plus /> Log advisory</Button>}>
            Record threat information here as it is received, so it can be assessed and, where relevant, acted on.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No advisory matches this filter" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Advisory</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Severity</th>
                  <th className="px-2 py-2 font-medium">Scope</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 pr-4 font-medium">Assessment due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={cn("cursor-pointer border-b align-top last:border-0 hover:bg-muted/50", selected === a.id && "bg-petrol-50/40")} onClick={() => open(a.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{a.code}</Code>
                        <button type="button" className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); open(a.id) }}>{a.title}</button>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-ink-2">{SOURCE_LABEL[a.source]}</td>
                    <td className="px-2 py-2"><SeverityPill severity={a.severity} /></td>
                    <td className="px-2 py-2">{a.entity_scope === "all" ? <span className="text-ink-2">Group</span> :
                      <span className="flex flex-wrap gap-1">{a.entities.map((e) => <EntityTag key={e.id} code={e.code} />)}</span>}</td>
                    <td className="px-2 py-2"><AdvisoryStatusPill status={a.status} overdue={a.overdue} /></td>
                    <td className="tabular px-2 py-2 pr-4 whitespace-nowrap text-ink-2">{fmtDate(a.assessment_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Sheet open={selected != null} onOpenChange={(v) => { if (!v) open(null) }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
          {selected != null && (current ? <AdvisoryBody a={current} onEdit={() => setEditing(current)} onDeleted={() => open(null)} /> : (
            <><SheetHeader><SheetTitle>Advisory</SheetTitle><SheetDescription className="sr-only">Details</SheetDescription></SheetHeader>
              {list.isLoading ? <Loading /> : <ErrorState className="m-4" error="This advisory does not exist or you have no access to it." />}</>
          ))}
        </SheetContent>
      </Sheet>
      {editing && <AdvisoryDialog adv={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(a) => { setEditing(null); open(a.id) }} />}
    </div>
  )
}

function AdvisoryBody({ a, onEdit, onDeleted }: { a: Advisory; onEdit: () => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [assess, setAssess] = useState({ relevant: a.relevant ?? "" as Relevant | "", measures_need_adjustment: a.measures_need_adjustment ?? "" as YesNo | "", rationale: a.rationale ?? "" })
  const [taskOpen, setTaskOpen] = useState(false)
  const [vulnOpen, setVulnOpen] = useState(false)
  const done = (msg: string) => () => { toast.success(msg); qc.invalidateQueries({ queryKey: ["threats"] }) }
  const doAssess = useMutation({
    mutationFn: (status: "in_assessment" | "assessed" | "closed") => api.post<Advisory>(`/threats/advisories/${a.id}/assess`, {
      status, relevant: assess.relevant || null, measures_need_adjustment: assess.measures_need_adjustment || null,
      rationale: assess.rationale.trim() || null,
    }),
    onSuccess: done("Assessment saved"),
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/threats/advisories/${a.id}`),
    onSuccess: () => { done("Advisory deleted")(); onDeleted() },
    onError: (e: Error) => toast.error(e.message),
  })
  const canClose = !!assess.relevant && !!assess.measures_need_adjustment && assess.rationale.trim().length > 0
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <Code>{a.code}</Code>{SOURCE_LABEL[a.source]}{a.reference && <span>· {a.reference}</span>}
        </div>
        <SheetTitle className="text-[17px] leading-snug">{a.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <SeverityPill severity={a.severity} /><AdvisoryStatusPill status={a.status} overdue={a.overdue} />
          <span>Received {fmtDate(a.received_on)}</span>
        </SheetDescription>
        {a.can_edit && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
            <Button size="sm" variant="outline" onClick={() => setVulnOpen(true)}><Bug /> Create vulnerability</Button>
            <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}><ClipboardList /> Create task</Button>
            <Confirm title={`Delete ${a.code}?`} description="The advisory and its assessment are removed permanently." confirmLabel="Delete advisory"
              onConfirm={() => del.mutate()} trigger={<Button size="sm" variant="outline" className="text-alarm"><Trash2 /> Delete</Button>} />
          </div>
        )}
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <div>
          <KV label="Scope">{a.entity_scope === "all" ? "Group-wide" : <span className="flex flex-wrap gap-1">{a.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}</span>}</KV>
          <KV label="Summary">{a.summary ? <span className="whitespace-pre-line">{a.summary}</span> : null}</KV>
          <KV label="Affected assets">{a.assets.length ? <span className="flex flex-wrap gap-1">{a.assets.map((x) => <Code key={x.id}>{x.code}</Code>)}</span> : null}</KV>
          <KV label="Affected suppliers">{a.suppliers.length ? a.suppliers.map((x) => x.name).join(", ") : null}</KV>
          <KV label="Logged by">{a.created_by_name}</KV>
        </div>
        {a.can_edit && a.status !== "closed" ? (
          <Section title="Written assessment (Cbb Art. 17)">
            <div className="space-y-2">
              <Field label="Relevant to us?">
                <OptionSelect value={assess.relevant || null} onChange={(v) => setAssess((s) => ({ ...s, relevant: (v ?? "") as Relevant | "" }))}
                  allowNone noneLabel="Not yet decided" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unclear", label: "Unclear" }]} />
              </Field>
              <Field label="Measures need adjustment?">
                <OptionSelect value={assess.measures_need_adjustment || null} onChange={(v) => setAssess((s) => ({ ...s, measures_need_adjustment: (v ?? "") as YesNo | "" }))}
                  allowNone noneLabel="Not yet decided" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
              </Field>
              <Field label="Rationale" hint="Required to close the assessment">
                <Textarea rows={3} value={assess.rationale} onChange={(e) => setAssess((s) => ({ ...s, rationale: e.target.value }))}
                  placeholder="Written rationale for the relevance decision and, if applicable, the adjustment of measures" />
              </Field>
              <div className="flex flex-wrap gap-2 pt-1">
                {a.status === "new" && <Button size="sm" variant="outline" disabled={doAssess.isPending} onClick={() => doAssess.mutate("in_assessment")}>Start assessment</Button>}
                <Button size="sm" variant="outline" disabled={doAssess.isPending || !assess.relevant} onClick={() => doAssess.mutate("assessed")}>Save as assessed</Button>
                <Button size="sm" disabled={doAssess.isPending || !canClose} onClick={() => doAssess.mutate("closed")}>Close assessment</Button>
              </div>
            </div>
          </Section>
        ) : (
          <Section title="Written assessment (Cbb Art. 17)">
            <KV label="Relevant">{a.relevant ?? "–"}</KV>
            <KV label="Measures need adjustment">{a.measures_need_adjustment ?? "–"}</KV>
            <KV label="Rationale">{a.rationale ? <span className="whitespace-pre-line">{a.rationale}</span> : null}</KV>
            <KV label="Assessed by">{a.assessed_by_name}{a.assessed_on ? ` on ${fmtDate(a.assessed_on)}` : ""}</KV>
          </Section>
        )}
        <Section title="Comments"><CommentsPanel targetType="advisory" targetId={a.id} canComment={a.can_edit} /></Section>
      </div>
      {vulnOpen && <VulnFromAdvisoryDialog advisory={a} onClose={() => setVulnOpen(false)} />}
      {taskOpen && <TaskFromDialog kind="advisory" id={a.id} onClose={() => setTaskOpen(false)} />}
    </>
  )
}

function VulnFromAdvisoryDialog({ advisory, onClose }: { advisory: Advisory; onClose: () => void }) {
  const qc = useQueryClient()
  const entities = useEntities()
  const [entityId, setEntityId] = useState<number | null>(advisory.entities[0]?.id ?? null)
  const save = useMutation({
    mutationFn: () => api.post(`/threats/advisories/${advisory.id}/vulnerability`, { entity_id: entityId }),
    onSuccess: () => { toast.success("Vulnerability created"); qc.invalidateQueries({ queryKey: ["threats"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create vulnerability from {advisory.code}</DialogTitle>
          <DialogDescription>A new vulnerability record is created for the chosen entity, pre-filled from this advisory.</DialogDescription>
        </DialogHeader>
        <Field label="Entity">
          <OptionSelect value={entityId != null ? String(entityId) : null} onChange={(v) => setEntityId(v ? Number(v) : null)}
            placeholder="Choose entity…" options={(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!entityId || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Creating…" : "Create vulnerability"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskFromDialog({ kind, id, onClose }: { kind: "advisory" | "vulnerability"; id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ title: "", description: "", assignee_id: null as number | null })
  const save = useMutation({
    mutationFn: () => api.post(`/threats/${kind === "advisory" ? "advisories" : "vulnerabilities"}/${id}/task`,
      { title: f.title.trim() || null, description: f.description.trim() || null, assignee_id: f.assignee_id }),
    onSuccess: () => { toast.success("Task created"); qc.invalidateQueries({ queryKey: ["threats"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create follow-up task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Title" hint="Leave empty for a default title"><Input value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} maxLength={300} /></Field>
          <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} /></Field>
          <Field label="Assignee"><UserSelect value={f.assignee_id} onChange={(v) => setF((s) => ({ ...s, assignee_id: v }))} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Creating…" : "Create task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdvisoryDialog({ adv, onClose, onSaved }: { adv: Advisory | null; onClose: () => void; onSaved: (a: Advisory) => void }) {
  const qc = useQueryClient()
  const entities = useEntities()
  const [f, setF] = useState({
    title: adv?.title ?? "", source: adv?.source ?? "other" as AdvisorySource, reference: adv?.reference ?? "",
    received_on: adv?.received_on ?? isoDate(new Date()), severity: adv?.severity ?? "medium" as Severity,
    summary: adv?.summary ?? "", entity_scope: adv?.entity_scope ?? "all" as "all" | "list",
    entity_ids: adv?.entity_ids ?? [] as number[], asset_ids: adv?.asset_ids ?? [] as number[],
    supplier_ids: adv?.supplier_ids ?? [] as number[],
  })
  const suppliers = useSupplierOptions()
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, reference: f.reference.trim() || null, summary: f.summary.trim() || null }
      return adv ? api.put<Advisory>(`/threats/advisories/${adv.id}`, body) : api.post<Advisory>("/threats/advisories", body)
    },
    onMutate: () => setError(null),
    onSuccess: (a) => { toast.success(adv ? "Advisory saved" : `${a.code} logged`); qc.invalidateQueries({ queryKey: ["threats"] }); onSaved(a) },
    onError: (e: Error) => setError(e.message),
  })
  const invalid = !f.title.trim() || !f.received_on || (f.entity_scope === "list" && f.entity_ids.length === 0)
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{adv ? `Edit ${adv.code}` : "Log advisory"}</DialogTitle>
          <DialogDescription>The written assessment deadline (Cbb Art. 17) is set from the severity and can be changed later.</DialogDescription>
        </DialogHeader>
        <form id="adv-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
          <Field label="Title" className="sm:col-span-2" htmlFor="adv-title">
            <Input id="adv-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300} />
          </Field>
          <Field label="Source">
            <OptionSelect value={f.source} onChange={(v) => set("source", (v ?? "other") as AdvisorySource)}
              options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
          </Field>
          <Field label="Reference / URL" htmlFor="adv-ref">
            <Input id="adv-ref" value={f.reference} onChange={(e) => set("reference", e.target.value)} maxLength={500} />
          </Field>
          <Field label="Received on" htmlFor="adv-received">
            <Input id="adv-received" type="date" value={f.received_on} onChange={(e) => set("received_on", e.target.value)} />
          </Field>
          <Field label="Severity">
            <OptionSelect value={f.severity} onChange={(v) => set("severity", (v ?? "medium") as Severity)}
              options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
          </Field>
          <Field label="Summary" className="sm:col-span-2" htmlFor="adv-summary">
            <Textarea id="adv-summary" rows={3} value={f.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Scope" className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-48">
                <OptionSelect value={f.entity_scope} onChange={(v) => set("entity_scope", (v ?? "all") as "all" | "list")}
                  options={[{ value: "all", label: "Group-wide" }, { value: "list", label: "Selected entities" }]} />
              </div>
              {f.entity_scope === "list" && (entities.data ?? []).map((e) => (
                <label key={e.id} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={f.entity_ids.includes(e.id)}
                    onCheckedChange={(v) => set("entity_ids", v ? [...f.entity_ids, e.id] : f.entity_ids.filter((x) => x !== e.id))} />
                  <span className="font-mono text-[12px] text-ink-2">{e.code}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Affected assets" className="sm:col-span-2">
            <AssetPicker value={f.asset_ids} onChange={(v) => set("asset_ids", v)} />
          </Field>
          {(suppliers.data ?? []).length > 0 && (
            <Field label="Affected suppliers" className="sm:col-span-2" hint="E.g. when a supplier's product or service is affected">
              <div className="flex flex-wrap items-center gap-1.5">
                {f.supplier_ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-[13px]">
                    {suppliers.data?.find((s) => s.id === id)?.name ?? `Supplier ${id}`}
                    <button type="button" aria-label="Remove supplier" className="text-ink-3 hover:text-alarm" onClick={() => set("supplier_ids", f.supplier_ids.filter((x) => x !== id))}><X className="size-3.5" /></button>
                  </span>
                ))}
                <div className="w-56"><Combo value={null} allowNone={false} placeholder="Add supplier…"
                  items={(suppliers.data ?? []).filter((s) => !f.supplier_ids.includes(s.id)).map((s) => ({ value: s.id, label: s.name }))}
                  onChange={(v) => v != null && set("supplier_ids", [...f.supplier_ids, v])} /></div>
              </div>
            </Field>
          )}
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="adv-form" disabled={invalid || save.isPending}>{save.isPending ? "Saving…" : adv ? "Save changes" : "Log advisory"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
