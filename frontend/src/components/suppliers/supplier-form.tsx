import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/common/basics"
import { Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { type Contact, type SupplierDetail, type Tier, TIER_ORDER, TierPill, useSupplierMeta } from "./shared"

interface FormState {
  name: string
  legal_name: string
  country: string
  website: string
  category: string
  access_type: string
  entity_ids: number[]
  services_products: string
  relationship_owner_id: number | null
  contacts: Contact[]
  contract_reference: string
  contract_end: string
  tier_overridden: boolean
  tier: Tier | null
  tier_rationale: string
  status: string
  notes: string
  description: string
}

function initial(s?: SupplierDetail): FormState {
  return {
    name: s?.name ?? "", legal_name: s?.legal_name ?? "", country: s?.country ?? "", website: s?.website ?? "",
    category: s?.category ?? "", access_type: s?.access_type ?? "none", entity_ids: s?.entity_ids ?? [],
    services_products: s?.services_products ?? "", relationship_owner_id: s?.relationship_owner_id ?? null,
    contacts: s?.contacts?.length ? s.contacts : [], contract_reference: s?.contract_reference ?? "",
    contract_end: s?.contract_end ?? "", tier_overridden: s?.tier_overridden ?? false,
    tier: s?.tier_overridden ? s.tier : null, tier_rationale: s?.tier_rationale ?? "", status: s?.status ?? "active",
    notes: s?.notes ?? "", description: s?.description ?? "",
  }
}

const blank = (v: string) => (v.trim() ? v.trim() : null)

export function SupplierFormDialog({ trigger, supplier, onSaved }: {
  trigger: ReactNode
  supplier?: SupplierDetail
  onSaved?: (s: SupplierDetail) => void
}) {
  const meta = useSupplierMeta()
  const { can, canGlobal } = useAuth()
  const entities = useEntities()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<FormState>(() => initial(supplier))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))
  const global = canGlobal("suppliers.manage")
  const original = new Set(supplier?.entity_ids ?? [])
  const editableEntity = (id: number) => global || can("suppliers.manage", id)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), legal_name: blank(f.legal_name), country: blank(f.country)?.toUpperCase() ?? null,
        website: blank(f.website), category: blank(f.category), access_type: f.access_type, entity_ids: f.entity_ids,
        services_products: blank(f.services_products), relationship_owner_id: f.relationship_owner_id,
        contacts: f.contacts.map((c) => ({ name: c.name?.trim() || null, role: c.role?.trim() || null, email: c.email?.trim() || null, phone: c.phone?.trim() || null }))
          .filter((c) => c.name || c.role || c.email || c.phone),
        contract_reference: blank(f.contract_reference), contract_end: f.contract_end || null,
        tier_overridden: f.tier_overridden, tier: f.tier_overridden ? f.tier : null,
        tier_rationale: f.tier_overridden ? blank(f.tier_rationale) : null, status: f.status, notes: blank(f.notes),
        description: blank(f.description),
      }
      return supplier ? api.put<SupplierDetail>(`/suppliers/${supplier.id}`, body) : api.post<SupplierDetail>("/suppliers", body)
    },
    onMutate: () => setError(null),
    onSuccess: (s) => {
      toast.success(supplier ? "Supplier saved" : `${s.code} created`)
      qc.invalidateQueries({ queryKey: ["suppliers"] })
      setOpen(false)
      onSaved?.(s)
    },
    onError: (e: Error) => setError(e.message),
  })

  const setContact = (i: number, k: keyof Contact, v: string) =>
    set("contacts", f.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

  const valid = f.name.trim() && (!f.tier_overridden || f.tier) && (global || f.entity_ids.length > 0)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setF(initial(supplier)); setError(null) } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.code}` : "Add supplier"}</DialogTitle>
          <DialogDescription>
            Record direct suppliers and service providers with their contact points and the ICT products and services they supply (IR 2024/2690 point 5.2).
          </DialogDescription>
        </DialogHeader>
        <form id="supplier-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }}>
          <Field label="Name" htmlFor="sup-name"><Input id="sup-name" autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={300} /></Field>
          <Field label="Legal entity name" htmlFor="sup-legal"><Input id="sup-legal" value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)} maxLength={300} /></Field>
          <div className="grid grid-cols-[90px_1fr] gap-3">
            <Field label="Country" htmlFor="sup-country" hint="ISO code"><Input id="sup-country" value={f.country} onChange={(e) => set("country", e.target.value.slice(0, 2))} placeholder="DE" /></Field>
            <Field label="Category" htmlFor="sup-cat"><Input id="sup-cat" list="sup-cat-options" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Managed service provider" maxLength={100} />
              <datalist id="sup-cat-options">
                {["Intra-group IT service", "Managed service provider", "Cloud service (SaaS)", "OT maintenance", "Telecommunications", "Software vendor", "Hosting / data centre", "Security service provider"].map((c) => <option key={c} value={c} />)}
              </datalist></Field>
          </div>
          <Field label="Website" htmlFor="sup-web"><Input id="sup-web" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" maxLength={300} /></Field>
          <Field label="Access to our systems">
            <OptionSelect value={f.access_type} onChange={(v) => set("access_type", v ?? "none")}
              options={Object.entries(meta.access_types).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={(v) => set("status", v ?? "active")}
              options={Object.entries(meta.statuses).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Using entities" className="col-span-2" hint={global ? "Leave empty for a supplier used group-wide." : "You can only add or remove entities you manage suppliers for."}>
            <div className="flex flex-wrap gap-2">
              {(entities.data ?? []).map((e) => {
                const checked = f.entity_ids.includes(e.id)
                const disabled = !editableEntity(e.id) && (checked ? original.has(e.id) : true)
                return (
                  <label key={e.id} className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] has-[:disabled]:opacity-60">
                    <Checkbox checked={checked} disabled={disabled}
                      onCheckedChange={(v) => set("entity_ids", v ? [...f.entity_ids, e.id] : f.entity_ids.filter((x) => x !== e.id))} />
                    <span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}
                  </label>
                )
              })}
            </div>
          </Field>
          <Field label="ICT products and services supplied" className="col-span-2" htmlFor="sup-products">
            <Textarea id="sup-products" rows={2} value={f.services_products} onChange={(e) => set("services_products", e.target.value)} />
          </Field>
          <Field label="Relationship owner"><StakeholderSelect value={f.relationship_owner_id} onChange={(v) => set("relationship_owner_id", v)} placeholder="Choose owner…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract reference" htmlFor="sup-cref"><Input id="sup-cref" value={f.contract_reference} onChange={(e) => set("contract_reference", e.target.value)} maxLength={200} /></Field>
            <Field label="Contract end" htmlFor="sup-cend"><Input id="sup-cend" type="date" value={f.contract_end} onChange={(e) => set("contract_end", e.target.value)} /></Field>
          </div>

          <div className="col-span-2 space-y-2 rounded-md border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch id="sup-override" checked={f.tier_overridden} onCheckedChange={(v) => { set("tier_overridden", v); if (v && !f.tier) set("tier", supplier?.suggested_tier ?? "standard") }} />
                <Label htmlFor="sup-override" className="text-[13px] font-normal text-ink-2">Override the suggested tier</Label>
              </div>
              {supplier && (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3">Suggested <TierPill tier={supplier.suggested_tier} /></span>
              )}
            </div>
            <p className="text-[12px] text-ink-3">
              {supplier ? supplier.tier_reason : "The tier is suggested from the access type and the criticality of the services that depend on the supplier."} The tier sets the review cycle ({TIER_ORDER.map((t) => `${meta.tiers[t].toLowerCase()} ${meta.review_months[t]} months`).join(", ")}).
            </p>
            {f.tier_overridden && (
              <div className="grid grid-cols-[180px_1fr] gap-3">
                <Field label="Tier">
                  <OptionSelect value={f.tier} onChange={(v) => set("tier", v as Tier | null)} options={TIER_ORDER.map((t) => ({ value: t, label: meta.tiers[t] }))} />
                </Field>
                <Field label="Rationale" htmlFor="sup-rationale"><Input id="sup-rationale" value={f.tier_rationale} onChange={(e) => set("tier_rationale", e.target.value)} placeholder="Why the suggestion does not fit" /></Field>
              </div>
            )}
          </div>

          <div className="col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[12.5px] font-medium text-ink-2">Contact points</Label>
              <Button type="button" size="xs" variant="outline" onClick={() => set("contacts", [...f.contacts, { name: "", role: "", email: "", phone: "" }])}><Plus /> Add contact</Button>
            </div>
            {f.contacts.length === 0 && <p className="text-[12.5px] text-ink-3">No contacts yet. Add at least the security or incident contact.</p>}
            {f.contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_140px_auto] gap-2">
                <Input aria-label="Contact name" placeholder="Name" value={c.name ?? ""} onChange={(e) => setContact(i, "name", e.target.value)} />
                <Input aria-label="Contact role" placeholder="Role" value={c.role ?? ""} onChange={(e) => setContact(i, "role", e.target.value)} />
                <Input aria-label="Contact e-mail" placeholder="E-mail" type="email" value={c.email ?? ""} onChange={(e) => setContact(i, "email", e.target.value)} />
                <Input aria-label="Contact phone" placeholder="Phone" value={c.phone ?? ""} onChange={(e) => setContact(i, "phone", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove contact" onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
          </div>

          <Field label="Description" className="col-span-2" htmlFor="sup-desc"><Textarea id="sup-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Notes" className="col-span-2" htmlFor="sup-notes"><Textarea id="sup-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </form>
        {error && <ErrorState error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" form="supplier-form" disabled={!valid || save.isPending}>
            {save.isPending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
