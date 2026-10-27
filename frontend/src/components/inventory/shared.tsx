import { useState, type ReactNode } from "react"
import { useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import type { DocLink, EntityBrief } from "@/lib/types"
import { cn } from "@/lib/utils"

// --- types ----------------------------------------------------------------------------------------------

export interface Owner { id: number; name: string }
export interface SupplierBrief { id: number; code: string; name: string; status: string; access_type: string; tier?: string | null }
export interface ExerciseBrief {
  id: number; code: string; title: string; exercise_type: string; exercise_date: string; result: string | null
  achieved_rto_hours: number | null; achieved_rpo_hours: number | null
}
export interface PlanBrief { id: number; code: string; title: string; plan_type: string; last_tested: string | null; next_test_due: string | null }
export interface HistoryEvent { at: string; actor: string | null; action: string; details: Record<string, unknown> | null }

export interface ServiceRow {
  id: number; code: string; entity: EntityBrief | null; entity_id: number | null; name: string; description: string | null
  kind: string; criticality: number; nis2_relevant: boolean; owner: Owner | null; owner_id: number | null
  rto_hours: number | null; rpo_hours: number | null; status: string; tags: string[]; notes: string | null
  asset_ids: number[]; supplier_ids: number[]
  bia: { bia_id: number; status: string; period: string; mtpd_hours: number | null; rto_hours: number | null; rpo_hours: number | null } | null
  plans: PlanBrief[]; restore_state: string | null; updated_at: string; can_edit: boolean
}

export interface AssetBrief {
  id: number; code: string; name: string; asset_type: string; entity: EntityBrief | null; criticality: number | null
  lifecycle: string; supplier: SupplierBrief | null; owner: Owner | null
}

export interface CoverageRow {
  service_id: number; code: string; name: string; entity_id: number | null; entity?: EntityBrief | null; criticality: number
  rto_hours: number | null; rpo_hours: number | null; state: string
  last_success: (ExerciseBriefLite) | null; last_test: (ExerciseBriefLite) | null
}
interface ExerciseBriefLite { id: number; code: string; title: string; date: string; result: string; type: string; achieved_rto_hours: number | null; achieved_rpo_hours: number | null }

export interface ServiceDetail extends ServiceRow {
  assets: AssetBrief[]; suppliers: SupplierBrief[]; exercises: ExerciseBrief[]
  bia_items: { bia_id: number; item_id: number; period: string; status: string; entity: EntityBrief | null; mtpd_hours: number | null; rto_hours: number | null; rpo_hours: number | null; min_staffing: number | null }[]
  coverage: CoverageRow | null; documents: DocLink[]; history: HistoryEvent[]
}

export interface AssetRow {
  id: number; code: string; external_id: string | null; entity: EntityBrief | null; entity_id: number | null; site: string | null
  name: string; asset_type: string; description: string | null; owner: Owner | null; owner_id: number | null
  confidentiality: number | null; integrity: number | null; availability: number | null; criticality: number | null
  ot_zone: string | null; ot_conduit: string | null; supplier: SupplierBrief | null; supplier_id: number | null; lifecycle: string
  location: string | null; vendor_product: string | null; crypto_algorithms: string | null; key_management_owner: string | null
  tags: string[]; notes: string | null; service_ids: number[]; updated_at: string; can_edit: boolean
}

export interface AssetDetail extends AssetRow {
  services: { id: number; code: string; name: string; criticality: number; entity: EntityBrief | null; status: string }[]
  exercises: ExerciseBrief[]; documents: DocLink[]; history: HistoryEvent[]
}

export interface Flag {
  code: string; severity: "high" | "medium" | "low"; object_type: "service" | "asset"; object_id: number; object_code: string
  label: string; entity_id: number | null; entity?: EntityBrief | null; message: string
}

export interface InventoryMeta {
  asset_types: Record<string, string>; lifecycle: Record<string, string>; service_status: Record<string, string>
  service_kinds: Record<string, string>; criticality: Record<string, string>; cia_levels: Record<string, string>
  plan_types: Record<string, string>; plan_status: Record<string, string>; exercise_types: Record<string, string>
  results: Record<string, string>; bia_status: Record<string, string>; dimensions: Record<string, string>
  windows: { key: string; label: string; hours: number }[]; impact_levels: Record<string, string>; mtpd_threshold: number
  default_requirement: Record<string, string>
  import_fields: Record<"assets" | "services", { field: string; label: string; required: boolean }[]>
}

export interface SupplierListRow { id: number; code: string; name: string; tier: string; status: string; access_type: string }

// --- data hooks -----------------------------------------------------------------------------------------

export function useInventoryMeta() {
  return useQuery({ queryKey: ["inv", "meta"], queryFn: () => api.get<InventoryMeta>("/inventory/meta"), staleTime: 30 * 60_000 })
}

export function useServices() {
  return useQuery({ queryKey: ["inv", "services"], queryFn: () => api.get<ServiceRow[]>("/inventory/services") })
}

export function useAssets() {
  return useQuery({ queryKey: ["inv", "assets"], queryFn: () => api.get<AssetRow[]>("/inventory/assets") })
}

export function useSupplierOptions() {
  const { canAny } = useAuth()
  return useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: () => api.get<SupplierListRow[]>("/suppliers"),
    enabled: canAny("suppliers.read"),
    staleTime: 60_000,
  })
}

