import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react"
import { Logo } from "@/components/app-shell"
import { Code, ErrorState, KV, Loading, Pill, Section } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { blankProject, ProjectStep, projectBody, projectProblems, usePlanPreview, type ProjectDraft } from "@/components/setup/project-step"
import { blankRole, rolesPayload, RolesStep, rowsFromOffered, shownRoles, takesPart, validateRoles, type RoleRow } from "@/components/setup/roles-step"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSetupOptions, type SetupOptions } from "@/hooks/useSetupStatus"
import { api, ApiError } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import type { Me } from "@/lib/types"

const STEPS = ["Administrator", "Companies", "Project", "Roles", "Review"] as const
type StepName = (typeof STEPS)[number]
const SIZE_LABEL: Record<string, string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CODE_RE = /^[A-Za-z0-9_-]+$/

interface Admin { display_name: string; email: string; password: string; repeat: string }
interface Company { key: number; name: string; code: string; legal_form: string; country: string; sector: string | null; size_class: string | null; is_headquarters: boolean }
type Errors = Record<string, string>

// Mirrors the server's password_problems (Python str methods), so umlauts and other scripts count the same way.
function passwordProblem(pw: string, min: number): string | null {
  if ([...pw].length < min) return `Password needs at least ${min} characters`
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u].filter((r) => r.test(pw)).length
  return classes < 3 ? "Password needs at least three of: lowercase, uppercase, digit, symbol" : null
}

function validateAdmin(a: Admin, min: number, token: string): Errors {
  const e: Errors = {}
  if (!token.trim()) e["setup_token"] = "Enter the setup token"
  if (!a.display_name.trim()) e["admin.display_name"] = "Name is required"
  if (!EMAIL_RE.test(a.email.trim())) e["admin.email"] = "Invalid e-mail address"
  const pw = passwordProblem(a.password, min)
  if (pw) e["admin.password"] = pw
  if (a.repeat !== a.password) e["admin.repeat"] = "The passwords do not match"
  return e
}

function validateCompanies(cs: Company[]): Errors {
  const e: Errors = {}
  const seen = new Set<string>()
  cs.forEach((c, i) => {
    const k = (f: string) => `companies.${i}.${f}`
    if (!c.name.trim()) e[k("name")] = "Name is required"
    if (!c.code) e[k("code")] = "Code is required"
    else if (!CODE_RE.test(c.code)) e[k("code")] = "Letters, digits, - and _ only"
    else if (seen.has(c.code.toLowerCase())) e[k("code")] = "Company code is used twice"
    seen.add(c.code.toLowerCase())
    if (!c.legal_form.trim()) e[k("legal_form")] = "Legal form is required"
    if (!c.country) e[k("country")] = "Choose a country"
    if (!c.sector) e[k("sector")] = "Choose a sector"
    if (!c.size_class) e[k("size_class")] = "Choose a size class"
  })
  return e
}

const FIELD_KEYS = new Set(["name", "code", "legal_form", "country", "sector", "size_class", "is_headquarters"])
const PROJECT_KEYS = new Set(["name", "start", "end"])
const ROLE_KEYS = new Set(["name", "rename_to", "email"])

/** The 422 body ({detail, errors: [{loc, msg}]}) to field errors keyed like the client-side ones ("companies.2.code").
 *  What has no field on the page (company list rules, unknown paths) becomes the banner text. */
function serverErrors(body: unknown): { fields: Errors; general: string | null; generalStep: StepName } {
  const fields: Errors = {}
  const general: string[] = []
  let generalStep: StepName = "Companies"
  const items = (body as { errors?: unknown } | null)?.errors
  if (Array.isArray(items)) {
    for (const it of items as { loc?: (string | number)[]; msg?: string }[]) {
      const msg = (it.msg ?? "Invalid value").replace(/^Value error, /, "")
      const path = (it.loc ?? []).slice(1)
      if (path[0] === "project" && path[1] === "roles" && path.length === 4 && ROLE_KEYS.has(String(path[3]))) {
        fields[`roles.${path[2]}.${path[3] === "rename_to" ? "name" : path[3]}`] = msg
      } else if (path[0] === "project" && path[1] === "gates" && path.length === 3) fields[`project.gates.${path[2]}`] = msg
      else if (path[0] === "project" && path.length === 2 && PROJECT_KEYS.has(String(path[1]))) fields[path.join(".")] = msg
      else if (path[0] === "admin" ? path.length === 2 : path[0] === "companies" && path.length === 3 && FIELD_KEYS.has(String(path[2]))) fields[path.join(".")] = msg
      else {
        general.push(msg)
        generalStep = path[0] === "project" ? (path[1] === "roles" ? "Roles" : "Project") : "Companies"
      }
    }
  }
  return { fields, general: general.length ? general.join(". ") : null, generalStep }
}

