import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Download, HardDrive, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, KV, Loading, Pill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { Combo, Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api, download } from "@/lib/api"
import { fmtDate, fromNow } from "@/lib/format"
import { ImportWizard } from "./import-wizard"
import {
  CiaCells, CIA_LABEL, CritPill, CRIT_LABEL, EntityFilter, HistoryList, LifecyclePill, ManagedEntitySelect, matchesEntity,
  MultiCombo, ResultPill, SheetSection, tagsFromText, useAssets, useInventoryMeta, useOpenSheet, useParam, useServices,
  SupplierRef, useSupplierOptions, type AssetDetail, type AssetRow, type Flag,
} from "./shared"

export function useFlags(entity?: string | null) {
  return useQuery({
    queryKey: ["inv", "consistency", entity ?? null],
    queryFn: () => api.get<Flag[]>("/inventory/consistency", { entity_id: entity ?? undefined }),
  })
}

export function AssetsTab() {
  const { canAny } = useAuth()
  const meta = useInventoryMeta()
  const list = useAssets()
  const flags = useFlags()
  const openSheet = useOpenSheet()
  const [q, setQ] = useState("")
  const [entity, setEntity] = useParam("entity")
  const [type, setType] = useState<string | null>(null)
  const [lifecycle, setLifecycle] = useState<string | null>(null)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const flagged = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const f of flags.data ?? []) if (f.object_type === "asset") m.set(f.object_id, [...(m.get(f.object_id) ?? []), f.message])
    return m
  }, [flags.data])
  const all = useMemo(() => list.data ?? [], [list.data])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((a) => matchesEntity(entity, a.entity_id)
      && (!type || a.asset_type === type)
      && (lifecycle ? a.lifecycle === lifecycle : a.lifecycle !== "retired")
      && (!flaggedOnly || flagged.has(a.id))
      && (!needle || `${a.code} ${a.name} ${a.external_id ?? ""} ${a.site ?? ""} ${a.owner?.name ?? ""} ${a.supplier?.name ?? ""} ${a.ot_zone ?? ""} ${a.vendor_product ?? ""} ${a.tags.join(" ")}`.toLowerCase().includes(needle)))
  }, [all, q, entity, type, lifecycle, flaggedOnly, flagged])
  const canCreate = canAny("assets.manage")
  const filtersActive = !!(q || entity || type || lifecycle || flaggedOnly)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, site, zone, supplier" className="pl-8" aria-label="Search assets" />
        </div>
        <EntityFilter value={entity} onChange={setEntity} />
        <OptionSelect className="w-40" value={type} onChange={setType} allowNone noneLabel="All types" placeholder="All types"
          options={Object.entries(meta.data?.asset_types ?? {}).map(([value, label]) => ({ value, label }))} />
        <OptionSelect className="w-44" value={lifecycle} onChange={setLifecycle} allowNone noneLabel="All except retired" placeholder="All except retired"
          options={Object.entries(meta.data?.lifecycle ?? {}).map(([value, label]) => ({ value, label }))} />
        <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
          <Switch id="flagged-only" checked={flaggedOnly} onCheckedChange={setFlaggedOnly} />
          <Label htmlFor="flagged-only" className="text-[13px] font-normal text-ink-2">Flagged only</Label>
        </div>
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setEntity(null); setType(null); setLifecycle(null); setFlaggedOnly(false) }}><X /> Clear filters</Button>}
        <div className="ml-auto flex gap-2">
          {canAny("reports.export") && (
            <Button variant="outline" onClick={() => download("/inventory/export.xlsx", "Inventory.xlsx").catch((e: Error) => toast.error(e.message))}><Download /> Export to Excel</Button>
          )}
          {canCreate && <Button variant="outline" onClick={() => setImporting(true)}><Upload /> Import</Button>}
          {canCreate && <Button onClick={() => setCreating(true)}><Plus /> New asset</Button>}
        </div>
      </div>
      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : all.length === 0 ? (
          <Empty title="No assets recorded" icon={<HardDrive className="size-6" />}
            action={canCreate && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setImporting(true)}><Upload /> Import from CMDB export</Button><Button size="sm" onClick={() => setCreating(true)}><Plus /> New asset</Button></div>}>
            Import systems, OT components, cloud services, data and facilities from a CMDB or OT inventory export, or record them one by one.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No assets match these filters">Remove a filter or search for something else.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Asset</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Entity and site</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 font-medium" title="Confidentiality, integrity, availability">C / I / A</th>
                  <th className="px-2 py-2 font-medium">Criticality</th>
                  <th className="px-2 py-2 font-medium">OT zone</th>
                  <th className="px-2 py-2 font-medium">Supplier</th>
                  <th className="px-2 py-2 pr-4 font-medium">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const fl = flagged.get(a.id)
                  return (
                    <tr key={a.id} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50" onClick={() => openSheet("asset", a.id)}>
                      <td className="py-2 pr-2 pl-4">
                        <div className="flex items-baseline gap-2">
                          <Code className="shrink-0">{a.code}</Code>
                          <div className="min-w-0">
                            <button className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); openSheet("asset", a.id) }}>{a.name}</button>
                            {fl && <div className="mt-0.5 flex items-center gap-1 text-[12px] text-amber" title={fl.join("\n")}><AlertTriangle className="size-3" />{fl[0]}{fl.length > 1 ? ` (+${fl.length - 1})` : ""}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-ink-2">{meta.data?.asset_types[a.asset_type] ?? a.asset_type}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          {a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}
                          {a.site && <span className="truncate text-[12.5px] text-ink-2">{a.site}</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-ink-2">{a.owner?.name ?? <span className="text-alarm">No owner</span>}</td>
                      <td className="px-2 py-2"><CiaCells c={a.confidentiality} i={a.integrity} a={a.availability} /></td>
                      <td className="px-2 py-2"><CritPill value={a.criticality} /></td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-[12.5px] text-ink-2" title={a.ot_zone ?? undefined}>{a.ot_zone ?? <span className="text-ink-3">–</span>}</td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        {a.supplier ? <SupplierRef s={a.supplier} className="text-ink-2 hover:text-petrol" /> : <span className="text-ink-3">–</span>}
                      </td>
                      <td className="px-2 py-2 pr-4"><LifecyclePill value={a.lifecycle} label={meta.data?.lifecycle[a.lifecycle]} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{rows.length} of {all.length} assets. Classification levels: 1 low, 2 medium, 3 high, 4 very high.</p>
      <AssetDialog open={creating} onOpenChange={setCreating} onSaved={(a) => openSheet("asset", a.id)} />
      <ImportWizard open={importing} onOpenChange={setImporting} defaultKind="assets" />
    </div>
  )
}

