import { Fragment, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Lock, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, Loading } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import type { Role } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useRoles } from "./users"

interface Perm { key: string; description: string; group: string }

const GROUP_LABEL: Record<string, string> = {
  entities: "Entities and stakeholders", catalog: "Requirement catalogue", assessments: "Assessments", findings: "Action plan",
  projects: "Project", workpackages: "Work packages", tasks: "Tasks", documents: "Documents", regulations: "Regulations library",
  incidents: "Incidents", ai: "AI assistant", reports: "Reports", audit: "Audit", users: "Users", roles: "Roles", settings: "Settings",
}

export function RolesSection({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const roles = useRoles()
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => api.get<Perm[]>("/permissions"), staleTime: Infinity })
  const [draft, setDraft] = useState<Record<number, Set<string>>>({})
  const [editing, setEditing] = useState<Role | "new" | null>(null)

  const groups = useMemo(() => {
    const g: [string, Perm[]][] = []
    for (const p of perms.data ?? []) {
      const last = g[g.length - 1]
      if (last && last[0] === p.group) last[1].push(p)
      else g.push([p.group, [p]])
    }
    return g
  }, [perms.data])

  const permsOf = (r: Role) => draft[r.id] ?? new Set(r.permissions)
  const changed = (roles.data ?? []).filter((r) => {
    const d = draft[r.id]
    if (!d) return false
    const orig = new Set(r.permissions)
    return d.size !== orig.size || [...d].some((p) => !orig.has(p))
  })
  const toggle = (r: Role, p: string) => setDraft((d) => {
    const s = new Set(d[r.id] ?? r.permissions)
    if (s.has(p)) s.delete(p)
    else s.add(p)
    return { ...d, [r.id]: s }
  })

  const saveAll = useMutation({
    mutationFn: async () => {
      for (const r of changed) {
        await api.put(`/roles/${r.id}`, { name: r.name, description: r.description, permissions: [...draft[r.id]] })
      }
    },
    onSuccess: () => {
      toast.success(`${changed.length} role${changed.length === 1 ? "" : "s"} saved`)
      setDraft({})
      qc.invalidateQueries({ queryKey: ["roles"] })
      qc.invalidateQueries({ queryKey: ["me"] })
    },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["roles"] }) },
  })

  if (roles.isLoading || perms.isLoading) return <Loading />
  if (roles.error || perms.error) return <ErrorState error={roles.error ?? perms.error} />
  const list = roles.data ?? []

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!canEdit && <p className="text-[12.5px] text-ink-3">You can view the roles. Changing them needs the permission “Manage roles and permissions”.</p>}
        {canEdit && (
          <>
            <Button variant="outline" onClick={() => setEditing("new")}><Plus /> Create role</Button>
            {changed.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12.5px] text-amber">Unsaved changes in {changed.map((r) => r.name).join(", ")}</span>
                <Button variant="ghost" onClick={() => setDraft({})}>Discard</Button>
                <Button onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>{saveAll.isPending ? "Saving…" : "Save changes"}</Button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border bg-card scroll-thin">
        <table className="w-full text-[13px]" style={{ minWidth: 300 + list.length * 110 }}>
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 min-w-[280px] bg-card px-3 py-2 text-left text-[12px] font-medium text-ink-3">Permission</th>
              {list.map((r) => {
                const locked = r.key === "admin"
                return (
                  <th key={r.id} className="w-[110px] px-1 py-2 text-center align-bottom text-[12px] font-medium text-ink-2">
                    <div className="flex flex-col items-center gap-1">
                      <span className="leading-tight">{r.name}</span>
                      <span className="flex items-center gap-1 text-[11px] font-normal text-ink-3">
                        {locked ? <><Lock className="size-3" /> fixed</> : r.is_system ? "built-in" : "custom"}
                        {canEdit && !locked && (
                          <button type="button" className="rounded p-0.5 hover:text-petrol" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                            <Pencil className="size-3" />
                          </button>
                        )}
                      </span>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, ps]) => (
              <Fragment key={group}>
                <tr className="bg-muted/50">
                  <td colSpan={list.length + 1} className="sticky left-0 px-3 py-1 text-[12px] font-medium text-ink-2">{GROUP_LABEL[group] ?? group}</td>
                </tr>
                {ps.map((p) => (
                  <tr key={p.key} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                      <div className="text-ink">{p.description}</div>
                      <div className="font-mono text-[11px] text-ink-3">{p.key}</div>
                    </td>
                    {list.map((r) => {
                      const has = permsOf(r).has(p.key)
                      const editable = canEdit && r.key !== "admin"
                      const dirty = !!draft[r.id] && has !== r.permissions.includes(p.key)
                      return (
                        <td key={r.id} className={cn("px-1 py-1.5 text-center", dirty && "bg-amber-50")}>
                          {editable ? (
                            <Checkbox checked={has} onCheckedChange={() => toggle(r, p.key)} aria-label={`${r.name}: ${p.description}`} />
                          ) : has ? (
                            <Check className="mx-auto size-4 text-petrol" aria-label="Granted" />
                          ) : <span className="text-ink-3" aria-label="Not granted">–</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RoleDialog role={editing === "new" ? null : editing} roles={list} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RoleDialog({ role, roles, onClose }: { role: Role | null; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(role?.name ?? "")
  const [key, setKey] = useState(role?.key ?? "")
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState(role?.description ?? "")
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoKey = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "r_$1").slice(0, 59)
  const effectiveKey = role ? role.key : keyTouched ? key : autoKey

  const save = useMutation({
    mutationFn: () => role
      ? api.put<Role>(`/roles/${role.id}`, { name: name.trim(), description: description.trim() || null, permissions: role.permissions })
      : api.post<Role>("/roles", {
        key: effectiveKey, name: name.trim(), description: description.trim() || null,
        permissions: roles.find((r) => String(r.id) === copyFrom)?.permissions ?? [],
      }),
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(role ? "Role saved" : `Role ${name.trim()} created`); qc.invalidateQueries({ queryKey: ["roles"] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/roles/${role!.id}`),
    onSuccess: () => { toast.success("Role deleted"); qc.invalidateQueries({ queryKey: ["roles"] }); qc.invalidateQueries({ queryKey: ["admin", "users"] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "Create role"}</DialogTitle>
          <DialogDescription>{role ? "Set the permissions in the matrix." : "Start from an existing role or from no permissions, then adjust the matrix."}</DialogDescription>
        </DialogHeader>
        <form id="role-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Name" htmlFor="r-name"><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
          {!role && (
            <Field label="Key" htmlFor="r-key" hint="Lower case letters, digits and underscores; used in configuration such as the OIDC role mapping">
              <Input id="r-key" className="font-mono" value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(e.target.value) }} pattern="^[a-z][a-z0-9_]{1,58}$" required />
            </Field>
          )}
          <Field label="Description" htmlFor="r-desc"><Textarea id="r-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {!role && (
            <Field label="Copy permissions from">
              <OptionSelect value={copyFrom} onChange={setCopyFrom} allowNone noneLabel="No permissions" placeholder="No permissions"
                options={roles.map((r) => ({ value: String(r.id), label: r.name }))} />
            </Field>
          )}
          {error && <ErrorState error={error} />}
        </form>
        <DialogFooter className="sm:justify-between">
          {role && !role.is_system ? (
            <Confirm title={`Delete role ${role.name}?`} description="Users lose the permissions granted through this role immediately."
              confirmLabel="Delete role" onConfirm={() => del.mutate()}
              trigger={<Button variant="ghost" className="text-alarm">Delete role</Button>} />
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="role-form" disabled={!name.trim() || save.isPending}>{role ? "Save changes" : "Create role"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