/** Set or clear one URL search parameter without adding a history entry. */
export function useParam(key: string): [string | null, (v: string | number | null) => void] {
  const [params, setParams] = useSearchParams()
  const set = (v: string | number | null) => setParams((p) => {
    if (v == null || v === "") p.delete(key)
    else p.set(key, String(v))
    return p
  }, { replace: true })
  return [params.get(key), set]
}

export function useOpenSheet() {
  const [, setParams] = useSearchParams()
  return (key: "service" | "asset" | "plan" | "exercise", id: number) =>
    setParams((p) => {
      for (const k of ["service", "asset", "plan", "exercise"]) p.delete(k)
      p.set(key, String(id))
      return p
    })
}

// --- formatting -----------------------------------------------------------------------------------------

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return "–"
  if (h >= 48 && h % 24 === 0) return `${h / 24} d`
  const v = Number.isInteger(h) ? String(h) : h.toFixed(1)
  return `${v} h`
}

export const CRIT_LABEL: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Critical" }
const CRIT_TONE: Record<number, string> = { 1: "outline", 2: "neutral", 3: "amber", 4: "alarm" }

export function CritPill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-ink-3">–</span>
  return <Pill tone={CRIT_TONE[value] ?? "neutral"}>{CRIT_LABEL[value] ?? value}</Pill>
}

const LEVEL_BG = ["", "bg-muted text-ink-2", "bg-amber-50 text-amber", "bg-amber/25 text-ink", "bg-alarm/80 text-white"]

