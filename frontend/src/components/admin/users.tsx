import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, MoreHorizontal, Pencil, Plus, Search, Trash2, UserCheck, UserX, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Empty, ErrorState, Loading, Pill } from "@/components/common/basics"
import { UserAvatar } from "@/components/common/collab"
import { Field, OptionSelect, Segmented } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, fromNow } from "@/lib/format"
import type { AdminUser, Entity, Role } from "@/lib/types"
import { DataTable, OneTimeSecretDialog, TD, TH } from "./common"

type Assignment = { role_id: number; entity_id: number | null }

export function useRoles() {
  return useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles"), staleTime: 60_000 })
}

export function UsersSection() {
  const { me } = useAuth()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<AdminUser[]>("/users") })
  const roles = useRoles()
  const entities = useEntities()
  const [q, setQ] = useState("")
  const [showInactive, setShowInactive] = useState(true)
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null)
  const [secret, setSecret] = useState<{ user: string; password: string } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: "reset" | "delete" | "deactivate"; user: AdminUser } | null>(null)

  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data])
  const entityById = useMemo(() => new Map((entities.data ?? []).map((e) => [e.id, e])), [entities.data])
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); qc.invalidateQueries({ queryKey: ["users-directory"] }) }

  const reset = useMutation({
    mutationFn: (u: AdminUser) => api.post<{ initial_password: string }>(`/users/${u.id}/reset-password`),
    onSuccess: (r, u) => { setSecret({ user: u.display_name, password: r.initial_password }); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const setActive = useMutation({
    mutationFn: ({ u, active }: { u: AdminUser; active: boolean }) => api.patch(`/users/${u.id}`, { is_active: active }),
    onSuccess: (_r, v) => { toast.success(v.active ? `${v.u.display_name} reactivated` : `${v.u.display_name} deactivated and signed out`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (u: AdminUser) => api.del(`/users/${u.id}`),
    onSuccess: (_r, u) => { toast.success(`${u.display_name} deleted`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  const rows = (users.data ?? []).filter((u) => {
    if (!showInactive && !u.is_active) return false
    const n = q.trim().toLowerCase()
    return !n || `${u.display_name} ${u.email} ${u.job_title ?? ""}`.toLowerCase().includes(n)
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or e-mail" className="pl-8" aria-label="Search users" />
        </div>
        <Segmented size="sm" value={showInactive ? "All" : "Active"} onChange={(v) => setShowInactive(v !== "Active")} options={["All", "Active"]} />
        <span className="tabular text-[12.5px] text-ink-3">{rows.length} users</span>
        <Button className="ml-auto" onClick={() => setEditing("new")}><Plus /> Create user</Button>
      </div>

      {users.isLoading ? <Loading /> : users.error ? <ErrorState error={users.error} /> : rows.length === 0 ? (
        <Empty title="No users match">Change the search or show inactive users.</Empty>
      ) : (
        <DataTable minWidth={900}>
          <thead>
            <tr className="border-b">
              <th className={TH}>User</th>
              <th className={TH}>Roles</th>
              <th className={TH}>Sign-in</th>
              <th className={TH}>Last sign-in</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className={TD}>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={u.display_name} className="size-7" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={u.is_active ? "font-medium text-ink" : "font-medium text-ink-3 line-through"}>{u.display_name}</span>
                        {u.id === me?.id && <span className="text-[12px] text-ink-3">(you)</span>}
                        {!u.is_active && <Pill tone="outline">Inactive</Pill>}
                        {u.must_change_password && u.is_active && <Pill tone="amber" title="Must set a new password at next sign-in">Password change pending</Pill>}
                      </div>
                      <div className="text-[12px] text-ink-3">{u.email}{u.job_title ? `, ${u.job_title}` : ""}</div>
                    </div>
                  </div>
                </td>
                <td className={TD}>
                  <div className="flex max-w-[380px] flex-wrap gap-1">
                    {u.assignments.length === 0 && <span className="text-[12.5px] text-alarm">No role (cannot see anything)</span>}
                    {u.assignments.map((a) => {
                      const ent = a.entity_id != null ? entityById.get(a.entity_id) : null
                      return (
                        <Pill key={a.id} tone={a.entity_id != null ? "outline" : "neutral"} title={ent ? `Only for ${ent.name}` : "Group-wide"}>
                          {roleById.get(a.role_id)?.name ?? `Role ${a.role_id}`}
                          {a.entity_id != null && <span className="font-mono text-ink-3">{ent?.code ?? a.entity_id}</span>}
                        </Pill>
                      )
                    })}
                  </div>
                </td>
                <td className={`${TD} text-ink-2`}>{u.auth_source === "oidc" ? "Single sign-on" : "Local password"}</td>
                <td className={`${TD} whitespace-nowrap text-ink-2`} title={u.last_login_at ? fmtDate(u.last_login_at) : undefined}>
                  {u.last_login_at ? fromNow(u.last_login_at) : <span className="text-ink-3">Never</span>}
                </td>
                <td className={`${TD} text-right`}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.display_name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(u)}><Pencil /> Edit user and roles</DropdownMenuItem>
                      {u.auth_source === "local" && (
                        <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user: u })}><KeyRound /> Reset password</DropdownMenuItem>
                      )}
                      {u.id !== me?.id && (u.is_active ? (
                        <DropdownMenuItem onSelect={() => setConfirm({ kind: "deactivate", user: u })}><UserX /> Deactivate</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setActive.mutate({ u, active: true })}><UserCheck /> Reactivate</DropdownMenuItem>
                      ))}
                      {u.id !== me?.id && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-alarm focus:text-alarm" onSelect={() => setConfirm({ kind: "delete", user: u })}><Trash2 /> Delete user</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {editing && (
        <UserDialog user={editing === "new" ? null : editing} roles={roles.data ?? []} entities={entities.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(pw, name) => { setEditing(null); refresh(); if (pw) setSecret({ user: name, password: pw }) }} />
      )}

      <OneTimeSecretDialog secret={secret?.password ?? null} title={`Initial password for ${secret?.user ?? ""}`}
        description="Give this password to the user through a secure channel." onClose={() => setSecret(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm.kind === "reset" ? `Reset the password of ${confirm.user.display_name}?`
                    : confirm.kind === "deactivate" ? `Deactivate ${confirm.user.display_name}?` : `Delete ${confirm.user.display_name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm.kind === "reset" ? "A new one-time password is generated. All sessions and API tokens of the user end immediately."
                    : confirm.kind === "deactivate" ? "The user can no longer sign in. All sessions and API tokens end immediately. You can reactivate the account later."
                      : "The account is removed permanently. Their comments and history remain, attributed to a deleted user. Prefer deactivating if you may need the account again."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className={confirm.kind === "delete" ? "bg-alarm hover:bg-alarm/90" : undefined}
                  onClick={() => {
                    if (confirm.kind === "reset") reset.mutate(confirm.user)
                    else if (confirm.kind === "deactivate") setActive.mutate({ u: confirm.user, active: false })
                    else del.mutate(confirm.user)
                  }}>
                  {confirm.kind === "reset" ? "Reset password" : confirm.kind === "deactivate" ? "Deactivate" : "Delete user"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function UserDialog({ user, roles, entities, onClose, onSaved }: {
  user: AdminUser | null
  roles: Role[]
  entities: Entity[]
  onClose: () => void
  onSaved: (initialPassword: string | null, name: string) => void
}) {
  const { me } = useAuth()
  const isSelf = user?.id === me?.id
  const [email, setEmail] = useState(user?.email ?? "")
  const [name, setName] = useState(user?.display_name ?? "")
  const [job, setJob] = useState(user?.job_title ?? "")
  const [source, setSource] = useState(user?.auth_source ?? "local")
  const [password, setPassword] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>(
    user ? user.assignments.map((a) => ({ role_id: a.role_id, entity_id: a.entity_id })) : [{ role_id: roles.find((r) => r.key === "viewer")?.id ?? roles[0]?.id, entity_id: null }].filter((a) => a.role_id != null) as Assignment[],
  )
  const [error, setError] = useState<string | null>(null)
  const own = new Set(me?.global_permissions ?? [])
  const grantable = (r: Role) => r.permissions.every((p) => own.has(p))

  const save = useMutation({
    mutationFn: async () => {
      if (!user) {
        return api.post<{ id: number; initial_password: string | null }>("/users", {
          email: email.trim(), display_name: name.trim(), job_title: job.trim() || null, auth_source: source,
          password: source === "local" && password ? password : null, assignments,
        })
      }
      await api.patch(`/users/${user.id}`, {
        display_name: name.trim(), job_title: job.trim(), ...(isSelf ? {} : { assignments }),
      })
      return { id: user.id, initial_password: null }
    },
    onMutate: () => setError(null),
    onSuccess: (r) => {
      toast.success(user ? "User saved" : `User ${name.trim()} created`)
      onSaved(r.initial_password, name.trim())
    },
    onError: (e: Error) => setError(e.message),
  })

  const update = (i: number, patch: Partial<Assignment>) => setAssignments((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const dupes = new Set(assignments.map((a) => `${a.role_id}-${a.entity_id}`)).size !== assignments.length

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.display_name}` : "Create user"}</DialogTitle>
          <DialogDescription>
            {user ? "Changes to roles take effect on the user's next request." : "Local users get a one-time password and must choose their own at first sign-in."}
          </DialogDescription>
        </DialogHeader>
        <form id="user-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-mail" htmlFor="u-email">
              <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!user} required autoComplete="off" />
            </Field>
            <Field label="Display name" htmlFor="u-name">
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Job title" htmlFor="u-job">
              <Input id="u-job" value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. IT Coordinator" />
            </Field>
            {!user && (
              <Field label="Sign-in method">
                <OptionSelect value={source} onChange={(v) => setSource(v ?? "local")}
                  options={[{ value: "local", label: "Local password" }, { value: "oidc", label: "Single sign-on (OIDC)" }]} />
              </Field>
            )}
            {!user && source === "local" && (
              <Field label="Initial password" htmlFor="u-pw" hint="Leave empty to generate a secure one-time password" className="sm:col-span-2">
                <Input id="u-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[12.5px] font-medium text-ink-2">Role assignments</h3>
              {!isSelf && (
                <Button type="button" size="xs" variant="outline"
                  onClick={() => setAssignments((as) => [...as, { role_id: roles.find(grantable)?.id ?? roles[0].id, entity_id: null }])}>
                  <Plus /> Add role
                </Button>
              )}
            </div>
            {isSelf ? (
              <p className="rounded-md bg-muted px-3 py-2 text-[12.5px] text-ink-2">You cannot change your own roles. Ask another administrator.</p>
            ) : assignments.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-[12.5px] text-amber">Without a role the user can sign in but sees nothing. Add at least one role.</p>
            ) : (
              <ul className="space-y-2">
                {assignments.map((a, i) => {
                  const role = roles.find((r) => r.id === a.role_id)
                  return (
                    <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                      <OptionSelect value={String(a.role_id)} onChange={(v) => v && update(i, { role_id: Number(v) })}
                        options={roles.map((r) => ({
                          value: String(r.id),
                          label: grantable(r) ? r.name : <span className="text-ink-3">{r.name} (exceeds your permissions)</span>,
                        }))} />
                      <OptionSelect value={a.entity_id != null ? String(a.entity_id) : null} onChange={(v) => update(i, { entity_id: v ? Number(v) : null })}
                        allowNone noneLabel="Group-wide (all entities)"
                        options={entities.map((e) => ({ value: String(e.id), label: <span>Only <span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${role?.name ?? "role"}`}
                        onClick={() => setAssignments((as) => as.filter((_, j) => j !== i))}><X /></Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-ink-3">
              An entity-scoped role grants its permissions only for that entity's assessments, findings, documents and incidents.
              Group-level objects stay read-only for scoped users.
            </p>
            {dupes && <p className="mt-1 text-[12px] text-amber">The same role and scope appear twice; duplicates are ignored.</p>}
          </div>
          {error && <ErrorState error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="user-form" disabled={save.isPending || !name.trim() || (!user && !email.trim())}>
            {save.isPending ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
