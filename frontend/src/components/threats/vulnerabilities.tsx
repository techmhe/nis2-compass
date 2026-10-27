import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bug, ClipboardList, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, Empty, ErrorState, KV, Loading, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Combo, EntitySelect, Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import type { ControlException } from "@/components/controls/types"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AssetPicker } from "./asset-picker"
import { TaskFromDialog } from "./advisories"
import { SEVERITY_LABEL, SeverityPill, VULN_STATUS_LABEL, VulnStatusPill } from "./shared"
import type { Severity, Vulnerability, VulnStatus } from "./types"

interface VulnList { items: Vulnerability[]; can_create: boolean }

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]
const STATUSES: VulnStatus[] = ["open", "in_progress", "mitigated", "remediated", "accepted"]

export function VulnerabilitiesTab() {
  const [params, setParams] = useSearchParams()
  const selected = params.get("vulnerability") ? Number(params.get("vulnerability")) : null
  const [status, setStatus] = useState<string | null>(null)
  const [severity, setSeverity] = useState<string | null>(null)
  const [editing, setEditing] = useState<Vulnerability | "new" | null>(null)
  const list = useQuery({ queryKey: ["threats", "vulnerabilities"], queryFn: () => api.get<VulnList>("/threats/vulnerabilities") })
  const items = list.data?.items ?? []
  const rows = useMemo(() => items.filter((v) =>
    (!status || (status === "overdue" ? v.overdue : v.status === status)) && (!severity || v.severity === severity)),
    [items, status, severity])
  const open = (id: number | null) => setParams((p) => { if (id) p.set("vulnerability", String(id)); else p.delete("vulnerability"); return p })
  const current = items.find((v) => v.id === selected) ?? null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-44">
          <OptionSelect value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
            options={[{ value: "overdue", label: "Remediation overdue" },
              ...STATUSES.map((s) => ({ value: s, label: VULN_STATUS_LABEL[s] }))]} />
        </div>
        <div className="w-40">
          <OptionSelect value={severity} onChange={setSeverity} allowNone noneLabel="All severities" placeholder="All severities"
            options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
        </div>
        <p className="flex-1 text-[12.5px] text-ink-3">Vulnerabilities tracked to remediation, with the deadline set from the severity (IR 2024/2690 6.10).</p>
        {list.data?.can_create && <Button onClick={() => setEditing("new")}><Bug /> Log vulnerability</Button>}
      </div>
      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : items.length === 0 ? (
          <Empty title="No vulnerabilities tracked" icon={<Bug className="size-6" />}
            action={list.data?.can_create && <Button size="sm" onClick={() => setEditing("new")}><Bug /> Log vulnerability</Button>}>
            Track vulnerabilities here from discovery to remediation, mitigation or a documented acceptance.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No vulnerability matches this filter" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Vulnerability</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Severity</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 pr-4 font-medium">Remediation due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className={cn("cursor-pointer border-b align-top last:border-0 hover:bg-muted/50", selected === v.id && "bg-petrol-50/40")} onClick={() => open(v.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{v.code}</Code>
                        <button type="button" className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); open(v.id) }}>{v.title}</button>
                      </div>
                      {v.cve_ids.length > 0 && <div className="mt-0.5 text-[11.5px] text-ink-3">{v.cve_ids.join(", ")}</div>}
                    </td>
                    <td className="px-2 py-2">{v.entity ? <EntityTag code={v.entity.code} name={v.entity.name} /> : <span className="text-ink-3">Group</span>}</td>
                    <td className="px-2 py-2"><SeverityPill severity={v.severity} /></td>
                    <td className="px-2 py-2 text-ink-2">{v.owner_user_name ?? v.owner_stakeholder_name ?? "–"}</td>
                    <td className="px-2 py-2"><VulnStatusPill status={v.status} overdue={v.overdue} /></td>
                    <td className="tabular px-2 py-2 pr-4 whitespace-nowrap text-ink-2">{fmtDate(v.remediation_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Sheet open={selected != null} onOpenChange={(v) => { if (!v) open(null) }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
          {selected != null && (current ? <VulnBody v={current} onEdit={() => setEditing(current)} onDeleted={() => open(null)} /> : (
            <><SheetHeader><SheetTitle>Vulnerability</SheetTitle><SheetDescription className="sr-only">Details</SheetDescription></SheetHeader>
              {list.isLoading ? <Loading /> : <ErrorState className="m-4" error="This vulnerability does not exist or you have no access to it." />}</>
          ))}
        </SheetContent>
      </Sheet>
      {editing && <VulnDialog v={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(v) => { setEditing(null); open(v.id) }} />}
    </div>
  )
}

function VulnBody({ v, onEdit, onDeleted }: { v: Vulnerability; onEdit: () => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [taskOpen, setTaskOpen] = useState(false)
  const done = (msg: string) => () => { toast.success(msg); qc.invalidateQueries({ queryKey: ["threats"] }) }
  const del = useMutation({
    mutationFn: () => api.del(`/threats/vulnerabilities/${v.id}`),
    onSuccess: () => { done("Vulnerability deleted")(); onDeleted() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <Code>{v.code}</Code>{v.cve_ids.length > 0 && <span>{v.cve_ids.join(", ")}</span>}
        </div>
        <SheetTitle className="text-[17px] leading-snug">{v.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <SeverityPill severity={v.severity} /><VulnStatusPill status={v.status} overdue={v.overdue} />
          <span>Discovered {fmtDate(v.discovered_on)}</span>
        </SheetDescription>
        {v.can_edit && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
            <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}><ClipboardList /> Create task</Button>
            <Confirm title={`Delete ${v.code}?`} description="The vulnerability record is removed permanently." confirmLabel="Delete vulnerability"
              onConfirm={() => del.mutate()} trigger={<Button size="sm" variant="outline" className="text-alarm"><Trash2 /> Delete</Button>} />
          </div>
        )}
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <div>
          <KV label="Entity">{v.entity ? <EntityTag code={v.entity.code} name={v.entity.name} /> : "Group-wide"}</KV>
          <KV label="CVSS">{v.cvss ?? null}</KV>
          {v.advisory && <KV label="From advisory"><Link to={`/threats/advisories?advisory=${v.advisory.id}`} className="hover:text-petrol"><Code>{v.advisory.code}</Code> {v.advisory.title}</Link></KV>}
          <KV label="Owner">{v.owner_user_name ?? v.owner_stakeholder_name}</KV>
          <KV label="Affected assets">{v.assets.length ? <span className="flex flex-wrap gap-1">{v.assets.map((x) => <Code key={x.id}>{x.code}</Code>)}</span> : null}</KV>
          <KV label="Remediated on">{v.remediated_on ? fmtDate(v.remediated_on) : null}</KV>
          {v.exception && <KV label="Linked exception"><Link to={`/controls/exceptions?exception=${v.exception.id}`} className="hover:text-petrol"><Code>{v.exception.code}</Code> {v.exception.title}</Link></KV>}
          <KV label="Acceptance justification">{v.acceptance_justification ? <span className="whitespace-pre-line">{v.acceptance_justification}</span> : null}</KV>
          <KV label="Notes">{v.notes ? <span className="whitespace-pre-line">{v.notes}</span> : null}</KV>
        </div>
        <Section title="Comments"><CommentsPanel targetType="vulnerability" targetId={v.id} canComment={v.can_edit} /></Section>
      </div>
      {taskOpen && <TaskFromDialog kind="vulnerability" id={v.id} onClose={() => setTaskOpen(false)} />}
    </>
  )
}

function VulnDialog({ v, onClose, onSaved }: { v: Vulnerability | null; onClose: () => void; onSaved: (v: Vulnerability) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    title: v?.title ?? "", cve_ids: v?.cve_ids.join(", ") ?? "", entity_id: v?.entity?.id ?? null as number | null,
    severity: v?.severity ?? "medium" as Severity, cvss: v?.cvss != null ? String(v.cvss) : "",
    discovered_on: v?.discovered_on ?? isoDate(new Date()), status: v?.status ?? "open" as VulnStatus,
    owner_user_id: v?.owner_user_id ?? null as number | null, owner_stakeholder_id: v?.owner_stakeholder_id ?? null as number | null,
    acceptance_justification: v?.acceptance_justification ?? "", notes: v?.notes ?? "", asset_ids: v?.asset_ids ?? [] as number[],
    exception_id: v?.exception_id ?? null as number | null,
  })
  const exceptions = useQuery({
    queryKey: ["controls", "exceptions"], queryFn: () => api.get<{ items: ControlException[] }>("/controls/exceptions"),
    enabled: f.status === "accepted",
  })
  const exceptionOptions = (exceptions.data?.items ?? [])
    .filter((x) => (x.entity?.id ?? null) === f.entity_id && x.status !== "rejected")
    .map((x) => ({ value: x.id, label: `${x.code} ${x.title}`, hint: x.status }))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((s) => ({ ...s, [k]: val }))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f, cve_ids: f.cve_ids.split(",").map((s) => s.trim()).filter(Boolean), cvss: f.cvss.trim() ? Number(f.cvss) : null,
        acceptance_justification: f.acceptance_justification.trim() || null, notes: f.notes.trim() || null,
        advisory_id: v?.advisory_id ?? null, remediation_due: null,
      }
      return v ? api.put<Vulnerability>(`/threats/vulnerabilities/${v.id}`, body) : api.post<Vulnerability>("/threats/vulnerabilities", body)
    },
    onMutate: () => setError(null),
    onSuccess: (r) => { toast.success(v ? "Vulnerability saved" : `${r.code} logged`); qc.invalidateQueries({ queryKey: ["threats"] }); onSaved(r) },
    onError: (e: Error) => setError(e.message),
  })
  const needsAcceptance = f.status === "accepted" && !f.acceptance_justification.trim() && !f.exception_id
  const invalid = !f.title.trim() || !f.discovered_on || needsAcceptance
  return (
    <Dialog open onOpenChange={(val) => { if (!val) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{v ? `Edit ${v.code}` : "Log vulnerability"}</DialogTitle>
          <DialogDescription>The remediation deadline is set from the severity unless changed later. Accepting needs a linked exception or a justification.</DialogDescription>
        </DialogHeader>
        <form id="vuln-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
          <Field label="Title" className="sm:col-span-2" htmlFor="vuln-title">
            <Input id="vuln-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300} />
          </Field>
          <Field label="CVE IDs" htmlFor="vuln-cve" hint="Comma-separated">
            <Input id="vuln-cve" value={f.cve_ids} onChange={(e) => set("cve_ids", e.target.value)} placeholder="CVE-2026-12345" />
          </Field>
          <Field label="Entity" hint="Leave empty for group-wide">
            <EntitySelect value={f.entity_id} onChange={(x) => set("entity_id", x)} />
          </Field>
          <Field label="Severity">
            <OptionSelect value={f.severity} onChange={(x) => set("severity", (x ?? "medium") as Severity)}
              options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
          </Field>
          <Field label="CVSS" htmlFor="vuln-cvss">
            <Input id="vuln-cvss" type="number" min={0} max={10} step={0.1} value={f.cvss} onChange={(e) => set("cvss", e.target.value)} />
          </Field>
          <Field label="Discovered on" htmlFor="vuln-discovered">
            <Input id="vuln-discovered" type="date" value={f.discovered_on} onChange={(e) => set("discovered_on", e.target.value)} />
          </Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={(x) => set("status", (x ?? "open") as VulnStatus)}
              options={STATUSES.map((s) => ({ value: s, label: VULN_STATUS_LABEL[s] }))} />
          </Field>
          <Field label="Owner (user)">
            <UserSelect value={f.owner_user_id} onChange={(x) => set("owner_user_id", x)} />
          </Field>
          <Field label="Owner (role)">
            <StakeholderSelect value={f.owner_stakeholder_id} onChange={(x) => set("owner_stakeholder_id", x)} />
          </Field>
          <Field label="Affected assets" className="sm:col-span-2">
            <AssetPicker value={f.asset_ids} onChange={(x) => set("asset_ids", x)} />
          </Field>
          {f.status === "accepted" && (
            <Field label="Control exception" className="sm:col-span-2" hint="Approved exceptions of the same entity (Controls → Exceptions)">
              <Combo value={f.exception_id} onChange={(x) => set("exception_id", x)} items={exceptionOptions} placeholder="Link an exception…" />
            </Field>
          )}
          {f.status === "accepted" && (
            <Field label="Acceptance justification" className="sm:col-span-2" htmlFor="vuln-accept" hint="Required unless a control exception is linked">
              <Textarea id="vuln-accept" rows={2} value={f.acceptance_justification} onChange={(e) => set("acceptance_justification", e.target.value)} />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2" htmlFor="vuln-notes">
            <Textarea id="vuln-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="vuln-form" disabled={invalid || save.isPending}>{save.isPending ? "Saving…" : v ? "Save changes" : "Log vulnerability"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