function ErrorText({ id, children }: { id: string; children?: string }) {
  return children ? <p id={id} role="alert" className="text-[12px] text-alarm">{children}</p> : null
}

function TextField({ id, label, hint, error, className, ...input }: { id: string; label: string; hint?: React.ReactNode; error?: string; className?: string } & React.ComponentProps<"input">) {
  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      <Input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...input} />
      <ErrorText id={`${id}-error`}>{error}</ErrorText>
    </Field>
  )
}

export default function SetupPage() {
  const options = useSetupOptions()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState("")
  const [admin, setAdmin] = useState<Admin>({ display_name: "", email: "", password: "", repeat: "" })
  const nextKey = useRef(2)
  const [companies, setCompanies] = useState<Company[]>([])
  const [project, setProject] = useState<ProjectDraft>(blankProject)
  const [recalculated, setRecalculated] = useState(false)
  const nextRoleKey = useRef(1000)
  const [editedRoles, setRoles] = useState<RoleRow[] | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const opts = options.data
  const withPlan = !!opts && !opts.project_exists
  const steps: readonly StepName[] = withPlan ? STEPS : ["Administrator", "Companies", "Review"]
  const stepName = steps[step]
  const allRoles = editedRoles ?? (opts ? rowsFromOffered(opts.roles) : [])
  const roles = shownRoles(allRoles, companies.map((c) => c.country))
  const plan = usePlanPreview(project, companies.length, withPlan && step >= steps.indexOf("Project"))

  // The first company starts as headquarters, in the first country of the registry.
  useEffect(() => {
    if (opts && companies.length === 0) setCompanies([blankCompany(1, opts, true)])
  }, [opts, companies.length])
  useEffect(() => { heading.current?.focus() }, [step])

  if (options.isLoading) return <Loading className="h-screen justify-center" />
  if (!opts) return <div className="mx-auto max-w-md p-8"><ErrorState error={options.error} /><Button className="mt-4" onClick={() => window.location.reload()}>Reload</Button></div>

  const setA = (f: keyof Admin, v: string) => { setAdmin((a) => ({ ...a, [f]: v })); clearError(`admin.${f}`) }
  const clearError = (key: string) => setErrors((e) => { if (!(key in e)) return e; const { [key]: _gone, ...rest } = e; return rest })
  const setC = (i: number, f: keyof Company, v: string | boolean | null) => { setCompanies((cs) => cs.map((c, j) => (j === i ? { ...c, [f]: v } : c))); clearError(`companies.${i}.${f}`) }
  const setHq = (i: number) => setCompanies((cs) => cs.map((c, j) => ({ ...c, is_headquarters: j === i })))
  const add = () => { setCompanies((cs) => [...cs, blankCompany(nextKey.current++, opts, false)]); setErrors({}) }
  const remove = (i: number) => {
    setCompanies((cs) => {
      const rest = cs.filter((_, j) => j !== i)
      return rest.some((c) => c.is_headquarters) ? rest : rest.map((c, j) => ({ ...c, is_headquarters: j === 0 }))
    })
    setErrors({})
  }

  const setProj = (patch: Partial<ProjectDraft>, recalc = false) => {
    setProject((p) => ({ ...p, ...patch, gates: recalc ? {} : p.gates }))
    if (recalc) setRecalculated(Object.keys(project.gates).length > 0) // say so only if typed dates were dropped
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("project."))))
  }
  const setGate = (code: string, date: string) => {
    setProject((p) => ({ ...p, gates: { ...p.gates, [code]: date } }))
    setRecalculated(false)
  }
  const setRole = (key: number, patch: Partial<RoleRow>) => {
    setRoles((prev) => (prev ?? rowsFromOffered(opts.roles)).map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setErrors({})
  }
  const addRole = () => setRoles((prev) => [...(prev ?? rowsFromOffered(opts.roles)), blankRole(nextRoleKey.current++)])
  const removeRole = (key: number) => { setRoles((prev) => (prev ?? []).filter((r) => r.key !== key)); setErrors({}) }

  const next = () => {
    setBanner(null)
    const e = stepName === "Administrator" ? validateAdmin(admin, opts.password_min_length, token)
      : stepName === "Companies" ? validateCompanies(companies)
      : stepName === "Project" ? Object.fromEntries(Object.entries(projectProblems(project)).map(([k, v]) => [`project.${k}`, v]))
      : validateRoles(roles, project.external_support, opts.oidc_enabled)
    setErrors(e)
    if (Object.keys(e).length === 0) setStep(step + 1)
  }

  const finish = async () => {
    setBusy(true)
    setBanner(null)
    try {
      const me = await api.post<Me>("/setup", {
        setup_token: token.trim(),
        admin: { display_name: admin.display_name.trim(), email: admin.email.trim(), password: admin.password },
        companies: companies.map(({ key: _key, ...c }) => ({ ...c, name: c.name.trim(), legal_form: c.legal_form.trim() })),
        ...(withPlan && { project: { ...projectBody(project), roles: rolesPayload(roles, project.external_support, opts.oidc_enabled) } }),
      })
      qc.setQueryData(["setup-status"], { needed: false })
      qc.setQueryData(["me"], me)
      qc.invalidateQueries({ queryKey: ["auth-config"] })
      navigate("/", { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const { fields, general, generalStep } = serverErrors(err.detail)
        setErrors(fields)
        setBanner(general)
        const at = (name: StepName) => Math.max(steps.indexOf(name), 0)
        const keys = Object.keys(fields)
        setStep(keys.some((k) => k.startsWith("admin.")) ? 0
          : keys.some((k) => k.startsWith("companies.")) ? 1
          : keys.some((k) => k.startsWith("project.")) ? at("Project")
          : keys.some((k) => k.startsWith("roles.")) ? at("Roles")
          : at(generalStep))
      } else if (err instanceof ApiError && err.status === 403) {
        setErrors({ setup_token: "The setup token is not correct." })
        setStep(0)
      } else {
        setBanner(err instanceof ApiError && err.status === 409 ? "Setup was already completed by someone else. Reload to sign in." : "Setup could not be completed. Nothing was saved. Reload the page and try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  const jurisdiction = (code: string) => opts.jurisdictions.find((j) => j.code === code)
  const sectorLabel = (key: string | null) => opts.sectors.find((s) => s.key === key)?.label ?? key

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Logo className="size-8" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white">NIS2 Compass</div>
            <div className="text-[12px] text-sidebar-muted">First-run setup</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Setup steps">
          {steps.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 border-b-2 pb-2 text-[13px] ${i === step ? "border-petrol font-semibold text-ink" : i < step ? "border-petrol/40 text-ink-2" : "border-line text-ink-3"}`}>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${i < step ? "bg-petrol text-white" : i === step ? "border border-petrol text-petrol" : "border border-line-strong"}`}>
                {i < step ? <Check className="size-3" aria-label="done" /> : i + 1}
              </span>
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ol>

        <h1 ref={heading} tabIndex={-1} className="text-[20px] font-semibold text-ink outline-none">
          {stepName === "Administrator" && "Create the administrator"}
          {stepName === "Companies" && "Add the companies of the group"}
          {stepName === "Project" && "Plan the NIS2 project"}
          {stepName === "Roles" && "Choose the project roles"}
          {stepName === "Review" && "Review and finish"}
        </h1>

        {banner && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-alarm/30 bg-alarm-50 px-3 py-2 text-[13px] text-alarm">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{banner}</span>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        )}

        {stepName === "Administrator" && (
          <Section title="Administrator" bodyClassName="grid gap-3 sm:grid-cols-2">
            <p className="text-[13px] text-ink-3 sm:col-span-2">
              This account administers the tool: users, roles, entities and settings. Everything else is set up afterwards.
            </p>
            <TextField id="setup-token" label="Setup token" className="sm:col-span-2 [&_input]:font-mono" value={token} maxLength={200}
              autoComplete="off" spellCheck={false} error={errors["setup_token"]}
              hint={<>Shown in the server log: <Code>docker compose logs app</Code></>}
              onChange={(e) => { setToken(e.target.value); clearError("setup_token") }} />
            <TextField id="adm-name" label="Name" value={admin.display_name} maxLength={200} autoComplete="name" error={errors["admin.display_name"]}
              onChange={(e) => setA("display_name", e.target.value)} />
            <TextField id="adm-email" label="E-mail" type="email" value={admin.email} maxLength={320} autoComplete="username" error={errors["admin.email"]}
              onChange={(e) => setA("email", e.target.value)} />
            <TextField id="adm-password" label="Password" type="password" value={admin.password} autoComplete="new-password" error={errors["admin.password"]}
              hint={`At least ${opts.password_min_length} characters, using at least three of: lowercase, uppercase, digit, symbol.`}
              onChange={(e) => setA("password", e.target.value)} />
            <TextField id="adm-repeat" label="Repeat password" type="password" value={admin.repeat} autoComplete="new-password" error={errors["admin.repeat"]}
              onChange={(e) => setA("repeat", e.target.value)} />
          </Section>
        )}

        {stepName === "Companies" && (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-3">One entry per legal entity. Exactly one is the headquarters. Authority and CSIRT follow from the country.</p>
            {errors["companies"] && <ErrorText id="companies-error">{errors["companies"]}</ErrorText>}
            {companies.map((c, i) => {
              const p = `co${c.key}`
              const err = (f: string) => errors[`companies.${i}.${f}`]
              const forms = jurisdiction(c.country)?.legal_forms ?? []
              return (
                <Section key={c.key} title={`Company ${i + 1}`}
                  actions={companies.length > 1 ? (
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove company ${i + 1}`} onClick={() => remove(i)}><Trash2 /></Button>
                  ) : undefined}>
                  <div role="group" aria-label={`Company ${i + 1}`} className="grid gap-3 sm:grid-cols-6">
                    <TextField id={`${p}-name`} label="Company name" hint="Full legal name" className="sm:col-span-4" value={c.name} maxLength={200}
                      error={err("name")} onChange={(e) => setC(i, "name", e.target.value)} />
                    <TextField id={`${p}-code`} label="Code" hint="Short, e.g. ATL" className="sm:col-span-2 [&_input]:font-mono" value={c.code} maxLength={20}
                      error={err("code")} onChange={(e) => setC(i, "code", e.target.value)} />
                    <Field label="Country" htmlFor={`${p}-country`} className="sm:col-span-2">
                      <OptionSelect id={`${p}-country`} value={c.country} onChange={(v) => setC(i, "country", v)}
                        options={opts.jurisdictions.map((j) => ({ value: j.code, label: j.name }))} />
                      <ErrorText id={`${p}-country-error`}>{err("country")}</ErrorText>
                    </Field>
                    <div className="sm:col-span-4">
                      <TextField id={`${p}-legal`} label="Legal form" list={`${p}-forms`} value={c.legal_form} maxLength={60}
                        error={err("legal_form")} onChange={(e) => setC(i, "legal_form", e.target.value)} />
                      <datalist id={`${p}-forms`}>{forms.map((f) => <option key={f} value={f} />)}</datalist>
                    </div>
                    <Field label="Sector" htmlFor={`${p}-sector`} className="sm:col-span-4">
                      <OptionSelect id={`${p}-sector`} value={c.sector} onChange={(v) => setC(i, "sector", v)}
                        options={opts.sectors.map((s) => ({ value: s.key, label: s.label }))} />
                      <ErrorText id={`${p}-sector-error`}>{err("sector")}</ErrorText>
                    </Field>
                    <Field label="Size class" htmlFor={`${p}-size`} className="sm:col-span-2">
                      <OptionSelect id={`${p}-size`} value={c.size_class} onChange={(v) => setC(i, "size_class", v)}
                        options={opts.size_classes.map((s) => ({ value: s, label: SIZE_LABEL[s] ?? s }))} />
                      <ErrorText id={`${p}-size-error`}>{err("size_class")}</ErrorText>
                    </Field>
                    <div className="sm:col-span-6">
                      <label className="inline-flex items-center gap-2 text-[13px] text-ink">
                        <input type="radio" name="headquarters" className="size-4 accent-petrol" checked={c.is_headquarters}
                          onChange={() => { setHq(i); clearError(`companies.${i}.is_headquarters`) }} />
                        Headquarters
                      </label>
                      <ErrorText id={`${p}-hq-error`}>{err("is_headquarters")}</ErrorText>
                    </div>
                  </div>
                </Section>
              )
            })}
            <Button variant="outline" onClick={add}><Plus /> Add company</Button>
          </div>
        )}

        {stepName === "Project" && (
          <ProjectStep draft={project} plan={plan} errors={errors} recalculated={recalculated} onChange={setProj} onGate={setGate} />
        )}

        {stepName === "Roles" && (
          <RolesStep rows={roles} externalSupport={project.external_support} oidc={opts.oidc_enabled} errors={errors}
            onChange={setRole} onAdd={addRole} onRemove={removeRole} />
        )}

        {stepName === "Review" && (
          <div className="space-y-4">
            <Section title="Administrator">
              <KV label="Name">{admin.display_name.trim()}</KV>
              <KV label="E-mail">{admin.email.trim().toLowerCase()}</KV>
            </Section>
            {companies.map((c) => {
              const j = jurisdiction(c.country)
              return (
                <Section key={c.key} title={<span className="flex flex-wrap items-center gap-2 break-words"><Code>{c.code}</Code>{c.name.trim()}{c.is_headquarters && <Pill tone="neutral">HQ</Pill>}</span>}>
                  <KV label="Country">{j?.name ?? c.country}</KV>
                  <KV label="Legal form">{c.legal_form.trim()}</KV>
                  <KV label="Sector">{sectorLabel(c.sector)}</KV>
                  <KV label="Size class">{SIZE_LABEL[c.size_class ?? ""] ?? c.size_class}</KV>
                  <KV label="Competent authority">{j?.competent_authority}</KV>
                  <KV label="CSIRT">{j?.csirt}</KV>
                </Section>
              )
            })}
            {withPlan && (
              <>
                <Section title="Project">
                  <KV label="Name">{project.name.trim()}</KV>
                  <KV label="Start date">{fmtDate(project.start)}</KV>
                  <KV label="End date">{plan.data ? fmtDate(plan.data.end) : "Calculating…"}</KV>
                  {plan.data?.gates.map((g) => <KV key={g.code} label={g.code}>{fmtDate(g.date)}</KV>)}
                  {plan.data?.warning && <p role="status" className="mt-2 flex items-start gap-2 text-[13px] text-amber"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{plan.data.warning}</p>}
                  {plan.failure && <p role="alert" className="mt-2 text-[13px] text-alarm">{plan.failure}</p>}
                </Section>
                <Section title="Roles">
                  {roles.filter((r) => takesPart(r, project.external_support)).map((r) => (
                    <KV key={r.key} label={r.label.trim()}>{r.email.trim() && opts.oidc_enabled ? r.email.trim() : null}</KV>
                  ))}
                </Section>
              </>
            )}
            <div role="note" className="space-y-2 rounded-md border bg-card px-4 py-3 text-[13px] text-ink-2">
              <p>
                Every requirement starts as in scope and unanswered. Where a subsidiary relies on the headquarters
                (&ldquo;Central at HQ&rdquo;), you answer that later in each assessment.
              </p>
              {!opts.local_enabled && (
                <p className="text-amber">
                  Local sign-in is disabled on this server. This account is the break-glass administrator: it can only sign
                  in after local login is enabled (NIS2_LOCAL_AUTH_ENABLED).
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => { setErrors({}); setBanner(null); setStep(step - 1) }}>Back</Button>
          {stepName !== "Review" ? (
            <Button onClick={next} disabled={stepName === "Project" && !plan.ready}>{steps[step + 1] === "Review" ? "Review" : "Next"}</Button>
          ) : (
            <Button onClick={finish} disabled={busy || (withPlan && !plan.ready)}>{busy ? "Setting up…" : "Finish setup"}</Button>
          )}
        </div>
      </main>
    </div>
  )
}

function blankCompany(key: number, opts: SetupOptions, hq: boolean): Company {
  return { key, name: "", code: "", legal_form: "", country: opts.jurisdictions[0]?.code ?? "", sector: null, size_class: null, is_headquarters: hq }
}
