import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Code, ErrorState, Loading, Pill } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api, qs } from "@/lib/api"
import { LevelLegend, RiskHeatMap } from "./heat-map"
import { LEVEL_LABEL, LEVELS, useCanManageRisk, useThreats, type Level, type RiskMethod, type ScaleStep, type Threat } from "./shared"

type MethodForm = Omit<RiskMethod, "id" | "entity" | "inherited" | "matrix">

function toForm(m: RiskMethod): MethodForm {
  return {
    name: m.name, likelihood_scale: m.likelihood_scale.map((s) => ({ ...s })), impact_scale: m.impact_scale.map((s) => ({ ...s })),
    threshold_medium: m.threshold_medium, threshold_high: m.threshold_high, threshold_very_high: m.threshold_very_high,
    appetite_level: m.appetite_level, acceptance_criteria: m.acceptance_criteria, review_cycle_months: m.review_cycle_months,
  }
}

function matrixOf(f: MethodForm): Level[][] {
  return [1, 2, 3, 4, 5].map((l) => [1, 2, 3, 4, 5].map((i) => {
    const s = l * i
    return s >= f.threshold_very_high ? "very_high" : s >= f.threshold_high ? "high" : s >= f.threshold_medium ? "medium" : "low"
  }))
}

/** Risk method per scope (group default and entity overrides) and the threat catalogue. */
export function MethodSheet({ open, onOpenChange, initialEntityId }: { open: boolean; onOpenChange: (v: boolean) => void; initialEntityId?: number | null }) {
  const [scope, setScope] = useState<string>("group")
  useEffect(() => { if (open) setScope(initialEntityId ? String(initialEntityId) : "group") }, [open, initialEntityId])
  const methods = useQuery({ queryKey: ["risks", "methods"], queryFn: () => api.get<RiskMethod[]>("/risks/methods"), enabled: open })
  const current = methods.data?.find((m) => (scope === "group" ? m.entity == null : m.entity?.id === Number(scope)))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle>Risk method and threat catalogue</SheetTitle>
          <SheetDescription>Written methodology with scales, risk levels and acceptance criteria (Cbb Art. 7, IR 2024/2690 2.1.2). Entities use the group method unless they define their own.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <Tabs defaultValue="method">
            <TabsList>
              <TabsTrigger value="method">Method</TabsTrigger>
              <TabsTrigger value="threats">Threat catalogue</TabsTrigger>
            </TabsList>
            <TabsContent value="method" className="mt-4 space-y-4">
              <Field label="Scope">
                <OptionSelect value={scope} onChange={(v) => setScope(v ?? "group")}
                  options={(methods.data ?? []).map((m) => ({
                    value: m.entity ? String(m.entity.id) : "group",
                    label: m.entity ? `${m.entity.code} ${m.entity.name}${m.inherited ? " (uses group method)" : ""}` : "Group default",
                  }))} />
              </Field>
              {methods.isLoading ? <Loading className="p-0" /> : methods.error ? <ErrorState error={methods.error} /> : current ? (
                <MethodEditor key={`${scope}-${current.id}-${current.inherited}`} method={current} entityId={scope === "group" ? null : Number(scope)} />
              ) : null}
            </TabsContent>
            <TabsContent value="threats" className="mt-4">
              <ThreatCatalogue />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MethodEditor({ method, entityId }: { method: RiskMethod; entityId: number | null }) {
  const qc = useQueryClient()
  const canManage = useCanManageRisk()(entityId)
  const [form, setForm] = useState<MethodForm>(toForm(method))
  const [error, setError] = useState<string | null>(null)
  const inherited = method.inherited
  const editable = canManage && !inherited
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(method))
  const preview: RiskMethod = useMemo(() => ({ ...method, ...form, matrix: matrixOf(form) }), [method, form])
  const invalidate = () => qc.invalidateQueries({ queryKey: ["risks"] })
  const put = useMutation({
    mutationFn: (v: { body: MethodForm; msg: string }) => api.put<RiskMethod>(`/risks/methods${qs({ entity_id: entityId ?? undefined })}`, v.body),
    onMutate: () => setError(null),
    onSuccess: (_r, v) => { toast.success(v.msg); invalidate() },
    onError: (e: Error) => setError(e.message),
  })
  const removeOverride = useMutation({
    mutationFn: () => api.del("/risks/methods", { entity_id: entityId }),
    onSuccess: () => { toast.success("The entity now uses the group method"); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const setScale = (key: "likelihood_scale" | "impact_scale", idx: number, patch: Partial<ScaleStep>) =>
    setForm((f) => ({ ...f, [key]: f[key].map((s, i) => (i === idx ? { ...s, ...patch } : s)) }))
  const thresholdsOk = form.threshold_medium < form.threshold_high && form.threshold_high < form.threshold_very_high

  return (
    <div className="space-y-4">
      {inherited && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-[13px] text-ink-2">
          <span>This entity uses the group method.</span>
          {canManage && <Button size="sm" variant="outline" disabled={put.isPending} onClick={() => put.mutate({ body: { ...form, name: `Risk method ${method.entity?.code ?? ""}`.trim() }, msg: "Entity method created" })}>Define an entity method</Button>}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Field label="Name" htmlFor="m-name">
            <Input id="m-name" value={form.name} disabled={!editable} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Medium from score" htmlFor="m-tm">
              <Input id="m-tm" type="number" min={2} max={25} value={form.threshold_medium} disabled={!editable} onChange={(e) => setForm({ ...form, threshold_medium: Number(e.target.value) })} />
            </Field>
            <Field label="High from score" htmlFor="m-th">
              <Input id="m-th" type="number" min={3} max={25} value={form.threshold_high} disabled={!editable} onChange={(e) => setForm({ ...form, threshold_high: Number(e.target.value) })} />
            </Field>
            <Field label="Very high from score" htmlFor="m-tv">
              <Input id="m-tv" type="number" min={4} max={25} value={form.threshold_very_high} disabled={!editable} onChange={(e) => setForm({ ...form, threshold_very_high: Number(e.target.value) })} />
            </Field>
          </div>
          {!thresholdsOk && <p className="text-[12.5px] text-alarm">Thresholds must increase: medium below high below very high.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Risk appetite" hint="Highest residual level that may be accepted without a management body decision">
              <OptionSelect value={form.appetite_level} disabled={!editable} onChange={(v) => setForm({ ...form, appetite_level: (v ?? "medium") as Level })}
                options={LEVELS.map((lv) => ({ value: lv, label: LEVEL_LABEL[lv] }))} />
            </Field>
            <Field label="Review cycle (months)" htmlFor="m-cycle" hint="IR 2024/2690 2.1.4: at least annually">
              <Input id="m-cycle" type="number" min={1} max={36} value={form.review_cycle_months} disabled={!editable} onChange={(e) => setForm({ ...form, review_cycle_months: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
        <div className="space-y-2">
          <RiskHeatMap method={preview} size="sm" />
          <LevelLegend method={preview} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(["likelihood_scale", "impact_scale"] as const).map((key) => (
          <fieldset key={key} className="space-y-2">
            <legend className="mb-1 text-[12.5px] font-medium text-ink-2">{key === "likelihood_scale" ? "Likelihood scale" : "Impact scale"}</legend>
            {form[key].map((s, i) => (
              <div key={i} className="grid grid-cols-[20px_120px_minmax(0,1fr)] items-start gap-2">
                <span className="tabular pt-2 text-[12.5px] text-ink-3">{i + 1}</span>
                <Input aria-label={`${key === "likelihood_scale" ? "Likelihood" : "Impact"} ${i + 1} label`} value={s.label} disabled={!editable} maxLength={60}
                  onChange={(e) => setScale(key, i, { label: e.target.value })} />
                <Textarea aria-label={`${key === "likelihood_scale" ? "Likelihood" : "Impact"} ${i + 1} description`} rows={2} value={s.description ?? ""} disabled={!editable} maxLength={500}
                  className="min-h-9 text-[12.5px]" onChange={(e) => setScale(key, i, { description: e.target.value })} />
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      <Field label="Risk acceptance criteria" htmlFor="m-acc">
        <Textarea id="m-acc" rows={5} value={form.acceptance_criteria ?? ""} disabled={!editable} onChange={(e) => setForm({ ...form, acceptance_criteria: e.target.value })} />
      </Field>

      {error && <ErrorState error={error} />}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={put.isPending || !dirty || !thresholdsOk || !form.name.trim() || form.likelihood_scale.some((s) => !s.label.trim()) || form.impact_scale.some((s) => !s.label.trim())}
            onClick={() => put.mutate({ body: { ...form, acceptance_criteria: form.acceptance_criteria?.trim() || null }, msg: "Risk method saved" })}>
            Save method
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setForm(toForm(method))}>Discard</Button>}
          {entityId != null && (
            <Confirm trigger={<Button variant="ghost" className="ml-auto text-alarm hover:text-alarm">Use group method instead</Button>}
              title="Remove the entity method?" confirmLabel="Remove entity method"
              description="Risks of this entity are rated with the group method afterwards. Levels of existing risks may change."
              onConfirm={() => removeOverride.mutate()} />
          )}
        </div>
      )}
      {!canManage && <p className="text-[12.5px] text-ink-3">You can view the method. Changing it needs the permission to manage risks {entityId ? "of this entity" : "group-wide"}.</p>}
    </div>
  )
}

function ThreatCatalogue() {
  const qc = useQueryClient()
  const { canGlobal } = useAuth()
  const canEdit = canGlobal("risks.manage")
  const threats = useThreats(true)
  const [q, setQ] = useState("")
  const [draft, setDraft] = useState({ code: "", title: "", category: "Industrial control systems" })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["risks", "threats"] })
  const add = useMutation({
    mutationFn: () => api.post<Threat>("/risks/threats", { ...draft, source: "Group catalogue", is_active: true }),
    onSuccess: (t) => { toast.success(`${t.code} added`); setDraft({ ...draft, code: "", title: "" }); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (t: Threat) => api.put<Threat>(`/risks/threats/${t.id}`, { code: t.code, title: t.title, category: t.category, source: t.source, is_active: !t.is_active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })
  const rows = (threats.data ?? []).filter((t) => !q.trim() || `${t.code} ${t.title} ${t.category}`.toLowerCase().includes(q.trim().toLowerCase()))
  const categories = [...new Set((threats.data ?? []).map((t) => t.category))]
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">All-hazards catalogue: the BSI elementary threats G 0.1 to G 0.47 and threats to industrial control systems. Titles only.</p>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threats" aria-label="Search threats" />
      {threats.isLoading ? <Loading className="p-0" /> : threats.error ? <ErrorState error={threats.error} /> : (
        <ul className="divide-y rounded-md border">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
              <Code className="w-14 shrink-0">{t.code}</Code>
              <span className={t.is_active ? "min-w-0 flex-1 text-ink" : "min-w-0 flex-1 text-ink-3 line-through"}>{t.title}</span>
              <Pill tone="outline" className="hidden sm:inline-flex">{t.category === "Industrial control systems" ? "OT" : t.category}</Pill>
              {canEdit && (
                <Switch checked={t.is_active} onCheckedChange={() => toggle.mutate(t)} aria-label={`${t.is_active ? "Deactivate" : "Activate"} ${t.code}`} />
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-3">No threat matches.</li>}
        </ul>
      )}
      {canEdit && (
        <form className="grid grid-cols-[110px_minmax(0,1fr)_190px_auto] items-end gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); if (draft.code.trim() && draft.title.trim()) add.mutate() }}>
          <Field label="Code" htmlFor="t-code"><Input id="t-code" value={draft.code} maxLength={20} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="OT-15" /></Field>
          <Field label="Title" htmlFor="t-title"><Input id="t-title" value={draft.title} maxLength={300} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Category">
            <OptionSelect value={draft.category} onChange={(v) => setDraft({ ...draft, category: v ?? "Industrial control systems" })}
              options={categories.length ? categories : ["Elementary threat", "Industrial control systems"]} />
          </Field>
          <Button type="submit" variant="outline" disabled={!draft.code.trim() || !draft.title.trim() || add.isPending}><Plus /> Add threat</Button>
        </form>
      )}
    </div>
  )
}
