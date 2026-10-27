import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { KV, PageHeader, Section } from "@/components/common/basics"
import { AbsenceSettings } from "@/components/common/absence"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useTheme } from "@/hooks/useTheme"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, fromNow } from "@/lib/format"

export default function ProfilePage() {
  const { me, refresh, config } = useAuth()
  const { theme, setTheme } = useTheme()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const forced = params.get("force") === "1" || me?.must_change_password
  const [name, setName] = useState(me?.display_name ?? "")
  const [title, setTitle] = useState(me?.job_title ?? "")
  const [cur, setCur] = useState("")
  const [pw1, setPw1] = useState("")
  const [pw2, setPw2] = useState("")
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState("")

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<any[]>("/auth/sessions"), enabled: !forced })
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<any[]>("/auth/tokens"), enabled: !forced })

  const saveProfile = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch("/auth/me", body),
    onSuccess: () => { toast.success("Profile saved"); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const changePw = useMutation({
    mutationFn: () => api.post("/auth/change-password", { current_password: cur, new_password: pw1 }),
    onSuccess: async () => {
      toast.success("Password changed")
      setCur(""); setPw1(""); setPw2("")
      await refresh()
      if (forced) navigate("/")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({ mutationFn: (id: number) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) })
  const createToken = useMutation({
    mutationFn: () => api.post<{ token: string }>("/auth/tokens", { name: tokenName, expires_in_days: 90 }),
    onSuccess: (r) => { setNewToken(r.token); setTokenName(""); qc.invalidateQueries({ queryKey: ["tokens"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const delToken = useMutation({ mutationFn: (id: number) => api.del(`/auth/tokens/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }) })

  if (!me) return null
  const emailNotif = (me.preferences?.email_notifications as boolean | undefined) ?? true
  const pwMismatch = pw2.length > 0 && pw1 !== pw2

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile & security" description={forced ? "Set a new password before you continue." : undefined} />
      <div className="space-y-5">
        {me.auth_source === "local" && (
          <Section title={forced ? "Choose a new password" : "Change password"}>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); changePw.mutate() }}>
              <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
              <Field label="New password" hint={`At least ${config?.password_min_length ?? 12} characters, three character classes`}>
                <Input type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} required />
              </Field>
              <Field label="Repeat new password" hint={pwMismatch ? <span className="text-alarm">Passwords differ</span> : undefined}>
                <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
              </Field>
              <div className="sm:col-span-3"><Button type="submit" disabled={!cur || !pw1 || pwMismatch || changePw.isPending}>Change password</Button></div>
            </form>
          </Section>
        )}
        {!forced && (
          <>
            <Section title="Profile">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Job title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              </div>
              <div className="mt-3"><Button onClick={() => saveProfile.mutate({ display_name: name, job_title: title })}>Save profile</Button></div>
              <div className="mt-4 border-t pt-3">
                <KV label="E-mail">{me.email}</KV>
                <KV label="Sign-in method">{me.auth_source === "oidc" ? "Single sign-on" : "Local account"}</KV>
                <KV label="Roles">{me.roles.map((r) => r.name + (r.entity_id ? ` (entity ${r.entity_id})` : "")).join(", ") || "None"}</KV>
              </div>
            </Section>
            <Section title="Preferences">
              <div className="flex items-center justify-between py-1.5">
                <div><div className="text-[13.5px]">E-mail notifications</div><div className="text-[12px] text-ink-3">Assignments, comments and reminders are also sent by e-mail when the server has mail configured.</div></div>
                <Switch checked={emailNotif} onCheckedChange={(v) => saveProfile.mutate({ preferences: { email_notifications: v } })} />
              </div>
              <div className="flex items-center justify-between py-1.5">
                <div className="text-[13.5px]">Theme</div>
                <div className="w-40"><OptionSelect value={theme} onChange={(v) => setTheme((v ?? "system") as "light")} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} /></div>
              </div>
            </Section>
            <Section title="Absence and deputy">
              <AbsenceSettings />
            </Section>
            <Section title="Active sessions" bodyClassName="p-0">
              <ul>
                {(sessions.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 border-b px-4 py-2.5 text-[13px] last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{s.user_agent || "Unknown device"}</div>
                      <div className="text-[12px] text-ink-3">{s.ip} · signed in {fmtDateTime(s.created_at)} · last seen {fromNow(s.last_seen_at)}</div>
                    </div>
                    {s.current ? <span className="text-[12px] text-petrol">This device</span> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="API tokens">
              <p className="mb-3 text-[13px] text-ink-3">For scripts and integrations. Send the token as <code className="font-mono">Authorization: Bearer …</code>. Tokens act with your permissions and expire after 90 days.</p>
              {newToken && (
                <div className="mb-3 rounded-md border border-petrol/40 bg-petrol-50 p-3 text-[13px]">
                  <div className="mb-1 font-medium">Copy this token now. It is shown only once.</div>
                  <div className="flex items-center gap-2"><code className="flex-1 truncate font-mono text-[12px]">{newToken}</code>
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newToken); toast.success("Copied") }}><Copy /> Copy</Button></div>
                </div>
              )}
              <div className="flex gap-2">
                <Input placeholder="Token name, e.g. reporting script" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
                <Button disabled={!tokenName.trim()} onClick={() => createToken.mutate()}>Create token</Button>
              </div>
              <ul className="mt-3">
                {(tokens.data ?? []).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 border-t py-2 text-[13px]">
                    <span className="font-mono text-[12px] text-ink-3">{t.prefix}…</span>
                    <span className="flex-1">{t.name}</span>
                    <span className="text-[12px] text-ink-3">expires {fmtDate(t.expires_at)}</span>
                    <Confirm title="Revoke token?" description="Scripts using it stop working immediately." confirmLabel="Revoke" onConfirm={() => delToken.mutate(t.id)}
                      trigger={<Button size="icon-sm" variant="ghost" aria-label="Revoke"><Trash2 /></Button>} />
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
