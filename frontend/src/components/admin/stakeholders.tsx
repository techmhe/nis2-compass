import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EntityTag, Empty, ErrorState, Loading, Pill } from "@/components/common/basics"
import { Confirm, UserAvatar } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useEntities, useStakeholders, useUsers } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import type { Stakeholder } from "@/lib/types"
import { DataTable, TD, TH } from "./common"

const KIND_LABEL: Record<string, string> = { role: "Role", person: "Person", external: "External" }
type StakeholderIn = Omit<Stakeholder, "id">

export function StakeholdersSection() {
  const stakeholders = useStakeholders()
  const users = useUsers()
  const entities = useEntities()
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<Stakeholder | "new" | null>(null)
  const userById = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u])), [users.data])
  const entityById = useMemo(() => new Map((entities.data ?? []).map((e) => [e.id, e])), [entities.data])
  const rows = (stakeholders.data ?? []).filter((s) => {
    const n = q.trim().toLowerCase()
    return !n || `${s.name} ${s.description ?? ""} ${s.email ?? ""}`.toLowerCase().includes(n)
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stakeholders" className="pl-8" aria-label="Search stakeholders" />
        </div>
        <Button className="ml-auto" onClick={() => setEditing("new")}><Plus /> Create stakeholder</Button>
      </div>
      {stakeholders.isLoading ? <Loading /> : stakeholders.error ? <ErrorState error={stakeholders.error} /> : rows.length === 0 ? (
        <Empty title={q ? "No stakeholder matches" : "No stakeholders yet"}>Stakeholders are the roles and people named as responsible, for example “IT Coordinator” or “HR”.</Empty>
      ) : (
        <DataTable minWidth={820}>
          <thead>
            <tr className="border-b">
              <th className={TH}>Name</th>
              <th className={TH}>Kind</th>
              <th className={TH}>Linked user</th>
              <th className={TH}>Entity</th>
              <th className={TH}>Order</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const u = s.user_id != null ? userById.get(s.user_id) : null
              const ent = s.entity_id != null ? entityById.get(s.entity_id) : null
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <span className={s.is_active ? "font-medium text-ink" : "font-medium text-ink-3"}>{s.name}</span>
                      {!s.is_active && <Pill tone="outline">Inactive</Pill>}
                    </div>
                    {s.description && <div className="line-clamp-2 max-w-[48ch] text-[12px] text-ink-3">{s.description}</div>}
                  </td>
                  <td className={`${TD} text-ink-2`}>{KIND_LABEL[s.kind] ?? s.kind}</td>
                  <td className={TD}>
                    {u ? (
                      <span className="inline-flex items-center gap-1.5 text-ink-2"><UserAvatar name={u.display_name} className="size-5" />{u.display_name}</span>
                    ) : s.email ? <span className="text-[12.5px] text-ink-2">{s.email}</span> : <span className="text-[12.5px] text-ink-3">Not linked</span>}
                  </td>
                  <td className={TD}>{ent ? <EntityTag code={ent.code} name={ent.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}</td>
                  <td className={`${TD} tabular text-ink-3`}>{s.sort_order}</td>
                  <td className={`${TD} text-right`}>
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
      {editing && <StakeholderDialog stakeholder={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function StakeholderDialog({ stakeholder, onClose }: { stakeholder: Stakeholder | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<StakeholderIn>(() => stakeholder
    ? { name: stakeholder.name, kind: stakeholder.kind, user_id: stakeholder.user_id, email: stakeholder.email, entity_id: stakeholder.entity_id,
      description: stakeholder.description, sort_order: stakeholder.sort_order, is_active: stakeholder.is_active }
    : { name: "", kind: "role", user_id: null, email: null, entity_id: null, description: null, sort_order: 0, is_active: true })
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof StakeholderIn>(k: K, v: StakeholderIn[K]) => setF((s) => ({ ...s, [k]: v }))
  const refresh = () => qc.invalidateQueries({ queryKey: ["stakeholders"] })
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, name: f.name.trim(), email: f.email?.trim() || null, description: f.description?.trim() || null }
      return stakeholder ? api.put(`/stakeholders/${stakeholder.id}`, body) : api.post("/stakeholders", body)
    },
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(stakeholder ? "Stakeholder saved" : "Stakeholder created"); refresh(); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/stakeholders/${stakeholder!.id}`),
    onSuccess: () => { toast.success("Stakeholder deleted"); refresh(); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stakeholder ? `Edit ${stakeholder.name}` : "Create stakeholder"}</DialogTitle>
          <DialogDescription>Linking a user makes everything assigned to this stakeholder appear in that user's “My work”.</DialogDescription>
        </DialogHeader>
        <form id="sh-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Name" htmlFor="sh-name" className="sm:col-span-2">
            <Input id="sh-name" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} placeholder="e.g. IT Coordinator" />
          </Field>
          <Field label="Kind">
            <OptionSelect value={f.kind} onChange={(v) => set("kind", v ?? "role")} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Entity">
            <EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide" />
          </Field>
          <Field label="Linked user" className="sm:col-span-2">
            <UserSelect value={f.user_id} onChange={(v) => set("user_id", v)} placeholder="Not linked" />
          </Field>
          <Field label="E-mail" htmlFor="sh-email" hint="For stakeholders without a user account">
            <Input id="sh-email" type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Sort order" htmlFor="sh-order">
            <Input id="sh-order" type="number" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
          </Field>
          <Field label="Description" htmlFor="sh-desc" className="sm:col-span-2">
            <Textarea id="sh-desc" rows={2} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} /> Active (selectable as responsible)</label>
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter className="sm:justify-between">
          {stakeholder ? (
            <Confirm title={`Delete ${stakeholder.name}?`} description="Items that name this stakeholder as responsible lose the assignment. Set the stakeholder inactive to keep the history."
              confirmLabel="Delete stakeholder" onConfirm={() => del.mutate()} trigger={<Button variant="ghost" className="text-alarm">Delete</Button>} />
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="sh-form" disabled={!f.name.trim() || save.isPending}>{stakeholder ? "Save changes" : "Create stakeholder"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
