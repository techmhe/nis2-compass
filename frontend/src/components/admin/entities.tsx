import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Loading, Pill } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { LegalFormSelect } from "@/components/common/legal-form-select"
import { useAuth } from "@/hooks/useAuth"
import { useEntities, useEntityOptions } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { NIS2_CLASS } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import type { Entity } from "@/lib/types"
import { DataTable, TD, TH } from "./common"

const REG_STATUS: Record<string, string> = { not_registered: "Not registered", submitted: "Submitted", confirmed: "Confirmed" }

const SIZE_CLASS: Record<string, string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" }

type EntityIn = Omit<Entity, "id">

const EMPTY: EntityIn = {
  code: "", name: "", finding_prefix: "", country: null, is_headquarters: false, legal_form: null, size_class: null, activity_sector: null, nis2_classification: "tbd",
  competent_authority: null, csirt: null, registration_status: "not_registered", registration_date: null, registration_reference: null,
  employees: null, annual_turnover_meur: null, address: null, contact_name: null, contact_email: null, notes: null, sort_order: 0, is_active: true,
}

export function EntitiesSection() {
  const { can, canGlobal } = useAuth()
  const entities = useEntities()
  const sectors = useEntityOptions().data?.sectors
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Entity | "new" | null>(null)
  const del = useMutation({
    mutationFn: (e: Entity) => api.del(`/entities/${e.id}`),
    onSuccess: (_r, e) => { toast.success(`${e.name} deleted`); qc.invalidateQueries({ queryKey: ["entities"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const canCreate = canGlobal("entities.manage")

  return (
    <div>
      {canCreate && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing("new")}><Plus /> Create entity</Button>
        </div>
      )}
      {entities.isLoading ? <Loading /> : entities.error ? <ErrorState error={entities.error} /> : !entities.data?.length ? (
        <Empty title="No entities yet">Create the legal entities of the group; each gets its own assessment in every open round.</Empty>
      ) : (
        <DataTable minWidth={980}>
          <thead>
            <tr className="border-b">
              <th className={TH}>Entity</th>
              <th className={TH}>Country</th>
              <th className={TH}>NIS-2 classification</th>
              <th className={TH}>Authority and CSIRT</th>
              <th className={TH}>Registration</th>
              <th className={TH}>Finding prefix</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {entities.data.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <Code>{e.code}</Code>
                    <Link to={`/entities/${e.id}`} className="font-medium text-ink hover:text-petrol">{e.name}</Link>
                    {e.is_headquarters && <Pill tone="neutral">HQ</Pill>}
                    {!e.is_active && <Pill tone="outline">Inactive</Pill>}
                  </div>
                  {e.activity_sector && <div className="text-[12px] text-ink-3">{sectors?.find((x) => x.key === e.activity_sector)?.label ?? e.activity_sector}</div>}
                </td>
                <td className={`${TD} text-ink-2`}>{e.country ?? "–"}</td>
                <td className={TD}>
                  {e.nis2_classification ? (
                    <Pill tone={e.nis2_classification === "tbd" ? "amber" : e.nis2_classification === "not_in_scope" ? "outline" : "petrol"}>
                      {NIS2_CLASS[e.nis2_classification] ?? e.nis2_classification}
                    </Pill>
                  ) : "–"}
                </td>
                <td className={`${TD} text-[12.5px] text-ink-2`}>
                  <div>{e.competent_authority ?? <span className="text-ink-3">No authority set</span>}</div>
                  {e.csirt && <div className="text-ink-3">CSIRT: {e.csirt}</div>}
                </td>
                <td className={`${TD} text-[12.5px]`}>
                  <span className={e.registration_status === "confirmed" ? "text-petrol" : e.registration_status === "submitted" ? "text-ink-2" : "text-amber"}>
                    {REG_STATUS[e.registration_status ?? ""] ?? "–"}
                  </span>
                  {e.registration_date && <div className="text-ink-3">{fmtDate(e.registration_date)}</div>}
                </td>
                <td className={TD}><Code>{e.finding_prefix}</Code></td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  {can("entities.manage", e.id) && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}><Pencil /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {editing && (
        <EntityDialog entity={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          canDelete={canCreate} onDelete={(e) => { del.mutate(e); setEditing(null) }} />
      )}
    </div>
  )
}

function EntityDialog({ entity, onClose, canDelete, onDelete }: { entity: Entity | null; onClose: () => void; canDelete: boolean; onDelete: (e: Entity) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<EntityIn>(() => {
    if (!entity) return EMPTY
    const { id: _id, ...rest } = entity
    void _id
    return rest
  })
  const [error, setError] = useState<string | null>(null)
  const options = useEntityOptions().data
  const set = <K extends keyof EntityIn>(k: K, v: EntityIn[K]) => setF((s) => ({ ...s, [k]: v }))
  const str = (v: string) => v.trim() || null
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        code: f.code.trim(), name: f.name.trim(), finding_prefix: f.finding_prefix.trim(),
        legal_form: f.legal_form?.trim() || null,
      }
      return entity ? api.put<Entity>(`/entities/${entity.id}`, body) : api.post<Entity>("/entities", body)
    },
    onMutate: () => setError(null),
    onSuccess: (e) => { toast.success(entity ? "Entity saved" : `${e.name} created with an assessment in every open round`); qc.invalidateQueries({ queryKey: ["entities"] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  const text = (k: keyof EntityIn, label: string, opts: { hint?: string; className?: string; placeholder?: string; type?: string } = {}) => (
    <Field label={label} htmlFor={`ent-${k}`} hint={opts.hint} className={opts.className}>
      <Input id={`ent-${k}`} type={opts.type} value={(f[k] as string | number | null) ?? ""} placeholder={opts.placeholder}
        onChange={(e) => set(k, (opts.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value) as never)} />
    </Field>
  )

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entity ? `Edit ${entity.name}` : "Create entity"}</DialogTitle>
          <DialogDescription>
            {entity ? "Changing the finding prefix renumbers the finding IDs of this entity." : "The new entity gets an assessment with all active requirements in every open round."}
          </DialogDescription>
        </DialogHeader>
        <form id="entity-form" className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Code" htmlFor="ent-code" hint="Short identifier, e.g. ATN">
            <Input id="ent-code" className="font-mono" value={f.code} onChange={(e) => set("code", e.target.value)} required pattern="^[A-Za-z0-9_\-]+$" maxLength={20} />
          </Field>
          <Field label="Name" htmlFor="ent-name" className="sm:col-span-2">
            <Input id="ent-name" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Finding prefix" htmlFor="ent-prefix" hint="Used for finding IDs such as ATN-3.2.1">
            <Input id="ent-prefix" className="font-mono" value={f.finding_prefix} onChange={(e) => set("finding_prefix", e.target.value)} required maxLength={20} />
          </Field>
          <Field label="Country">
            <OptionSelect value={f.country} onChange={(v) => set("country", v)} allowNone noneLabel="Not set"
              options={(options?.jurisdictions ?? []).map((j) => ({ value: j.code, label: j.name }))} />
          </Field>
          <Field label="Legal form" htmlFor="ent-legal_form">
            <LegalFormSelect id="ent-legal_form" allowNone country={f.country} value={f.legal_form}
              forms={options?.jurisdictions.find((j) => j.code === f.country)?.legal_forms ?? []}
              onChange={(v) => set("legal_form", v)} />
          </Field>
          <Field label="Size class">
            <OptionSelect value={f.size_class} onChange={(v) => set("size_class", v)} allowNone noneLabel="Not set"
              options={Object.entries(SIZE_CLASS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Sector" className="sm:col-span-2">
            <OptionSelect value={f.activity_sector} onChange={(v) => set("activity_sector", v)} allowNone noneLabel="Not set"
              options={(options?.sectors ?? []).map((x) => ({ value: x.key, label: x.label }))} />
          </Field>
          <Field label="NIS-2 classification">
            <OptionSelect value={f.nis2_classification} onChange={(v) => set("nis2_classification", v)} allowNone noneLabel="Not set"
              options={Object.entries(NIS2_CLASS).map(([value, label]) => ({ value, label }))} />
          </Field>
          {text("competent_authority", "Competent authority", { placeholder: "e.g. BSI" })}
          {text("csirt", "CSIRT", { placeholder: "e.g. CERT-Bund, NCSC" })}
          <Field label="Registration status">
            <OptionSelect value={f.registration_status} onChange={(v) => set("registration_status", v)} allowNone noneLabel="Not set"
              options={Object.entries(REG_STATUS).map(([value, label]) => ({ value, label }))} />
          </Field>
          {text("registration_date", "Registration date", { type: "date" })}
          {text("registration_reference", "Registration reference")}
          {text("employees", "Employees", { type: "number" })}
          {text("annual_turnover_meur", "Annual turnover (million EUR)", { type: "number" })}
          {text("sort_order", "Sort order", { type: "number" })}
          {text("contact_name", "Contact person")}
          {text("contact_email", "Contact e-mail", { type: "email" })}
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={f.is_headquarters} onCheckedChange={(v) => set("is_headquarters", v)} /> Headquarters</label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} /> Active</label>
          </div>
          <Field label="Address" htmlFor="ent-address" className="sm:col-span-3">
            <Input id="ent-address" value={f.address ?? ""} onChange={(e) => set("address", str(e.target.value))} />
          </Field>
          <Field label="Notes" htmlFor="ent-notes" className="sm:col-span-3">
            <Textarea id="ent-notes" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
          </Field>
          {error && <ErrorState className="sm:col-span-3" error={error} />}
        </form>
        <DialogFooter className="sm:justify-between">
          {entity && canDelete ? (
            <Confirm title={`Delete ${entity.name}?`}
              description="This permanently deletes the entity together with all its assessments, answers and action plan items. Consider setting it inactive instead."
              confirmLabel="Delete entity" onConfirm={() => onDelete(entity)}
              trigger={<Button variant="ghost" className="text-alarm">Delete entity</Button>} />
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="entity-form" disabled={save.isPending || !f.code.trim() || !f.name.trim() || !f.finding_prefix.trim()}>
              {save.isPending ? "Saving…" : entity ? "Save changes" : "Create entity"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
