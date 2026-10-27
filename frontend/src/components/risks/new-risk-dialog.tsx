import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/common/basics"
import { Combo, EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { useCanManageRisk, useRiskMeta, useThreats, type RiskDetail } from "./shared"

export interface RiskDraft {
  entity_id: number | null
  title: string
  scenario: string
  existing_controls?: string | null
  threat_id?: number | null
  category?: string | null
}

/** Create a risk; with `sourceAnswerId` the gap (assessment answer) is linked to the new risk, with
 * `sourceIncidentId` the incident is linked as an affected object. */
export function NewRiskDialog({ open, onOpenChange, draft, sourceAnswerId, sourceIncidentId, lockEntity, onCreated, title = "New risk", description }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  draft?: Partial<RiskDraft>
  sourceAnswerId?: number
  sourceIncidentId?: number
  lockEntity?: boolean
  onCreated?: (d: RiskDetail) => void
  title?: string
  description?: string
}) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const canManage = useCanManageRisk()
  const meta = useRiskMeta()
  const threats = useThreats()
  const [form, setForm] = useState<RiskDraft & { owner_user_id: number | null }>({ entity_id: null, title: "", scenario: "", owner_user_id: null })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({ entity_id: draft?.entity_id ?? null, title: draft?.title ?? "", scenario: draft?.scenario ?? "",
        existing_controls: draft?.existing_controls ?? null, threat_id: draft?.threat_id ?? null,
        category: draft?.category ?? null, owner_user_id: me?.id ?? null })
      setError(null)
    }
    // reset only when the dialog opens; the draft is read at that moment
  }, [open])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const create = useMutation({
    mutationFn: () => api.post<RiskDetail>("/risks", {
      entity_id: form.entity_id, title: form.title.trim(), scenario: form.scenario.trim() || null,
      existing_controls: form.existing_controls?.trim() || null, threat_id: form.threat_id ?? null,
      category: form.category ?? null, owner_user_id: form.owner_user_id, source_answer_id: sourceAnswerId ?? null, source_incident_id: sourceIncidentId ?? null,
    }),
    onMutate: () => setError(null),
    onSuccess: (d) => {
      toast.success(`${d.risk.code} created`)
      qc.invalidateQueries({ queryKey: ["risks"] })
      onOpenChange(false)
      onCreated?.(d)
    },
    onError: (e: Error) => setError(e.message),
  })
  const allowed = canManage(form.entity_id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "Describe the scenario first. You rate likelihood and impact and plan the treatment on the risk page."}</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (form.title.trim() && allowed) create.mutate() }}>
          <Field label="Title" className="col-span-2" htmlFor="risk-title">
            <Input id="risk-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={400} required autoFocus
              placeholder="e.g. Ransomware stops production planning" />
          </Field>
          <Field label="Scenario" className="col-span-2" htmlFor="risk-scenario" hint="Threat, vulnerability and consequence: what happens, how, and what is the damage?">
            <Textarea id="risk-scenario" rows={5} value={form.scenario} onChange={(e) => set("scenario", e.target.value)} />
          </Field>
          <Field label="Entity">
            <EntitySelect value={form.entity_id} onChange={(v) => set("entity_id", v)} disabled={lockEntity} groupLabel="Group-wide risk" />
          </Field>
          <Field label="Owner">
            <UserSelect value={form.owner_user_id} onChange={(v) => set("owner_user_id", v)} placeholder="Risk owner…" />
          </Field>
          <Field label="Threat">
            <Combo value={form.threat_id ?? null} onChange={(v) => set("threat_id", v)} placeholder="Choose from the catalogue…" searchPlaceholder="Search code or title"
              items={(threats.data ?? []).map((t) => ({ value: t.id, label: `${t.code} ${t.title}`, hint: t.category === "Industrial control systems" ? "OT" : undefined }))} />
          </Field>
          <Field label="Category">
            <OptionSelect value={form.category ?? null} onChange={(v) => set("category", v)} allowNone noneLabel="No category" placeholder="Category…"
              options={meta.data?.categories ?? []} />
          </Field>
          {form.existing_controls != null && (
            <Field label="Existing controls" className="col-span-2" htmlFor="risk-controls">
              <Textarea id="risk-controls" rows={3} value={form.existing_controls ?? ""} onChange={(e) => set("existing_controls", e.target.value)} />
            </Field>
          )}
          {!allowed && (
            <p className="col-span-2 text-[12.5px] text-amber">
              {form.entity_id == null ? "Only users with group-wide risk permissions can create group-wide risks. Choose an entity." : "You cannot manage risks of this entity."}
            </p>
          )}
          {error && <ErrorState className="col-span-2" error={error} />}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!form.title.trim() || !allowed || create.isPending}>{create.isPending ? "Creating…" : "Create risk"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