// --- dialog ---------------------------------------------------------------------------------------------

interface AssetForm {
  entity_id: number | null; external_id: string; site: string; name: string; asset_type: string; description: string
  owner_id: number | null; confidentiality: number | null; integrity: number | null; availability: number | null
  criticality: number | null; ot_zone: string; ot_conduit: string; supplier_id: number | null; lifecycle: string; location: string
  vendor_product: string; crypto_algorithms: string; key_management_owner: string; tags: string; notes: string
}

const emptyAsset = (): AssetForm => ({
  entity_id: null, external_id: "", site: "", name: "", asset_type: "IT", description: "", owner_id: null, confidentiality: null,
  integrity: null, availability: null, criticality: null, ot_zone: "", ot_conduit: "", supplier_id: null, lifecycle: "in_operation",
  location: "", vendor_product: "", crypto_algorithms: "", key_management_owner: "", tags: "", notes: "",
})

const assetToForm = (a: AssetRow): AssetForm => ({
  entity_id: a.entity_id, external_id: a.external_id ?? "", site: a.site ?? "", name: a.name, asset_type: a.asset_type,
  description: a.description ?? "", owner_id: a.owner_id, confidentiality: a.confidentiality, integrity: a.integrity,
  availability: a.availability, criticality: a.criticality, ot_zone: a.ot_zone ?? "", ot_conduit: a.ot_conduit ?? "",
  supplier_id: a.supplier_id, lifecycle: a.lifecycle, location: a.location ?? "", vendor_product: a.vendor_product ?? "",
  crypto_algorithms: a.crypto_algorithms ?? "", key_management_owner: a.key_management_owner ?? "", tags: a.tags.join(", "), notes: a.notes ?? "",
})

