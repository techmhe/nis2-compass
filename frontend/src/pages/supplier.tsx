import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Download, FileSpreadsheet, Pencil, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, EntityTag, ErrorState, KV, Loading, PageHeader, Section, Stat } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { AssessmentsTab } from "@/components/suppliers/assessments"
import { CertificatesTab } from "@/components/suppliers/certificates"
import { ClausesTab } from "@/components/suppliers/clauses"
import { QuestionnaireImportDialog } from "@/components/suppliers/import-dialog"
import { IncidentsTab } from "@/components/suppliers/incidents"
import {
  CriticalityPill, type SupplierDetail, SupplierStatusPill, TierPill, TIER_ORDER, dueLabel, dueTone, supplierKey, useSupplierMeta,
} from "@/components/suppliers/shared"
import { SupplierFormDialog } from "@/components/suppliers/supplier-form"
import { useAuth } from "@/hooks/useAuth"
import { api, download } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "clauses", label: "Contract clauses" },
  { key: "certificates", label: "Certificates" },
  { key: "assessments", label: "Assessments" },
  { key: "dependencies", label: "Dependent services and assets" },
  { key: "incidents", label: "Incidents" },
  { key: "comments", label: "Comments" },
  { key: "documents", label: "Documents" },
] as const
type TabKey = (typeof TABS)[number]["key"]

const ASSET_TYPE: Record<string, string> = { IT: "IT system", OT: "OT system", cloud: "Cloud service", data: "Data", facility: "Facility", network: "Network" }
const LIFECYCLE: Record<string, string> = { planned: "Planned", in_operation: "In operation", end_of_life: "End of life", retired: "Retired" }