/** Compact C / I / A classification: three small cells. */
export function CiaCells({ c, i, a }: { c: number | null; i: number | null; a: number | null }) {
  const labels = ["Confidentiality", "Integrity", "Availability"]
  return (
    <span className="inline-flex gap-0.5">
      {[c, i, a].map((v, idx) => (
        <Tooltip key={idx}>
          <TooltipTrigger asChild>
            <span tabIndex={0} className={cn("tabular inline-flex size-5 items-center justify-center rounded-[3px] text-[11px] font-medium",
              v == null ? "border border-dashed text-ink-3" : LEVEL_BG[v])}
              aria-label={`${labels[idx]}: ${v == null ? "not set" : CIA_LABEL[v]}`}>
              {v ?? "?"}
            </span>
          </TooltipTrigger>
          <TooltipContent>{labels[idx]}: {v == null ? "not set" : CIA_LABEL[v]}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}
export const CIA_LABEL: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Very high" }

const COVERAGE: Record<string, [string, string]> = {
  ok: ["sage", "Tested within target"],
  exceeds: ["amber", "Target exceeded"],
  failed: ["alarm", "Last test failed"],
  stale: ["amber", "Test older than 12 months"],
  no_test: ["alarm", "No restore test"],
  no_target: ["neutral", "No RTO target"],
}
export function CoveragePill({ state }: { state: string | null | undefined }) {
  if (!state) return <span className="text-ink-3">–</span>
  const [tone, label] = COVERAGE[state] ?? ["neutral", state]
  return <Pill tone={tone}>{label}</Pill>
}

const TEST_STATE: Record<string, [string, string]> = {
  ok: ["sage", "On schedule"], due_soon: ["amber", "Due soon"], overdue: ["alarm", "Overdue"], never: ["alarm", "Never tested"],
  "n/a": ["outline", "Not applicable"],
}
export function TestStatePill({ state }: { state: string }) {
  const [tone, label] = TEST_STATE[state] ?? ["neutral", state]
  return <Pill tone={tone}>{label}</Pill>
}

const RESULT: Record<string, [string, string]> = { passed: ["sage", "Passed"], partially: ["amber", "Partially passed"], failed: ["alarm", "Failed"] }
export function ResultPill({ result }: { result: string | null }) {
  if (!result) return <Pill tone="outline">Planned</Pill>
  const [tone, label] = RESULT[result] ?? ["neutral", result]
  return <Pill tone={tone}>{label}</Pill>
}

const LIFECYCLE_TONE: Record<string, string> = { planned: "outline", in_operation: "neutral", end_of_life: "amber", retired: "outline" }
export function LifecyclePill({ value, label }: { value: string; label?: string }) {
  return <Pill tone={LIFECYCLE_TONE[value] ?? "neutral"}>{label ?? value.replace(/_/g, " ")}</Pill>
}

export function BiaStatePill({ bia }: { bia: ServiceRow["bia"] }) {
  if (!bia) return <Pill tone="outline">No BIA</Pill>
  return bia.status === "approved" ? <Pill tone="sage">Approved {bia.period}</Pill> : <Pill tone="brass">Draft {bia.period}</Pill>
}

export const TIER_TONE: Record<string, string> = { critical: "alarm", high: "amber", standard: "neutral" }
export function TierPill({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null
  return <Pill tone={TIER_TONE[tier] ?? "neutral"}>{tier[0].toUpperCase() + tier.slice(1)} tier</Pill>
}

// --- inputs ---------------------------------------------------------------------------------------------

/** Entity filter: all entities, group-wide objects only, or one entity. Value "0" means group-wide. */
export function EntityFilter({ value, onChange, className }: { value: string | null; onChange: (v: string | null) => void; className?: string }) {
  const entities = useEntities()
  return (
    <OptionSelect className={className ?? "w-48"} value={value} onChange={onChange} allowNone noneLabel="All entities" placeholder="All entities"
      options={[{ value: "0", label: "Group-wide" },
        ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))]} />
  )
}

export function matchesEntity(filter: string | null, entityId: number | null): boolean {
  if (filter == null) return true
  if (filter === "0") return entityId == null
  return String(entityId) === filter
}

/** Entity select limited to entities the user may write for with the given permission. */
export function ManagedEntitySelect({ value, onChange, perm = "assets.manage", disabled, allowGroup = true }: {
  value: number | null; onChange: (v: number | null) => void; perm?: string; disabled?: boolean; allowGroup?: boolean
}) {
  const { can, canGlobal } = useAuth()
  const entities = useEntities()
  const opts = (entities.data ?? []).filter((e) => can(perm, e.id) || e.id === value)
  const group = allowGroup && (canGlobal(perm) || value == null)
  return (
    <OptionSelect value={value != null ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)} disabled={disabled}
      allowNone={group} noneLabel="Group-wide" placeholder="Entity…"
      options={opts.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
  )
}

/** Searchable multi-select with removable chips. */
export function MultiCombo({ value, onChange, items, placeholder = "Add…", disabled, emptyText = "Nothing selected." }: {
  value: number[]
  onChange: (v: number[]) => void
  items: { value: number; label: string; hint?: string }[]
  placeholder?: string
  disabled?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value.map((v) => items.find((i) => i.value === v) ?? { value: v, label: `#${v}` })
  const toggle = (v: number) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="space-y-2">
      {selected.length === 0 ? <p className="text-[12.5px] text-ink-3">{emptyText}</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <li key={s.value} className="inline-flex max-w-full items-center gap-1 rounded-[4px] border bg-surface py-0.5 pr-1 pl-2 text-[12.5px] text-ink">
              <span className="truncate">{s.label}</span>
              {!disabled && (
                <button type="button" className="rounded-[3px] p-0.5 text-ink-3 hover:bg-muted hover:text-ink" aria-label={`Remove ${s.label}`} onClick={() => toggle(s.value)}>
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" role="combobox" aria-expanded={open} className="w-full justify-between font-normal text-ink-3">
              {placeholder}<ChevronsUpDown className="size-3.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search…" />
              <CommandList>
                <CommandEmpty>No match.</CommandEmpty>
                <CommandGroup>
                  {items.map((i) => (
                    <CommandItem key={i.value} value={`${i.label} ${i.hint ?? ""}`} onSelect={() => toggle(i.value)}>
                      <Check className={cn("size-3.5", value.includes(i.value) ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{i.label}</span>
                      {i.hint && <span className="ml-auto truncate text-[11.5px] text-ink-3">{i.hint}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

/** Tag editor: comma separated input stored as a list. */
export function tagsFromText(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20)
}

export function numOrNull(s: string): number | null {
  const t = s.trim().replace(",", ".")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// --- blocks ---------------------------------------------------------------------------------------------

export function SheetSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

const ACTION_LABEL: Record<string, string> = { create: "Created", update: "Changed", delete: "Deleted", import: "Imported", approve: "Approved", reopen: "Reopened" }

function show(v: unknown): string {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "empty"
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/** Change history from the audit log with field-level differences. */
export function HistoryList({ events }: { events: HistoryEvent[] }) {
  if (!events.length) return <p className="text-[13px] text-ink-3">No changes recorded yet.</p>
  return (
    <ol className="space-y-2.5">
      {events.map((e, n) => {
        const diffs = Object.entries(e.details ?? {}).filter(([, v]) => Array.isArray(v) && v.length === 2) as [string, [unknown, unknown]][]
        const other = Object.entries(e.details ?? {}).filter(([, v]) => !(Array.isArray(v) && v.length === 2))
        return (
          <li key={n} className="border-l-2 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-3">
              <span className="font-medium text-ink-2">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span>{e.actor ?? "system"}</span>
              <span className="tabular">{fmtDateTime(e.at)}</span>
            </div>
            {diffs.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[12.5px]">
                {diffs.map(([k, [a, b]]) => (
                  <li key={k} className="break-words">
                    <span className="text-ink-3">{k.replace(/_/g, " ")}:</span>{" "}
                    <span className="text-ink-3 line-through">{show(a)}</span>{" "}
                    <span className="text-ink">{show(b)}</span>
                  </li>
                ))}
              </ul>
            )}
            {other.length > 0 && (
              <div className="mt-1 text-[12.5px] text-ink-2">{other.map(([k, v]) => `${k.replace(/_/g, " ")}: ${show(v)}`).join("; ")}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