function LevelSelect({ value, onChange, labels }: { value: number | null; onChange: (v: number | null) => void; labels: Record<number, string> }) {
  return <OptionSelect value={value != null ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)} allowNone noneLabel="Not set"
    placeholder="Not set" options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} ${labels[n]}` }))} />
}

export function AssetDialog({ open, onOpenChange, asset, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; asset?: AssetRow; onSaved?: (a: AssetDetail) => void
}) {
  const qc = useQueryClient()
  const { canAny, canGlobal, me } = useAuth()
  const meta = useInventoryMeta()
  const suppliers = useSupplierOptions()
  const [f, setF] = useState<AssetForm>(emptyAsset)
  useEffect(() => {
    if (!open) return
    if (asset) setF(assetToForm(asset))
    else {
      const first = Object.keys(me?.entity_permissions ?? {}).find((k) => me?.entity_permissions[k]?.includes("assets.manage"))
      setF({ ...emptyAsset(), entity_id: canGlobal("assets.manage") ? null : first ? Number(first) : null })
    }
  }, [open, asset, canGlobal, me])
  const set = <K extends keyof AssetForm>(k: K, v: AssetForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const t = (s: string) => s.trim() || null
      const body = {
        entity_id: f.entity_id, external_id: t(f.external_id), site: t(f.site), name: f.name.trim(), asset_type: f.asset_type,
        description: t(f.description), owner_id: f.owner_id, confidentiality: f.confidentiality, integrity: f.integrity,
        availability: f.availability, criticality: f.criticality, ot_zone: t(f.ot_zone), ot_conduit: t(f.ot_conduit),
        supplier_id: f.supplier_id, lifecycle: f.lifecycle, location: t(f.location), vendor_product: t(f.vendor_product),
        crypto_algorithms: t(f.crypto_algorithms), key_management_owner: t(f.key_management_owner), tags: tagsFromText(f.tags), notes: t(f.notes),
      }
      return asset ? api.put<AssetDetail>(`/inventory/assets/${asset.id}`, body) : api.post<AssetDetail>("/inventory/assets", body)
    },
    onSuccess: (a) => {
      toast.success(asset ? `${a.code} saved` : `${a.code} created`)
      qc.invalidateQueries({ queryKey: ["inv"] })
      onOpenChange(false)
      onSaved?.(a)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{asset ? `Edit ${asset.code}` : "New asset"}</DialogTitle>
          <DialogDescription>Owner and classification are required for a complete inventory (IR 2024/2690 point 12.4).</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto scroll-thin pr-1">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Name" className="col-span-2" htmlFor="ast-name"><Input id="ast-name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
            <Field label="Type"><OptionSelect value={f.asset_type} onChange={(v) => v && set("asset_type", v)}
              options={Object.entries(meta.data?.asset_types ?? { IT: "IT system" }).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Entity"><ManagedEntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} /></Field>
            <Field label="Site" htmlFor="ast-site"><Input id="ast-site" value={f.site} onChange={(e) => set("site", e.target.value)} /></Field>
            <Field label="Location" htmlFor="ast-loc"><Input id="ast-loc" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Room, rack, region" /></Field>
            <Field label="Owner"><StakeholderSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} placeholder="Owner…" /></Field>
            <Field label="Lifecycle"><OptionSelect value={f.lifecycle} onChange={(v) => v && set("lifecycle", v)}
              options={Object.entries(meta.data?.lifecycle ?? { in_operation: "In operation" }).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="External ID" htmlFor="ast-ext" hint="CMDB or OT inventory ID"><Input id="ast-ext" value={f.external_id} onChange={(e) => set("external_id", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Confidentiality"><LevelSelect value={f.confidentiality} onChange={(v) => set("confidentiality", v)} labels={CIA_LABEL} /></Field>
            <Field label="Integrity"><LevelSelect value={f.integrity} onChange={(v) => set("integrity", v)} labels={CIA_LABEL} /></Field>
            <Field label="Availability"><LevelSelect value={f.availability} onChange={(v) => set("availability", v)} labels={CIA_LABEL} /></Field>
            <Field label="Criticality"><LevelSelect value={f.criticality} onChange={(v) => set("criticality", v)} labels={CRIT_LABEL} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="OT zone" htmlFor="ast-zone" hint="IEC 62443 zone"><Input id="ast-zone" value={f.ot_zone} onChange={(e) => set("ot_zone", e.target.value)} /></Field>
            <Field label="OT conduit" htmlFor="ast-conduit" hint="IEC 62443 conduit(s)"><Input id="ast-conduit" value={f.ot_conduit} onChange={(e) => set("ot_conduit", e.target.value)} /></Field>
            {canAny("suppliers.read") && (
              <Field label="Supplier" hint="Maintenance or service provider">
                <Combo value={f.supplier_id} onChange={(v) => set("supplier_id", v)} placeholder="No supplier"
                  items={(suppliers.data ?? []).filter((s) => s.status !== "offboarded" || s.id === f.supplier_id).map((s) => ({ value: s.id, label: s.name, hint: s.code }))} />
              </Field>
            )}
            <Field label="Vendor and product" htmlFor="ast-vendor"><Input id="ast-vendor" value={f.vendor_product} onChange={(e) => set("vendor_product", e.target.value)} placeholder="Manufacturer, product, version" /></Field>
          </div>
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-[12.5px] font-medium text-ink-2">Cryptography (optional)</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Algorithms" htmlFor="ast-crypto"><Input id="ast-crypto" value={f.crypto_algorithms} onChange={(e) => set("crypto_algorithms", e.target.value)} placeholder="e.g. AES-256 at rest, TLS 1.3" /></Field>
              <Field label="Key management owner" htmlFor="ast-kmo"><Input id="ast-kmo" value={f.key_management_owner} onChange={(e) => set("key_management_owner", e.target.value)} /></Field>
            </div>
          </fieldset>
          <Field label="Description" htmlFor="ast-desc"><Textarea id="ast-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tags" hint="Comma separated" htmlFor="ast-tags"><Input id="ast-tags" value={f.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
            <Field label="Notes" htmlFor="ast-notes"><Input id="ast-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{asset ? "Save changes" : "Create asset"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- sheet ----------------------------------------------------------------------------------------------

export function AssetSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[680px]">
        {id != null && <AssetBody key={id} id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function AssetBody({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const services = useServices()
  const q = useQuery({ queryKey: ["inv", "asset", id], queryFn: () => api.get<AssetDetail>(`/inventory/assets/${id}`) })
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [svcIds, setSvcIds] = useState<number[]>([])
  useEffect(() => { if (q.data) setSvcIds(q.data.service_ids) }, [q.data])
  const del = useMutation({
    mutationFn: () => api.del(`/inventory/assets/${id}`),
    onSuccess: () => { toast.success("Asset deleted"); qc.invalidateQueries({ queryKey: ["inv"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveLinks = useMutation({
    mutationFn: () => api.put(`/inventory/assets/${id}/services`, { service_ids: svcIds }),
    onSuccess: () => { toast.success("Services updated"); setLinking(false); qc.invalidateQueries({ queryKey: ["inv"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.isLoading) return <><SheetHeader className="sr-only"><SheetTitle>Asset</SheetTitle></SheetHeader><Loading /></>
  if (q.error || !q.data) return <div className="p-5"><SheetHeader className="p-0"><SheetTitle>Asset</SheetTitle></SheetHeader><ErrorState error={q.error ?? "Not found"} className="mt-3" /></div>
  const a = q.data
  const refresh = () => qc.invalidateQueries({ queryKey: ["inv"] })
  const svcItems = (services.data ?? []).filter((s) => s.can_edit || svcIds.includes(s.id))
    .map((s) => ({ value: s.id, label: `${s.code} ${s.name}`, hint: s.entity?.code ?? "Group" }))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <Code className="text-[13px] font-medium text-ink">{a.code}</Code>
          {a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <Pill tone="outline">Group-wide</Pill>}
          <Pill tone="neutral">{meta.data?.asset_types[a.asset_type] ?? a.asset_type}</Pill>
          <LifecyclePill value={a.lifecycle} label={meta.data?.lifecycle[a.lifecycle]} />
          {a.criticality != null && <CritPill value={a.criticality} />}
        </div>
        <SheetTitle className="text-[16px] leading-snug">{a.name}</SheetTitle>
        <SheetDescription className="text-[12.5px]">Updated {fromNow(a.updated_at)}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scroll-thin px-5 py-4">
        <section className="rounded-md border bg-surface px-3 py-1">
          <KV label="Description">{a.description}</KV>
          <KV label="Owner">{a.owner?.name ?? <span className="text-alarm">No owner</span>}</KV>
          <KV label="Classification">
            <span className="flex items-center gap-2"><CiaCells c={a.confidentiality} i={a.integrity} a={a.availability} />
              <span className="text-[12.5px] text-ink-2">C {a.confidentiality ? CIA_LABEL[a.confidentiality] : "not set"}, I {a.integrity ? CIA_LABEL[a.integrity] : "not set"}, A {a.availability ? CIA_LABEL[a.availability] : "not set"}</span></span>
          </KV>
          <KV label="Site and location">{[a.site, a.location].filter(Boolean).join(", ") || null}</KV>
          <KV label="External ID">{a.external_id ? <Code>{a.external_id}</Code> : null}</KV>
          <KV label="Vendor and product">{a.vendor_product}</KV>
          <KV label="Supplier">{a.supplier ? <SupplierRef s={a.supplier} className="hover:text-petrol" /> : null}</KV>
          {(a.asset_type === "OT" || a.ot_zone || a.ot_conduit) && <>
            <KV label="OT zone">{a.ot_zone ?? <span className="text-amber">Not assigned</span>}</KV>
            <KV label="OT conduit">{a.ot_conduit}</KV>
          </>}
          <KV label="Tags">{a.tags.length ? a.tags.join(", ") : null}</KV>
          <KV label="Notes">{a.notes}</KV>
        </section>
        {(a.crypto_algorithms || a.key_management_owner) && (
          <SheetSection title="Cryptography">
            <div className="rounded-md border bg-surface px-3 py-1">
              <KV label="Algorithms">{a.crypto_algorithms}</KV>
              <KV label="Key management owner">{a.key_management_owner}</KV>
            </div>
          </SheetSection>
        )}
        <SheetSection title="Supports services" actions={a.can_edit && !linking && <Button size="xs" variant="outline" onClick={() => setLinking(true)}><Pencil /> Edit services</Button>}>
          {linking ? (
            <div className="space-y-3 rounded-md border bg-surface p-3">
              <MultiCombo value={svcIds} onChange={setSvcIds} items={svcItems} placeholder="Add service…" emptyText="Not linked to any service." />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => { setLinking(false); setSvcIds(a.service_ids) }}>Cancel</Button>
                <Button size="sm" disabled={saveLinks.isPending} onClick={() => saveLinks.mutate()}>Save services</Button>
              </div>
            </div>
          ) : a.services.length === 0 ? <p className="text-[13px] text-ink-3">Not linked to any service.</p> : (
            <ul className="space-y-1">
              {a.services.map((s) => (
                <li key={s.id}>
                  <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("service", s.id)}>
                    <Code>{s.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                    {s.entity && <EntityTag code={s.entity.code} />}<CritPill value={s.criticality} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
        <SheetSection title="Exercises and restore tests">
          {a.exercises.length === 0 ? <p className="text-[13px] text-ink-3">This asset was not part of an exercise yet.</p> : (
            <ul className="space-y-1">
              {a.exercises.map((e) => (
                <li key={e.id}>
                  <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("exercise", e.id)}>
                    <Code>{e.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
                    <span className="tabular text-[12px] text-ink-3">{fmtDate(e.exercise_date)}</span><ResultPill result={e.result} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
        <SheetSection title="Documents">
          <DocumentLinks targetType="asset" targetId={a.id} documents={a.documents} entityId={a.entity_id} canEdit={a.can_edit} onChange={refresh} />
        </SheetSection>
        <SheetSection title="Discussion"><CommentsPanel targetType="asset" targetId={a.id} canComment={a.can_edit} /></SheetSection>
        <SheetSection title="Change history"><HistoryList events={a.history} /></SheetSection>
      </div>
      {a.can_edit && (
        <div className="flex items-center gap-2 border-t bg-card px-5 py-3">
          <Confirm title={`Delete ${a.code}?`} description="Consider setting the lifecycle to retired instead; deleting removes the asset, its dependencies, comments and document links."
            confirmLabel="Delete asset" onConfirm={() => del.mutate()}
            trigger={<Button variant="ghost" className="text-alarm hover:bg-alarm-50 hover:text-alarm" disabled={del.isPending}><Trash2 /> Delete</Button>} />
          <Button className="ml-auto" onClick={() => setEditing(true)}><Pencil /> Edit asset</Button>
        </div>
      )}
      <AssetDialog open={editing} onOpenChange={setEditing} asset={a} />
    </div>
  )
}
