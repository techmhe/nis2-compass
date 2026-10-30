import { useMemo, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CalendarCheck, ChevronLeft, MoreHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, KV, Loading, PageHeader, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, DocumentLinks, Markdown } from "@/components/common/collab"
import { WritingHelp } from "@/components/ai/writing-help"
import { Combo, EntitySelect, Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { ApprovalPanel } from "@/components/approvals/approval-panel"
import { ApprovalStatePill } from "@/components/approvals/shared"
import { RiskHeatMap } from "@/components/risks/heat-map"
import { RiskLinkList } from "@/components/risks/links"
import { MethodSheet } from "@/components/risks/method-sheet"
import { RatingPicker } from "@/components/risks/rating"
import {
  aboveAppetite, LEVEL_LABEL, LevelPill, levelOf, RiskStatusPill, STATUS_LABEL, TREATMENT_HINT, TREATMENT_LABEL, useRiskMeta, useThreats,
  type Risk, type RiskDetail, type RiskStatus, type Treatment,
} from "@/components/risks/shared"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { fmtDate, fmtDateTime, fromNow } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Form {
  title: string
  scenario: string
  entity_id: number | null
  threat_id: number | null
  category: string | null
  owner_user_id: number | null
  owner_stakeholder_id: number | null
  inherent_likelihood: number | null
  inherent_impact: number | null
  existing_controls: string
  residual_likelihood: number | null
  residual_impact: number | null
  treatments: Treatment[]
  treatment_justification: string
  acceptance_category: string | null
  status: RiskStatus
  next_review_date: string | null
}

const TREATMENTS: Treatment[] = ["reduce", "avoid", "transfer", "accept"]
const EDITABLE_STATUS: RiskStatus[] = ["identified", "assessed", "in_treatment", "closed"]
const ACCEPT_FIELDS: (keyof Form)[] = ["residual_likelihood", "residual_impact", "treatments", "acceptance_category"]

function formOf(r: Risk): Form {
  return {
    title: r.title, scenario: r.scenario ?? "", entity_id: r.entity?.id ?? null, threat_id: r.threat?.id ?? null,
    category: r.category, owner_user_id: r.owner_user?.id ?? null, owner_stakeholder_id: r.owner_stakeholder?.id ?? null,
    inherent_likelihood: r.inherent_likelihood, inherent_impact: r.inherent_impact, existing_controls: r.existing_controls ?? "",
    residual_likelihood: r.residual_likelihood, residual_impact: r.residual_impact, treatments: r.treatments,
    treatment_justification: r.treatment_justification ?? "", acceptance_category: r.acceptance_category, status: r.status,
    next_review_date: r.next_review_date,
  }
}

export default function RiskPage() {
  const { id } = useParams()
  const riskId = Number(id)
  const q = useQuery({ queryKey: ["risks", "detail", riskId], queryFn: () => api.get<RiskDetail>(`/risks/${riskId}`), enabled: Number.isFinite(riskId) })
  if (q.isLoading) return <Loading />
  if (q.error) {
    return (
      <div>
        <BackLink />
        <ErrorState error={(q.error as ApiError).status === 404 ? "This risk does not exist or you have no access to it." : q.error} />
      </div>
    )
  }
  if (!q.data) return null
  return <RiskView key={q.data.risk.id} data={q.data} />
}

function BackLink() {
  return (
    <Link to="/risks" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol">
      <ChevronLeft className="size-3.5" /> Risks
    </Link>
  )
}

function RiskView({ data }: { data: RiskDetail }) {
  const { risk, method, links, documents, can_edit: canEdit } = data
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can, canAny } = useAuth()
  const meta = useRiskMeta()
  const threats = useThreats()
  const initial = useMemo(() => formOf(risk), [risk])
  const [form, setForm] = useState<Form>(initial)
  // the risk was reloaded (save, review, link that changed the status): keep unsaved edits, take the rest from the server
  const [prevInitial, setPrevInitial] = useState(initial)
  if (prevInitial !== initial) {
    setPrevInitial(initial)
    setForm((f) => {
      const next = { ...initial }
      for (const k of Object.keys(f) as (keyof Form)[]) {
        if (JSON.stringify(f[k]) !== JSON.stringify(prevInitial[k])) (next as Record<string, unknown>)[k] = f[k]
      }
      return next
    })
  }
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirtyKeys = (Object.keys(form) as (keyof Form)[]).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k]))
  const dirty = dirtyKeys.length > 0
  const lapses = risk.status === "accepted" && dirtyKeys.some((k) => ACCEPT_FIELDS.includes(k))

  const refresh = () => qc.invalidateQueries({ queryKey: ["risks"] })
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      for (const k of dirtyKeys) {
        const v = form[k]
        body[k] = typeof v === "string" && k !== "status" ? (v.trim() || (k === "title" ? v : null)) : v
      }
      return api.patch<RiskDetail>(`/risks/${risk.id}`, body)
    },
    onMutate: () => setError(null),
    onSuccess: (d) => {
      toast.success("Risk saved")
      setForm(formOf(d.risk))
      qc.setQueryData(["risks", "detail", risk.id], d)
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/risks/${risk.id}`),
    onSuccess: () => { toast.success(`${risk.code} deleted`); qc.removeQueries({ queryKey: ["risks", "detail", risk.id] }); refresh(); navigate("/risks") },
    onError: (e: Error) => toast.error(e.message),
  })

  const inhLevel = levelOf(method, form.inherent_likelihood, form.inherent_impact)
  const resLevel = levelOf(method, form.residual_likelihood, form.residual_impact)
  const above = aboveAppetite(method, resLevel)
  const transferOnly = form.treatments.length === 1 && form.treatments[0] === "transfer"
  const accepting = form.treatments.includes("accept")
  const acceptanceMissing = !accepting ? "Choose the treatment option Accept first."
    : !form.residual_likelihood || !form.residual_impact ? "Rate the residual likelihood and impact first."
      : !form.acceptance_category ? "Choose a justification category first."
        : !form.treatment_justification.trim() ? "Describe the justification first."
          : dirty ? "Save your changes first." : null

  const ro = !canEdit
  return (
    <div className="pb-16">
      <BackLink />
      <PageHeader
        title={<span className="flex items-baseline gap-3"><Code className="text-[15px]">{risk.code}</Code><span>{risk.title}</span></span>}
        actions={canEdit && (
          <>
            <Button variant="outline" onClick={() => setReviewOpen(true)}><CalendarCheck /> Mark as reviewed</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-alarm focus:text-alarm" disabled={risk.status === "accepted"} onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete risk
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
          {risk.entity ? <EntityTag code={risk.entity.code} name={risk.entity.name} /> : <span>Group-wide</span>}
          <RiskStatusPill status={risk.status} />
          <span className="inline-flex items-center gap-1.5">Residual <LevelPill level={risk.residual_level} score={risk.residual_score} /></span>
          {risk.above_appetite && <Pill tone="alarm">Above risk appetite</Pill>}
          {risk.acceptance_state !== "none" && <span className="inline-flex items-center gap-1.5">Acceptance <ApprovalStatePill state={risk.acceptance_state} /></span>}
          {risk.review_overdue && <Pill tone="alarm">Review overdue since {fmtDate(risk.next_review_date)}</Pill>}
        </div>
      </PageHeader>

      {canEdit && dirty && (
        <div className="sticky top-[64px] z-20 mb-4 flex flex-wrap items-center gap-3 rounded-md border border-petrol/40 bg-petrol-50 px-4 py-2 text-[13px] text-petrol">
          <span className="flex-1">
            You have unsaved changes.
            {lapses && <span className="ml-1 font-medium text-alarm">Saving ends the current acceptance: the residual rating or treatment changes.</span>}
          </span>
          <Button size="sm" variant="ghost" onClick={() => { setForm(initial); setError(null) }}>Discard</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !form.title.trim()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
      )}
      {error && <ErrorState error={error} className="mb-4" />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Section title="Scenario">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title" className="col-span-2" htmlFor="r-title">
                <Input id="r-title" value={form.title} maxLength={400} disabled={ro} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Scenario" className="col-span-2" htmlFor="r-scen" action={<WritingHelp target={{ type: "risk", id: risk.id }} field="scenario" value={form.scenario} onApply={(t) => set("scenario", t)} autosave={false} disabled={ro} />} hint="Threat, vulnerability and consequence for the services of the entity.">
                {ro ? <Markdown className="prose-md text-[13.5px]">{risk.scenario || "–"}</Markdown>
                  : <Textarea id="r-scen" rows={5} value={form.scenario} onChange={(e) => set("scenario", e.target.value)} />}
              </Field>
              <Field label="Threat">
                <Combo value={form.threat_id} onChange={(v) => set("threat_id", v)} disabled={ro} placeholder="Choose from the catalogue…" searchPlaceholder="Search code or title"
                  items={(threats.data ?? []).map((t) => ({ value: t.id, label: `${t.code} ${t.title}`, hint: t.category === "Industrial control systems" ? "OT" : undefined }))} />
              </Field>
              <Field label="Category">
                <OptionSelect value={form.category} onChange={(v) => set("category", v)} disabled={ro} allowNone noneLabel="No category" options={meta.data?.categories ?? (form.category ? [form.category] : [])} />
              </Field>
              <Field label="Entity">
                <EntitySelect value={form.entity_id} onChange={(v) => set("entity_id", v)} disabled={ro} groupLabel="Group-wide risk" />
              </Field>
              <Field label="Risk owner">
                <UserSelect value={form.owner_user_id} onChange={(v) => set("owner_user_id", v)} disabled={ro} placeholder="Owner…" />
              </Field>
              <Field label="Owner role" className="col-span-2" hint="Optional: the role that owns the risk, e.g. when the person changes">
                <StakeholderSelect value={form.owner_stakeholder_id} onChange={(v) => set("owner_stakeholder_id", v)} disabled={ro} placeholder="Role…" />
              </Field>
            </div>
          </Section>

          <div data-tour="risks.assessment">
          <Section title="Assessment" actions={<button className="text-[12.5px] text-petrol hover:underline" onClick={() => setMethodOpen(true)}>{method.inherited ? "Group method" : method.name}</button>}>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-5">
                <RatingBlock title="Inherent risk" hint="Without the existing controls" level={inhLevel} score={score(form.inherent_likelihood, form.inherent_impact)}>
                  <RatingPicker id="inh-l" label="Likelihood" scale={method.likelihood_scale} value={form.inherent_likelihood} onChange={(v) => set("inherent_likelihood", v)} disabled={ro} />
                  <RatingPicker id="inh-i" label="Impact" scale={method.impact_scale} value={form.inherent_impact} onChange={(v) => set("inherent_impact", v)} disabled={ro} />
                </RatingBlock>
                <div className="space-y-2">
                  <Field label="Existing controls" htmlFor="r-ctrl" action={<WritingHelp target={{ type: "risk", id: risk.id }} field="existing_controls" value={form.existing_controls} onApply={(t) => set("existing_controls", t)} autosave={false} disabled={ro} />}>
                    {ro ? <Markdown className="prose-md text-[13.5px]">{risk.existing_controls || "–"}</Markdown>
                      : <Textarea id="r-ctrl" rows={3} value={form.existing_controls} onChange={(e) => set("existing_controls", e.target.value)} placeholder="Measures already in place that lower likelihood or impact" />}
                  </Field>
                  <RiskLinkList risk={risk} type="control" links={links} canEdit={canEdit} onChange={refresh} compactEmpty />
                </div>
                <RatingBlock title="Residual risk" hint="With existing controls and the planned treatment" level={resLevel} score={score(form.residual_likelihood, form.residual_impact)}
                  extra={above ? <Pill tone="alarm">Above appetite ({LEVEL_LABEL[method.appetite_level].toLowerCase()})</Pill> : resLevel ? <Pill tone="sage">Within appetite</Pill> : null}>
                  <RatingPicker id="res-l" label="Likelihood" scale={method.likelihood_scale} value={form.residual_likelihood} onChange={(v) => set("residual_likelihood", v)} disabled={ro} />
                  <RatingPicker id="res-i" label="Impact" scale={method.impact_scale} value={form.residual_impact} onChange={(v) => set("residual_impact", v)} disabled={ro} />
                </RatingBlock>
              </div>
              <div className="space-y-2">
                <RiskHeatMap method={method} size="sm" markers={[
                  { l: form.inherent_likelihood, i: form.inherent_impact, label: "I", title: "Inherent risk" },
                  { l: form.residual_likelihood, i: form.residual_impact, label: "R", title: "Residual risk", solid: true },
                ]} />
                <p className="text-[12px] text-ink-3">I = inherent, R = residual position in the matrix of the {method.inherited ? "group method" : `method ${method.name}`}.</p>
              </div>
            </div>
          </Section>
          </div>

          <div data-tour="risks.treatment">
          <Section title="Treatment plan">
            <div className="space-y-4">
              <fieldset>
                <legend className="mb-2 text-[12.5px] font-medium text-ink-2">Treatment options</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TREATMENTS.map((t) => {
                    const checked = form.treatments.includes(t)
                    return (
                      <label key={t} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2", checked ? "border-petrol/50 bg-petrol-50/50" : "bg-surface", ro && "cursor-default")}>
                        <Checkbox checked={checked} disabled={ro} className="mt-0.5"
                          onCheckedChange={(v) => set("treatments", TREATMENTS.filter((x) => (x === t ? v === true : form.treatments.includes(x))))} />
                        <span>
                          <span className="block text-[13px] font-medium text-ink">{TREATMENT_LABEL[t]}</span>
                          <span className="block text-[12px] text-ink-3">{TREATMENT_HINT[t]}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {transferOnly && (
                <Warning>
                  Transfer is the only treatment. Under the BSIG a blanket transfer or acceptance of risk is not permitted for risks that affect the services of the entity (BSI guidance on § 30 BSIG). Combine the transfer with measures that reduce the risk.
                </Warning>
              )}
              <Field label="Justification" htmlFor="r-just" action={<WritingHelp target={{ type: "risk", id: risk.id }} field="treatment_justification" value={form.treatment_justification} onApply={(t) => set("treatment_justification", t)} autosave={false} disabled={ro} />} hint="Why this treatment, and for acceptance: why the residual risk is tolerable">
                {ro ? <Markdown className="prose-md text-[13.5px]">{risk.treatment_justification || "–"}</Markdown>
                  : <Textarea id="r-just" rows={3} value={form.treatment_justification} onChange={(e) => set("treatment_justification", e.target.value)} />}
              </Field>
              {accepting && (
                <Field label="Justification category for the acceptance">
                  <OptionSelect value={form.acceptance_category} onChange={(v) => set("acceptance_category", v)} disabled={ro} allowNone noneLabel="Choose a category"
                    placeholder="Choose a category" options={meta.data?.acceptance_categories ?? []} />
                </Field>
              )}
              <div>
                <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">Treatment measures</h3>
                <RiskLinkList risk={risk} type="treatment" links={links} canEdit={canEdit} onChange={refresh} />
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <Field label="Status" hint={risk.status === "accepted" ? "Accepted through the approval below" : "Accepted is set by the approval of the acceptance"}>
                  <OptionSelect value={form.status} disabled={ro} onChange={(v) => set("status", (v ?? risk.status) as RiskStatus)}
                    options={[...(risk.status === "accepted" ? ["accepted" as RiskStatus] : []), ...EDITABLE_STATUS].map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
                </Field>
              </div>
            </div>
          </Section>
          </div>

          {(accepting || risk.acceptance_state !== "none") && (
            <Section title="Risk acceptance">
              <div className="space-y-3">
                <p className="text-[13px] text-ink-2">
                  A residual risk is accepted through a 4-eyes approval. The approval records the residual rating, the treatment and the justification category. When one of them changes, the acceptance lapses.
                </p>
                {above && (
                  <Warning tone="alarm">
                    The residual risk ({resLevel ? LEVEL_LABEL[resLevel].toLowerCase() : "–"}) is above the risk appetite ({LEVEL_LABEL[method.appetite_level].toLowerCase()}). The acceptance requires a decision of the management body of {risk.entity?.name ?? "the group"}.
                  </Warning>
                )}
                {risk.accepted_at && risk.status === "accepted" && (
                  <p className="text-[13px] text-ink-2">Accepted by <span className="font-medium text-ink">{risk.accepted_by}</span> on {fmtDate(risk.accepted_at)}.</p>
                )}
                <ApprovalPanel bare targetType="risk_acceptance" targetId={risk.id} entityId={risk.entity?.id ?? null}
                  requestLabel="Request acceptance" requestDisabledReason={acceptanceMissing} onChanged={refresh}
                  notice={above ? <Warning tone="alarm">Above the risk appetite: choose a member of the management body as approver or record the board decision.</Warning> : undefined} />
              </div>
            </Section>
          )}

          <div data-tour="risks.links">
          <Section title="Gaps and affected objects">
            <div className="space-y-4">
              <div>
                <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">Gaps from the assessment</h3>
                <RiskLinkList risk={risk} type="gap" links={links} canEdit={canEdit} onChange={refresh} />
              </div>
              <div>
                <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">Affected objects</h3>
                <RiskLinkList risk={risk} type="affected" links={links} canEdit={canEdit} onChange={refresh} />
              </div>
            </div>
          </Section>
          </div>

          <Section title="Comments">
            <CommentsPanel targetType="risk" targetId={risk.id} canComment={risk.entity ? can("risks.manage", risk.entity.id) : canAny("risks.manage")} />
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Review">
            <KV label="Last reviewed">{risk.last_reviewed_at ? fmtDate(risk.last_reviewed_at) : null}</KV>
            <KV label="Next review">
              {ro ? <span className={risk.review_overdue ? "font-medium text-alarm" : undefined}>{fmtDate(risk.next_review_date)}</span>
                : <Input type="date" aria-label="Next review date" value={form.next_review_date ?? ""} onChange={(e) => set("next_review_date", e.target.value || null)} className="h-8" />}
            </KV>
            <KV label="Review cycle">{method.review_cycle_months} months</KV>
            <p className="mt-2 text-[12px] text-ink-3">Risks are reviewed at least annually (IR 2024/2690 2.1.4) and after significant incidents. The owner is reminded when the review is due.</p>
          </Section>
          <Section title="Details">
            <KV label="Owner">{risk.owner_user?.display_name ?? risk.owner_stakeholder?.name}</KV>
            <KV label="Inherent">{<LevelPill level={risk.inherent_level} score={risk.inherent_score} />}</KV>
            <KV label="Residual">{<LevelPill level={risk.residual_level} score={risk.residual_score} />}</KV>
            <KV label="Risk appetite">{LEVEL_LABEL[method.appetite_level]}</KV>
            <KV label="Created">{fmtDate(risk.created_at)}</KV>
            <KV label="Updated">{fromNow(risk.updated_at)}</KV>
          </Section>
          <Section title="Documents">
            <DocumentLinks targetType="risk" targetId={risk.id} documents={documents} entityId={risk.entity?.id ?? null} canEdit={canEdit} onChange={refresh} compact />
          </Section>
          <History riskId={risk.id} />
        </div>
      </div>

      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} risk={risk} cycle={method.review_cycle_months} dirty={dirty}
        onDone={(d) => { qc.setQueryData(["risks", "detail", risk.id], d); refresh() }} />
      <MethodSheet open={methodOpen} onOpenChange={setMethodOpen} initialEntityId={risk.entity?.id ?? null} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {risk.code}?</AlertDialogTitle>
            <AlertDialogDescription>The risk, its links and comments are removed. Pending acceptance requests are closed. Close the risk instead if it should stay on record.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-alarm hover:bg-alarm/90" onClick={() => del.mutate()}>Delete risk</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function score(l: number | null, i: number | null) {
  return l && i ? l * i : null
}

function RatingBlock({ title, hint, level, score, extra, children }: { title: string; hint: string; level: ReturnType<typeof levelOf>; score: number | null; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="text-[12px] text-ink-3">{hint}</span>
        <span className="ml-auto flex items-center gap-2"><LevelPill level={level} score={score} />{extra}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  )
}

function Warning({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "alarm" }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]", tone === "alarm" ? "bg-alarm-50 text-alarm" : "bg-amber-50 text-amber")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function ReviewDialog({ open, onOpenChange, risk, cycle, dirty, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; risk: Risk; cycle: number; dirty: boolean; onDone: (d: RiskDetail) => void
}) {
  const [note, setNote] = useState("")
  const m = useMutation({
    mutationFn: () => api.post<RiskDetail>(`/risks/${risk.id}/review`, { note: note.trim() || null }),
    onSuccess: (d) => { toast.success(`Review recorded, next review ${fmtDate(d.risk.next_review_date)}`); setNote(""); onOpenChange(false); onDone(d) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {risk.code} as reviewed</DialogTitle>
          <DialogDescription>Confirms that scenario, rating and treatment are still correct. The next review is set {cycle} months ahead.</DialogDescription>
        </DialogHeader>
        {dirty && <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber">Save or discard your changes first; the review reloads the risk.</p>}
        <Field label="Review note (optional)" htmlFor="rev-note">
          <Textarea id="rev-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. discussed in the ISMS meeting, no change" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || dirty}>{m.isPending ? "Saving…" : "Record review"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created", update: "Changed", delete: "Deleted", review: "Reviewed", link: "Linked", unlink: "Unlinked",
  approval_requested: "Acceptance requested", approval_approved: "Acceptance approved", approval_rejected: "Acceptance rejected",
  approval_changes_requested: "Changes requested on acceptance", approval_withdrawn: "Acceptance request withdrawn",
}
const FIELD_LABEL: Record<string, string> = {
  title: "title", scenario: "scenario", threat_id: "threat", category: "category", owner_user_id: "owner", owner_stakeholder_id: "owner role",
  inherent_likelihood: "inherent likelihood", inherent_impact: "inherent impact", existing_controls: "existing controls",
  residual_likelihood: "residual likelihood", residual_impact: "residual impact", treatments: "treatment", treatment_justification: "justification",
  acceptance_category: "acceptance category", status: "status", next_review_date: "next review", entity_id: "entity", acceptance_lapsed: "acceptance lapsed",
}

interface HistoryRow { id: number; at: string; action: string; target_type: string; actor: string | null; details: Record<string, unknown> | null }

function History({ riskId }: { riskId: number }) {
  const q = useQuery({ queryKey: ["risks", "history", riskId], queryFn: () => api.get<HistoryRow[]>(`/risks/${riskId}/history`) })
  return (
    <Section title="History">
      {q.isLoading ? <Loading className="p-0" /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? (
        <p className="text-[13px] text-ink-3">No changes recorded yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {q.data.slice(0, 40).map((h) => <HistoryItem key={h.id} h={h} />)}
        </ol>
      )}
    </Section>
  )
}

function HistoryItem({ h }: { h: HistoryRow }) {
  const d = h.details ?? {}
  let text = ""
  if (h.action === "update") {
    const keys = Object.keys(d).filter((k) => FIELD_LABEL[k])
    const status = d.status as [string, string] | undefined
    text = status ? `status ${STATUS_LABEL[status[0] as RiskStatus] ?? status[0]} to ${STATUS_LABEL[status[1] as RiskStatus] ?? status[1]}` : ""
    const rest = keys.filter((k) => k !== "status").map((k) => FIELD_LABEL[k])
    if (rest.length) text = [text, rest.join(", ")].filter(Boolean).join("; ")
  } else if (h.action === "link" || h.action === "unlink") {
    text = `${String(d.link_type ?? "")} ${String(d.target_type ?? "").replace(/_/g, " ")}`.trim()
  } else if (h.action === "review" && d.note) {
    text = String(d.note)
  } else if (h.action.startsWith("approval_") && d.note) {
    text = String(d.note)
  }
  return (
    <li className="text-[12.5px]">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-ink">{ACTION_LABEL[h.action] ?? h.action}</span>
        <span className="ml-auto shrink-0 text-ink-3" title={fmtDateTime(h.at)}>{fromNow(h.at)}</span>
      </div>
      <div className="text-ink-3">{h.actor ?? "System"}{text ? <span className="text-ink-2">: {text}</span> : null}</div>
    </li>
  )
}
