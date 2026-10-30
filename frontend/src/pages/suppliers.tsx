import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ClipboardList, Download, Plus, Search, Truck, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, EntityTag, ErrorState, Loading, PageHeader, Stat } from "@/components/common/basics"
import { OptionSelect, Segmented } from "@/components/common/fields"
import { QuestionnairesSheet } from "@/components/suppliers/questionnaires"
import {
  CLAUSE_CELL, CLAUSE_CODES, CLAUSE_SHORT, type SupplierSummary, type Tier, SupplierStatusPill, TierPill, TIER_ORDER, dueLabel, dueTone,
  RatingPill, useSupplierMeta,
} from "@/components/suppliers/shared"
import { SupplierFormDialog } from "@/components/suppliers/supplier-form"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type View = "register" | "clauses"

export default function SuppliersPage() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const meta = useSupplierMeta()
  const entities = useEntities()
  const [params, setParams] = useSearchParams()
  const view: View = params.get("view") === "clauses" ? "clauses" : "register"
  const [q, setQ] = useState("")
  const [tier, setTier] = useState<string | null>(null)
  const [access, setAccess] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [entity, setEntity] = useState<string | null>(null)
  const [showOffboarded, setShowOffboarded] = useState(false)

  const list = useQuery({ queryKey: ["suppliers", "list"], queryFn: () => api.get<SupplierSummary[]>("/suppliers") })
  const all = useMemo(() => list.data ?? [], [list.data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((s) => {
      if (tier && s.tier !== tier) return false
      if (access && s.access_type !== access) return false
      if (status ? s.status !== status : !showOffboarded && s.status === "offboarded") return false
      if (entity && !(entity === "group" ? s.entities.length === 0 : s.entities.some((e) => String(e.id) === entity))) return false
      if (needle && !`${s.code} ${s.name} ${s.legal_name ?? ""} ${s.category ?? ""} ${s.services_products ?? ""}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [all, q, tier, access, status, entity, showOffboarded])

  const stats = useMemo(() => {
    const live = all.filter((s) => s.status !== "offboarded")
    return {
      active: all.filter((s) => s.status === "active").length,
      onboarding: all.filter((s) => s.status === "onboarding").length,
      critical: live.filter((s) => s.tier === "critical").length,
      overdue: live.filter((s) => s.due_state === "overdue" || s.due_state === "never").length,
      dueSoon: live.filter((s) => s.due_state === "due_soon").length,
      expiring: live.reduce((n, s) => n + s.certificates.expiring, 0),
      expired: live.reduce((n, s) => n + s.certificates.expired, 0),
      missing: live.reduce((n, s) => n + s.clause_counts.missing, 0),
      noClauses: live.filter((s) => s.clause_counts.missing > 0).length,
    }
  }, [all])

  const canCreate = canAny("suppliers.manage")
  const filtersActive = !!(q || tier || access || status || entity)
  const setView = (v: View) => setParams((p) => { if (v === "register") p.delete("view"); else p.set("view", v); return p }, { replace: true })

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Register of direct suppliers and service providers (IR 2024/2690 point 5.2) with contract security clauses (point 5.1.4), certificates and periodic assessments. The tier follows the supplier's access and the criticality of the services that depend on it."
        actions={
          <>
            <QuestionnairesSheet trigger={<Button variant="outline"><ClipboardList /> Questionnaires</Button>} />
            {canAny("reports.export") && (
              <Button variant="outline" onClick={() => download("/suppliers/export.xlsx", "Supplier_register.xlsx").catch((e: Error) => toast.error(e.message))}>
                <Download /> Export to Excel
              </Button>
            )}
            {canCreate && (
              <SupplierFormDialog trigger={<Button data-tour="suppliers.add"><Plus /> Add supplier</Button>} onSaved={(s) => navigate(`/suppliers/${s.id}`)} />
            )}
          </>
        }
      />

      {list.data && all.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-5">
          <Stat label="Active suppliers" value={stats.active} hint={stats.onboarding ? `${stats.onboarding} onboarding` : "none onboarding"} />
          <Stat label="Critical tier" value={stats.critical} hint="Annual review" />
          <Stat label="Reviews overdue" value={stats.overdue} tone={stats.overdue ? "alarm" : undefined}
            hint={stats.dueSoon ? `${stats.dueSoon} due within 60 days` : "Including never assessed"} />
          <Stat label="Certificates expiring" value={stats.expiring} tone={stats.expiring ? "amber" : undefined}
            hint={stats.expired ? `${stats.expired} already expired` : "within 60 days"} />
          <Stat label="Contract clauses missing" value={stats.missing} tone={stats.missing ? "alarm" : undefined}
            hint={`across ${stats.noClauses} suppliers`} />
        </div>
      )}

      <div data-tour="suppliers.register" className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, category, products" className="pl-8" aria-label="Search suppliers" />
        </div>
        <Segmented value={tier ? meta.tiers[tier as Tier] : null} onChange={(v) => setTier(v ? v.toLowerCase() : null)}
          options={TIER_ORDER.map((t) => meta.tiers[t])} />
        <OptionSelect className="w-48" value={access} onChange={setAccess} allowNone noneLabel="All access types" placeholder="All access types"
          options={Object.entries(meta.access_types).map(([value, label]) => ({ value, label }))} />
        <OptionSelect className="w-36" value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
          options={Object.entries(meta.statuses).map(([value, label]) => ({ value, label }))} />
        <OptionSelect className="w-44" value={entity} onChange={setEntity} allowNone noneLabel="All entities" placeholder="All entities"
          options={[{ value: "group", label: "Group-wide only" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))]} />
        {!status && (
          <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
            <Switch id="show-off" checked={showOffboarded} onCheckedChange={setShowOffboarded} />
            <Label htmlFor="show-off" className="text-[13px] font-normal text-ink-2">Show offboarded</Label>
          </div>
        )}
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setTier(null); setAccess(null); setStatus(null); setEntity(null) }}><X /> Clear filters</Button>
        )}
        <div role="tablist" aria-label="View" data-tour="suppliers.views" className="ml-auto inline-flex rounded-md border bg-surface p-0.5">
          {([["register", "Register"], ["clauses", "Contract clauses"]] as const).map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn("h-7 rounded-[4px] px-3 text-[12.5px] font-medium", view === v ? "bg-card text-ink shadow-xs" : "text-ink-3 hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : all.length === 0 ? (
          <Empty title="No suppliers recorded" icon={<Truck className="size-6" />}
            action={canCreate && <SupplierFormDialog trigger={<Button size="sm"><Plus /> Add supplier</Button>} onSaved={(s) => navigate(`/suppliers/${s.id}`)} />}>
            Start with the suppliers that have remote access to IT or OT systems or process your data in the cloud. They are the ones the supervisory authorities ask about first.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="No suppliers match these filters">Remove a filter or search for something else.</Empty>
        ) : view === "register" ? <RegisterTable rows={rows} accessLabels={meta.access_types} /> : <ClauseMatrix rows={rows} clauses={meta.clauses} provisionUrl={meta.provision?.url} />}
      </div>
    </div>
  )
}

function RegisterTable({ rows, accessLabels }: { rows: SupplierSummary[]; accessLabels: Record<string, string> }) {
  const rank = { critical: 0, high: 1, standard: 2 }
  const sorted = [...rows].sort((a, b) => (a.status === "offboarded" ? 1 : 0) - (b.status === "offboarded" ? 1 : 0) || rank[a.tier] - rank[b.tier] || a.name.localeCompare(b.name))
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[1080px] text-[13px]">
        <thead>
          <tr className="border-b text-left text-[12px] text-ink-3">
            <th className="py-2 pr-2 pl-4 font-medium">Supplier</th>
            <th className="px-2 py-2 font-medium">Used by</th>
            <th className="px-2 py-2 font-medium">Access</th>
            <th className="px-2 py-2 font-medium">Tier</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Certificates</th>
            <th className="px-2 py-2 font-medium">Last assessment</th>
            <th className="px-2 py-2 font-medium">Next review</th>
            <th className="px-2 py-2 pr-4 text-right font-medium">Services</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.id} className={cn("border-b align-top last:border-0 hover:bg-muted/50", s.status === "offboarded" && "text-ink-3")}>
              <td className="py-2 pr-2 pl-4">
                <div className="flex items-baseline gap-2">
                  <Code className="shrink-0">{s.code}</Code>
                  <div className="min-w-0">
                    <Link to={`/suppliers/${s.id}`} className="font-medium text-ink hover:text-petrol">{s.name}</Link>
                    {s.category && <div className="mt-0.5 text-[12px] text-ink-3">{s.category}{s.country ? `, ${s.country}` : ""}</div>}
                  </div>
                </div>
              </td>
              <td className="px-2 py-2">
                {s.entities.length ? <div className="flex flex-wrap gap-1">{s.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}</div>
                  : <span className="text-[12.5px] text-ink-3">Group-wide</span>}
              </td>
              <td className="px-2 py-2 text-[12.5px] text-ink-2">{accessLabels[s.access_type] ?? s.access_type}</td>
              <td className="px-2 py-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex flex-col items-start gap-0.5" tabIndex={0}>
                      <TierPill tier={s.tier} />
                      {s.tier_overridden && s.tier !== s.suggested_tier && <span className="text-[11.5px] text-ink-3">suggested {s.suggested_tier}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{s.tier_overridden ? "Set manually. " : "Suggested: "}{s.tier_reason}</TooltipContent>
                </Tooltip>
              </td>
              <td className="px-2 py-2"><SupplierStatusPill status={s.status} /></td>
              <td className="px-2 py-2 text-[12.5px]">
                {s.certificates.total === 0 ? <span className="text-ink-3">None</span> : (
                  <div>
                    <div className="text-ink-2">{s.certificates.types.join(", ") || "None valid"}</div>
                    {(s.certificates.expiring > 0 || s.certificates.expired > 0) && (
                      <div className={s.certificates.expired ? "text-alarm" : "text-amber"}>
                        {[s.certificates.expired && `${s.certificates.expired} expired`, s.certificates.expiring && `${s.certificates.expiring} expiring`].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-[12.5px]">
                {s.last_assessment ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="tabular text-ink-2">{fmtDate(s.last_assessment.assessed_on)}{s.last_assessment.score != null && `, ${Math.round(s.last_assessment.score)}%`}</span>
                    <RatingPill rating={s.last_assessment.rating} />
                  </div>
                ) : <span className="text-ink-3">None</span>}
              </td>
              <td className="px-2 py-2 text-[12.5px]">
                <div className={cn("tabular", dueTone(s.due_state))}>{s.next_due ? fmtDate(s.next_due) : dueLabel(s.due_state)}</div>
                {s.next_due && s.due_state !== "ok" && <div className={cn("text-[11.5px]", dueTone(s.due_state))}>{dueLabel(s.due_state)}</div>}
              </td>
              <td className="tabular px-2 py-2 pr-4 text-right text-ink-2">{s.dependent_services || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClauseMatrix({ rows, clauses, provisionUrl }: { rows: SupplierSummary[]; clauses: { clause: string; title: string; text: string }[]; provisionUrl?: string }) {
  const title = (c: string) => clauses.find((x) => x.clause === c)
  return (
    <div className="p-4">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[820px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="min-w-[240px] pr-3 pb-2 font-medium">Supplier</th>
              <th className="w-[80px] pb-2 font-medium">Tier</th>
              {CLAUSE_CODES.map((c) => (
                <th key={c} className="w-[62px] pb-2 text-center font-medium">
                  <Tooltip>
                    <TooltipTrigger asChild><span tabIndex={0} className="cursor-help"><Code>5.1.4({c})</Code></span></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="font-medium">{title(c)?.title}</div>
                      <div className="mt-1 opacity-80">{title(c)?.text}</div>
                    </TooltipContent>
                  </Tooltip>
                </th>
              ))}
              <th className="w-[70px] pb-2 text-right font-medium">Agreed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const applicable = 8 - s.clause_counts.na
              return (
                <tr key={s.id}>
                  <td className="border-t py-1 pr-3">
                    <Link to={`/suppliers/${s.id}?tab=clauses`} className="flex items-baseline gap-2 hover:text-petrol">
                      <Code className="text-ink-3">{s.code}</Code><span className="line-clamp-1">{s.name}</span>
                    </Link>
                  </td>
                  <td className="border-t py-1"><TierPill tier={s.tier} /></td>
                  {CLAUSE_CODES.map((c) => {
                    const st = s.clauses[c] ?? "missing"
                    return (
                      <td key={c} className="border-t p-[3px]">
                        <div className={cn("flex h-7 items-center justify-center rounded-[3px] text-[11.5px] font-medium", CLAUSE_CELL[st])}
                          title={`${s.name}: 5.1.4(${c}) ${title(c)?.title ?? ""}`}>
                          {CLAUSE_SHORT[st]}
                        </div>
                      </td>
                    )
                  })}
                  <td className="tabular border-t py-1 text-right text-ink-2">{s.clause_counts.agreed}/{applicable}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        {(["agreed", "partial", "missing", "na"] as const).map((st) => (
          <span key={st} className="flex items-center gap-1.5"><span className={cn("inline-flex h-4 w-8 items-center justify-center rounded-[3px] text-[10px]", CLAUSE_CELL[st])}>{CLAUSE_SHORT[st]}</span>
            {{ agreed: "Agreed in the contract", partial: "Partly covered", missing: "Missing", na: "Not applicable" }[st]}</span>
        ))}
        {provisionUrl && <Link to={provisionUrl} className="text-petrol hover:underline">Read IR 2024/2690 point 5.1.4</Link>}
      </div>
    </div>
  )
}
