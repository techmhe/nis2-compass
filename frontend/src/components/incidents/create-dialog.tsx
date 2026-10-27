import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/common/basics"
import { Field, OptionSelect, Segmented } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { INCIDENT_SEVERITY } from "@/lib/constants"
import type { Incident } from "@/lib/types"
import { CATEGORIES, fromLocalInput, toLocalInput } from "./shared"

export function CreateIncidentDialog({ trigger, onCreated }: { trigger: ReactNode; onCreated: (i: Incident) => void }) {
  const { can } = useAuth()
  const entities = useEntities()
  const groupAllowed = can("incidents.manage")
  const allowedEntities = (entities.data ?? []).filter((e) => can("incidents.manage", e.id))
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [entityId, setEntityId] = useState<string | null>(null)
  const [severity, setSeverity] = useState("Medium")
  const [category, setCategory] = useState("")
  const [description, setDescription] = useState("")
  const [detected, setDetected] = useState("")
  const [aware, setAware] = useState("")
  const [significant, setSignificant] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const reset = () => {
    const now = toLocalInput(new Date().toISOString())
    setTitle(""); setSeverity("Medium"); setCategory(""); setDescription(""); setDetected(now); setAware(now); setSignificant(null); setError(null)
    setEntityId(groupAllowed ? null : allowedEntities[0] ? String(allowedEntities[0].id) : null)
  }

  const create = useMutation({
    mutationFn: () => api.post<Incident>("/incidents", {
      title: title.trim(),
      entity_id: entityId ? Number(entityId) : null,
      severity,
      status: "Open",
      category: category.trim() || null,
      description: description.trim() || null,
      detected_at: fromLocalInput(detected),
      aware_at: fromLocalInput(aware),
      is_significant: significant === "Yes" ? true : significant === "No" ? false : null,
    }),
    onMutate: () => setError(null),
    onSuccess: (i) => {
      toast.success(`${i.code} recorded`)
      qc.invalidateQueries({ queryKey: ["incidents"] })
      setOpen(false)
      onCreated(i)
    },
    onError: (e: Error) => setError(e.message),
  })

  const entityOk = entityId != null || groupAllowed
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Record incident</DialogTitle>
          <DialogDescription>
            Record the incident as soon as you know about it. If it is significant, the NIS-2 reporting clock starts at the time you became aware of it.
          </DialogDescription>
        </DialogHeader>
        <form id="create-incident" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <Field label="Title" className="col-span-2" htmlFor="inc-title">
            <Input id="inc-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ransomware on file server" required maxLength={400} />
          </Field>
          <Field label="Entity">
            <OptionSelect value={entityId} onChange={setEntityId} allowNone={groupAllowed} noneLabel="Group-wide" placeholder="Choose entity…"
              options={(groupAllowed ? entities.data ?? [] : allowedEntities).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
          </Field>
          <Field label="Severity">
            <OptionSelect value={severity} onChange={(v) => setSeverity(v ?? "Medium")} options={INCIDENT_SEVERITY} />
          </Field>
          <Field label="Category" htmlFor="inc-cat">
            <Input id="inc-cat" list="incident-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Phishing" />
            <datalist id="incident-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Significant (Art. 23(3) NIS-2)" hint="Leave open if not yet assessed">
            <div><Segmented value={significant} onChange={setSignificant} options={["Yes", "No"]} /></div>
          </Field>
          <Field label="Detected at" htmlFor="inc-detected">
            <Input id="inc-detected" type="datetime-local" value={detected} onChange={(e) => setDetected(e.target.value)} />
          </Field>
          <Field label="Became aware at" htmlFor="inc-aware" hint="Starts the 24 h and 72 h deadlines">
            <Input id="inc-aware" type="datetime-local" value={aware} onChange={(e) => setAware(e.target.value)} />
          </Field>
          <Field label="What happened" className="col-span-2" htmlFor="inc-desc">
            <Textarea id="inc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Affected systems and services, first observations" />
          </Field>
          {error && <ErrorState className="col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" form="create-incident" disabled={!title.trim() || !entityOk || create.isPending}>
            {create.isPending ? "Recording…" : "Record incident"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
