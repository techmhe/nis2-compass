import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, ErrorState, KV, Loading, Pill, Section } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { useRoles } from "./users"

interface SystemInfo {
  app_name: string
  env: string
  base_url: string
  auth: {
    local_enabled: boolean
    oidc_enabled: boolean
    oidc_issuer: string | null
    oidc_client_id: string | null
    oidc_groups_claim: string | null
    oidc_role_mapping: Record<string, string>
    oidc_default_role: string | null
    session_idle_minutes: number
    session_absolute_hours: number
  }
  uploads: { max_upload_mb: number; allowed_extensions: string[] }
  smtp_configured: boolean
  tls: { issuer: "internal" | "letsencrypt" | "acme_custom"; acme_ca_url: string | null; eab: boolean; extra_ca_certs: string[] }
  index: { chunks: number }
  users: number
  db_version: string
}

const OnOff = ({ on, onLabel = "Enabled", offLabel = "Disabled" }: { on: boolean; onLabel?: string; offLabel?: string }) =>
  on ? <span className="text-petrol">{onLabel}</span> : <span className="text-ink-3">{offLabel}</span>

export function SystemSection() {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ["admin", "system"], queryFn: () => api.get<SystemInfo>("/admin/system") })
  const roles = useRoles()
  const reindex = useMutation({
    mutationFn: () => api.post<{ chunks: number }>("/admin/reindex"),
    onSuccess: (r) => {
      toast.success(`Search index rebuilt: ${r.chunks.toLocaleString("en")} chunks`)
      qc.invalidateQueries({ queryKey: ["admin", "system"] })
      qc.invalidateQueries({ queryKey: ["ai", "status"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (info.isLoading) return <Loading />
  if (info.error) return <ErrorState error={info.error} />
  const s = info.data!
  const roleName = (key: string | null) => (key ? roles.data?.find((r) => r.key === key)?.name ?? key : "–")
  const mapping = Object.entries(s.auth.oidc_role_mapping ?? {})

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Application">
          <KV label="Name">{s.app_name}</KV>
          <KV label="Environment">{s.env === "production" ? s.env : <Pill tone="amber">{s.env}</Pill>}</KV>
          <KV label="Base URL"><Code>{s.base_url}</Code></KV>
          <KV label="Users"><span className="tabular">{s.users}</span></KV>
          <KV label="E-mail (SMTP)"><OnOff on={s.smtp_configured} onLabel="Configured" offLabel="Not configured; notifications stay in the app" /></KV>
          <KV label="Certificates">
            {s.tls.issuer === "acme_custom" ? <>Internal ACME CA{s.tls.eab && " (with account binding)"}{s.tls.acme_ca_url && <Code className="mt-0.5 block break-all text-[12px]">{s.tls.acme_ca_url}</Code>}</>
              : s.tls.issuer === "letsencrypt" ? "Let's Encrypt" : <Pill tone="amber">Self-signed (testing)</Pill>}
            {s.tls.extra_ca_certs.length > 0 && <span className="mt-1 block text-[12.5px] text-ink-3">Also trusted for outgoing connections: {s.tls.extra_ca_certs.join(", ")}</span>}
            <span className="mt-1 block text-[12px] text-ink-3">Set in <Code>deploy/.env</Code> on the server.</span>
          </KV>
          <KV label="Database"><span className="text-[12.5px] break-words text-ink-2">{s.db_version}</span></KV>
          <KV label="Uploads">
            Up to <span className="tabular">{s.uploads.max_upload_mb}</span> MB per file
            <div className="mt-1 flex flex-wrap gap-1">{s.uploads.allowed_extensions.map((e) => <Code key={e} className="rounded bg-muted px-1 text-[11.5px]">.{e}</Code>)}</div>
          </KV>
        </Section>

        <Section title="Search index" actions={
          <Confirm title="Rebuild the search index?" destructive={false} confirmLabel="Rebuild index"
            description="All documents, requirements, answers, law texts and other objects are re-indexed. This can take a minute; search results may be incomplete meanwhile. Embeddings are recreated in the background."
            onConfirm={() => reindex.mutate()}
            trigger={<Button size="xs" variant="outline" disabled={reindex.isPending}><RefreshCw className={reindex.isPending ? "animate-spin" : undefined} /> {reindex.isPending ? "Rebuilding…" : "Rebuild index"}</Button>} />
        }>
          <KV label="Indexed chunks"><span className="tabular">{s.index.chunks.toLocaleString("en")}</span></KV>
          <p className="mt-2 text-[12.5px] text-ink-3">
            The index powers the global search, document search, the regulations search and the assistant's sources. It is updated automatically on every change;
            rebuild it after restoring a backup or changing the embedding model.
          </p>
        </Section>
      </div>

      <Section title="Sign-in and sessions">
        <div className="grid gap-x-8 lg:grid-cols-2">
          <div>
            <KV label="Local passwords"><OnOff on={s.auth.local_enabled} /></KV>
            <KV label="Single sign-on (OIDC)"><OnOff on={s.auth.oidc_enabled} /></KV>
            <KV label="Idle timeout"><span className="tabular">{s.auth.session_idle_minutes}</span> minutes</KV>
            <KV label="Maximum session"><span className="tabular">{s.auth.session_absolute_hours}</span> hours</KV>
          </div>
          <div>
            <KV label="Issuer">{s.auth.oidc_issuer ? <Code className="break-all">{s.auth.oidc_issuer}</Code> : null}</KV>
            <KV label="Client ID">{s.auth.oidc_client_id ? <Code className="break-all">{s.auth.oidc_client_id}</Code> : null}</KV>
            <KV label="Groups claim">{s.auth.oidc_groups_claim ? <Code>{s.auth.oidc_groups_claim}</Code> : null}</KV>
            <KV label="Default role">{s.auth.oidc_default_role ? roleName(s.auth.oidc_default_role) : "None (users without a mapped group get no role)"}</KV>
          </div>
        </div>
        <div className="mt-3 border-t pt-3">
          <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">Group to role mapping</h3>
          {mapping.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">No mapping configured. Single sign-on users receive the default role on first sign-in and can then be assigned roles under Users.</p>
          ) : (
            <table className="text-[13px]">
              <thead><tr className="text-left text-[12px] text-ink-3"><th className="pr-8 pb-1 font-medium">Identity provider group</th><th className="pb-1 font-medium">Role</th></tr></thead>
              <tbody>
                {mapping.map(([group, role]) => (
                  <tr key={group}><td className="py-0.5 pr-8"><Code>{group}</Code></td><td className="py-0.5 text-ink">{roleName(role)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[12px] text-ink-3">These values come from the server configuration (environment variables) and are shown read-only.</p>
        </div>
      </Section>

      <GeneralSettings />
    </div>
  )
}

function GeneralSettings() {
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.get<Record<string, unknown>>("/admin/settings") })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  return <GeneralSettingsForm key={JSON.stringify(q.data)} initial={q.data ?? {}} />
}

function GeneralSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const qc = useQueryClient()
  const [org, setOrg] = useState(String(initial["branding.org_name"] ?? ""))
  const [days, setDays] = useState(String(initial["reminders.due_soon_days"] ?? 14))
  const [banner, setBanner] = useState(String(initial["branding.banner"] ?? ""))
  const [error, setError] = useState<string | null>(null)
  const n = Number(days)
  const dirty = org !== String(initial["branding.org_name"] ?? "") || days !== String(initial["reminders.due_soon_days"] ?? 14) || banner !== String(initial["branding.banner"] ?? "")
  const save = useMutation({
    mutationFn: () => api.put("/admin/settings", { "branding.org_name": org.trim(), "reminders.due_soon_days": n, "branding.banner": banner.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["admin", "settings"] }) },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Section title="General settings">
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Organisation name" htmlFor="set-org" hint="Used in exports and e-mails">
          <Input id="set-org" value={org} onChange={(e) => setOrg(e.target.value)} />
        </Field>
        <Field label="Due soon (days)" htmlFor="set-days" hint="When items count as due soon and reminders are sent">
          <Input id="set-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Banner message" htmlFor="set-banner" className="sm:col-span-2" hint="Optional notice for all users, e.g. a planned maintenance window. Leave empty for none.">
          <Textarea id="set-banner" rows={2} value={banner} onChange={(e) => setBanner(e.target.value)} />
        </Field>
        {error && <ErrorState error={error} className="sm:col-span-2" />}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!dirty || !Number.isInteger(n) || n < 1 || n > 90 || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Section>
  )
}
