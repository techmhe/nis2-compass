import { useState } from "react"
import { Navigate, useSearchParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { KeyRound } from "lucide-react"
import { Logo } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { Me } from "@/lib/types"

const OIDC_ERRORS: Record<string, string> = {
  oidc: "Single sign-on failed. Try again or contact your administrator.",
  not_provisioned: "Your account has not been set up in this tool yet. Ask an administrator for access.",
  disabled: "Your account is disabled.",
  link_denied: "An account with your e-mail already exists and could not be linked automatically. Ask an administrator.",
}

/** 17 chapters × 4 entities, the same matrix the dashboard shows, as a quiet illustration. */
function MatrixArt() {
  const cols = 4
  const rows = 17
  const scale = ["#b42318", "#d4521f", "#c98a0c", "#7c9a3a", "#2f8a6a", "#0d6770"]
  const cells = Array.from({ length: rows * cols }, (_, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const v = (Math.sin(r * 1.7 + c * 2.3) + Math.cos(r * 0.6 - c) + 2) / 4
    return { r, c, color: scale[Math.min(5, Math.floor(v * 6))] }
  })
  return (
    <svg viewBox={`0 0 ${cols * 22} ${rows * 22}`} className="h-[62vh] max-h-[560px] w-auto opacity-90" aria-hidden>
      {cells.map((cell) => (
        <rect key={`${cell.r}-${cell.c}`} x={cell.c * 22 + 2} y={cell.r * 22 + 2} width={18} height={18} rx={2} fill={cell.color}
          opacity={0.35 + ((cell.r * 7 + cell.c * 3) % 10) / 16} />
      ))}
      <line x1="0" x2={cols * 22} y1={rows * 22 * 0.25} y2={rows * 22 * 0.25} stroke="#d4a54a" strokeWidth="1.5" strokeDasharray="4 4" />
    </svg>
  )
}

export default function LoginPage() {
  const { me, config } = useAuth()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(params.get("error") ? OIDC_ERRORS[params.get("error")!] ?? "Sign-in failed." : null)
  const [busy, setBusy] = useState(false)
  const next = params.get("next") || "/"
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"

  if (me) return <Navigate to={safeNext} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await api.post<Me>("/auth/login", { email, password })
      qc.setQueryData(["me"], user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="size-9" />
          <div className="text-[18px] font-semibold text-white">{config?.app_name ?? "NIS2 Compass"}</div>
        </div>
        <div className="flex items-end gap-10">
          <MatrixArt />
          <div className="max-w-[36ch] pb-2">
            <p className="text-[26px] leading-snug font-semibold text-white">
              Where each entity stands against every NIS-2 requirement, and what closes the gap.
            </p>
            <p className="mt-4 text-[14px] text-sidebar-muted">
              GAP assessment against Implementing Regulation (EU) 2024/2690 and the national transpositions, remediation
              planning, evidence and the law text in one place.
            </p>
          </div>
        </div>
        <div className="text-[12px] text-sidebar-muted">Internal use. Access is logged.</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Logo />
            <span className="text-[16px] font-semibold">{config?.app_name ?? "NIS2 Compass"}</span>
          </div>
          <h1 className="text-[22px] font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-[13.5px] text-ink-3">
            {config?.oidc_enabled ? `Use your company account${config.local_enabled ? " or a local account" : ""}.` : "Sign in with your e-mail and password."}
          </p>

          {error && <div role="alert" className="mt-5 rounded-md border border-alarm/30 bg-alarm-50 px-3 py-2 text-[13px] text-alarm">{error}</div>}

          {config?.oidc_enabled && (
            <Button className="mt-6 w-full" size="lg" onClick={() => { window.location.href = "/api/auth/oidc/login" }}>
              <KeyRound /> Continue with {config.oidc_display_name}
            </Button>
          )}
          {config?.oidc_enabled && config?.local_enabled && (
            <div className="my-5 flex items-center gap-3 text-[12px] text-ink-3"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
          )}
          {(config?.local_enabled ?? true) && (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" size="lg" variant={config?.oidc_enabled ? "outline" : "default"} disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