export default function SupplierPage() {
  const { id } = useParams()
  const sid = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { canAny } = useAuth()
  const meta = useSupplierMeta()
  const [params, setParams] = useSearchParams()
  const tab: TabKey = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "overview") as TabKey
  const [importOpen, setImportOpen] = useState(false)

  const q = useQuery({
    queryKey: supplierKey(sid),
    queryFn: () => api.get<SupplierDetail>(`/suppliers/${sid}`),
    enabled: Number.isFinite(sid) && canAny("suppliers.read"),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/suppliers/${sid}`),
    onSuccess: () => { toast.success("Supplier deleted"); qc.invalidateQueries({ queryKey: ["suppliers"] }); navigate("/suppliers") },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!canAny("suppliers.read")) return <ErrorState error="You do not have permission to view the supplier register." />
  if (!Number.isFinite(sid)) return <ErrorState error="Invalid supplier link." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  const s = q.data!
  const setTab = (t: TabKey) => setParams(t === "overview" ? {} : { tab: t }, { replace: true })
  const refresh = () => qc.invalidateQueries({ queryKey: supplierKey(sid) })
  const tierHint = s.tier_overridden
    ? `Set manually. Suggested tier: ${meta.tiers[s.suggested_tier]} (${s.tier_reason})`
    : `Derived: ${s.tier_reason}`

  const downloadQuestionnaire = () =>
    download(`/suppliers/${sid}/questionnaire.xlsx`, `Supplier_questionnaire_${s.code}.xlsx`).catch((e: Error) => toast.error(e.message))

  return (
    <div>
      <div className="mb-2 text-[12.5px] text-ink-3">
        <Link to="/suppliers" className="hover:text-petrol">Suppliers</Link>
      </div>
      <PageHeader
        title={<span className="flex flex-wrap items-baseline gap-3"><Code className="text-[14px]">{s.code}</Code>{s.name}</span>}
        description={s.legal_name && s.legal_name !== s.name ? s.legal_name : s.category ?? undefined}
        actions={
          <>
            {s.can_edit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline"><FileSpreadsheet /> Questionnaire <ChevronDown className="size-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={downloadQuestionnaire}><Download /> Download questionnaire</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setImportOpen(true)}><Upload /> Import answers</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {s.can_edit && (
              <SupplierFormDialog supplier={s} onSaved={(d) => qc.setQueryData(supplierKey(sid), d)}
                trigger={<Button variant="outline"><Pencil /> Edit supplier</Button>} />
            )}
            {s.can_edit && (
              <Confirm title={`Delete ${s.code} ${s.name}?`} confirmLabel="Delete supplier" onConfirm={() => del.mutate()}
                description="Clauses, certificates and assessments of this supplier are deleted as well. Set the status to offboarded instead if you want to keep the history."
                trigger={<Button variant="outline" aria-label="Delete supplier"><Trash2 /></Button>} />
            )}
          </>
        }
      >
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0}><TierPill tier={s.tier} /></span></TooltipTrigger>
            <TooltipContent className="max-w-[320px]">{tierHint}</TooltipContent>
          </Tooltip>
          {s.tier_overridden && s.suggested_tier !== s.tier && <span className="text-ink-3">suggested {meta.tiers[s.suggested_tier].toLowerCase()}</span>}
          <SupplierStatusPill status={s.status} />
          <span>{meta.access_types[s.access_type] ?? s.access_type}</span>
          <span className="flex items-center gap-1">
            {s.entities.length ? s.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />) : <span className="text-ink-3">No using entity</span>}
          </span>
        </div>
      </PageHeader>

      {s.can_edit && <QuestionnaireImportDialog supplierId={sid} open={importOpen} onOpenChange={setImportOpen} />}

      <nav aria-label="Supplier sections" role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              tab === t.key ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t.label}
            {t.key === "dependencies" && s.dependent_services + s.dependent_assets > 0 && (
              <span className="tabular ml-1.5 text-[12px] text-ink-3">{s.dependent_services + s.dependent_assets}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview s={s} onTab={setTab} />}
      {tab === "clauses" && <ClausesTab supplier={s} />}
      {tab === "certificates" && <CertificatesTab supplier={s} />}
      {tab === "assessments" && <AssessmentsTab supplier={s} />}
      {tab === "dependencies" && <Dependencies s={s} />}
      {tab === "incidents" && <IncidentsTab supplier={s} />}
      {tab === "comments" && (
        <Section title="Comments"><CommentsPanel targetType="supplier" targetId={s.id} canComment={s.can_edit || canAny("suppliers.manage")} /></Section>
      )}
      {tab === "documents" && (
        <Section title="Documents">
          <DocumentLinks targetType="supplier" targetId={s.id} documents={s.documents} canEdit={s.can_edit} onChange={refresh} />
        </Section>
      )}
    </div>
  )
}

function Overview({ s, onTab }: { s: SupplierDetail; onTab: (t: TabKey) => void }) {
  const meta = useSupplierMeta()
  const missing = s.clause_counts.missing
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-4">
          <Stat label="Next review" value={s.next_due ? fmtDate(s.next_due) : "–"}
            hint={<span className={dueTone(s.due_state)}>{dueLabel(s.due_state)}</span>} />
          <Stat label="Last assessment score" value={s.last_assessment?.score != null ? `${Math.round(s.last_assessment.score)}` : "–"}
            hint={s.last_assessment ? `${meta.methods[s.last_assessment.method] ?? s.last_assessment.method}, ${fmtDate(s.last_assessment.assessed_on)}` : "Not assessed yet"} />
          <Stat label="Contract clauses agreed" value={`${s.clause_counts.agreed} of 8`} tone={missing ? "alarm" : undefined}
            hint={missing ? `${missing} missing, ${s.clause_counts.partial} partial` : `${s.clause_counts.partial} partial`} />
          <Stat label="Valid certificates" value={s.certificates.valid + s.certificates.expiring}
            tone={s.certificates.expired ? "alarm" : s.certificates.expiring ? "amber" : undefined}
            hint={s.certificates.expired ? `${s.certificates.expired} expired` : s.certificates.expiring ? `${s.certificates.expiring} expiring soon` : `${s.certificates.total} recorded`} />
        </div>
        <Section title="Supplier">
          <KV label="Legal entity">{s.legal_name}</KV>
          <KV label="Country">{s.country}</KV>
          <KV label="Category">{s.category}</KV>
          <KV label="Website">{s.website ? <a href={/^https?:\/\//.test(s.website) ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer noopener" className="text-petrol hover:underline">{s.website}</a> : null}</KV>
          <KV label="ICT products and services">{s.services_products ? <span className="whitespace-pre-wrap">{s.services_products}</span> : null}</KV>
          <KV label="Access to our systems">{meta.access_types[s.access_type] ?? s.access_type}</KV>
          <KV label="Relationship owner">{s.relationship_owner?.name}</KV>
          <KV label="Contract reference">{s.contract_reference}</KV>
          <KV label="Contract end">{s.contract_end ? fmtDate(s.contract_end) : null}</KV>
          {s.description && <KV label="Description"><span className="whitespace-pre-wrap">{s.description}</span></KV>}
          {s.notes && <KV label="Notes"><span className="whitespace-pre-wrap">{s.notes}</span></KV>}
        </Section>
      </div>
      <div className="space-y-5">
        <Section title="Contact points">
          {s.contacts.length === 0 ? (
            <p className="text-[13px] text-ink-3">No contact recorded. IR 2024/2690 point 5.2 (a) asks for a contact point for each direct supplier; add one via Edit supplier.</p>
          ) : (
            <ul className="space-y-2.5">
              {s.contacts.map((c, i) => (
                <li key={i} className="text-[13px]">
                  <div className="font-medium text-ink">{c.name || c.role || "Contact"}</div>
                  {c.name && c.role && <div className="text-[12px] text-ink-3">{c.role}</div>}
                  {c.email && <a href={`mailto:${c.email}`} className="block text-petrol hover:underline">{c.email}</a>}
                  {c.phone && <div className="tabular text-ink-2">{c.phone}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Tier and review cycle">
          <div className="mb-2 flex items-center gap-2"><TierPill tier={s.tier} />{s.tier_overridden && <span className="text-[12px] text-ink-3">set manually</span>}</div>
          <p className="text-[13px] text-ink-2">{s.tier_overridden ? (s.tier_rationale || "No rationale recorded.") : s.tier_reason}</p>
          {s.tier_overridden && <p className="mt-1 text-[12px] text-ink-3">Suggested from access and dependent services: {meta.tiers[s.suggested_tier]} ({s.tier_reason})</p>}
          <div className="mt-3 border-t pt-2">
            {TIER_ORDER.map((t) => (
              <div key={t} className={cn("flex justify-between py-0.5 text-[12.5px]", t === s.tier ? "font-medium text-ink" : "text-ink-3")}>
                <span>{meta.tiers[t]}</span><span className="tabular">review every {s.review_months[t]} months</span>
              </div>
            ))}
          </div>
          <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => onTab("assessments")}>Open assessments</Button>
        </Section>
      </div>
    </div>
  )
}

function Dependencies({ s }: { s: SupplierDetail }) {
  return (
    <div className="space-y-5">
      <Section title="Dependent services" bodyClassName="p-0">
        {s.services.length === 0 ? (
          <Empty title="No dependent services">Link this supplier to services in Services and continuity, directly or through the assets it supports.</Empty>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b text-left text-[12px] text-ink-3">
              <th className="py-2 pr-2 pl-4 font-medium">Service</th><th className="px-2 py-2 font-medium">Entity</th>
              <th className="px-2 py-2 font-medium">Criticality</th><th className="px-2 py-2 pr-4 font-medium">Dependency</th>
            </tr></thead>
            <tbody>
              {s.services.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="py-2 pr-2 pl-4"><Code className="mr-2">{d.code}</Code>
                    <Link to={`/inventory/services?service=${d.id}`} className="text-ink hover:text-petrol">{d.name}</Link></td>
                  <td className="px-2 py-2">{d.entity ? <EntityTag code={d.entity.code} name={d.entity.name} /> : <span className="text-ink-3">Group</span>}</td>
                  <td className="px-2 py-2"><CriticalityPill value={d.criticality} /></td>
                  <td className="px-2 py-2 pr-4 text-ink-2">{d.via === "direct" ? "Direct" : `Through ${d.via}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Supported assets" bodyClassName="p-0">
        {s.assets.length === 0 ? (
          <Empty title="No assets linked">Set this supplier on the assets it maintains or operates in the asset inventory.</Empty>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b text-left text-[12px] text-ink-3">
              <th className="py-2 pr-2 pl-4 font-medium">Asset</th><th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Entity</th><th className="px-2 py-2 font-medium">Criticality</th>
              <th className="px-2 py-2 pr-4 font-medium">Lifecycle</th>
            </tr></thead>
            <tbody>
              {s.assets.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="py-2 pr-2 pl-4"><Code className="mr-2">{a.code}</Code>
                    <Link to={`/inventory/assets?asset=${a.id}`} className="text-ink hover:text-petrol">{a.name}</Link></td>
                  <td className="px-2 py-2 text-ink-2">{ASSET_TYPE[a.asset_type] ?? a.asset_type}</td>
                  <td className="px-2 py-2">{a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <span className="text-ink-3">Group</span>}</td>
                  <td className="px-2 py-2"><CriticalityPill value={a.criticality} /></td>
                  <td className="px-2 py-2 pr-4 text-ink-2">{LIFECYCLE[a.lifecycle] ?? a.lifecycle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {s.hidden_dependencies > 0 && (
        <p className="text-[12.5px] text-ink-3">{s.hidden_dependencies} more {s.hidden_dependencies === 1 ? "dependency" : "dependencies"} in entities you cannot see.</p>
      )}
    </div>
  )
}
