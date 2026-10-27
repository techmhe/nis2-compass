import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EntityTag, ErrorState, Pill } from "@/components/common/basics"
import { Field, OptionSelect, Segmented } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LawRef } from "./guidance"
import {
  type Affected, type Answer, type Citation, type CriteriaCatalogue, eur, evaluate, type Recurring, type ReportingOverview,
  type Result, RESULT_LABEL,
} from "./reporting-types"
import { fromLocalInput, toLocalInput } from "./shared"

export function useCriteria() {
  return useQuery({ queryKey: ["incident-criteria"], queryFn: () => api.get<CriteriaCatalogue>("/incident-reporting/criteria"), staleTime: Infinity })
}

export function Cite({ c }: { c: Citation }) {
  if (c.code && c.key) return <LawRef code={c.code} k={c.key}>{c.label}</LawRef>
  if (c.url) {
    return (
      <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[12px] text-petrol hover:underline">
        {c.label}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
      </a>
    )
  }
  return <span className="font-mono text-[12px]">{c.label}</span>
}

export function ResultPill({ result }: { result: Result }) {
  return <Pill tone={result === "significant" ? "alarm" : result === "not_significant" ? "neutral" : "amber"}>{RESULT_LABEL[result]}</Pill>
}

const ANSWER_OPTIONS = ["Yes", "No", "Unknown"] as const
const toAnswer = (v: string | null): Answer | undefined => (v === "Yes" ? "yes" : v === "No" ? "no" : v === "Unknown" ? "unknown" : undefined)
const fromAnswer = (a?: Answer) => (a === "yes" ? "Yes" : a === "no" ? "No" : a === "unknown" ? "Unknown" : null)

/** Latest assessment per affected entity, with the button that opens the wizard. */
export function SignificancePanel({ data, awareAt, onChanged }: { data: ReportingOverview; awareAt: string | null; onChanged: (o: ReportingOverview) => void }) {
  const [wizard, setWizard] = useState<Affected | null>(null)
  const [history, setHistory] = useState(false)
  const unsupported = data.affected.filter((a) => !a.jurisdiction)
  return (
    <div className="space-y-3">
      {data.affected.length === 0 && <p className="text-[13px] text-ink-3">Group-wide incident: add the affected entities under scope and root cause to assess significance per entity.</p>}
      {data.affected.filter((a) => a.jurisdiction).map((a) => {
        const l = a.latest_assessment
        return (
          <div key={a.entity.id} className={cn("rounded-md border px-3 py-2.5", l?.result === "significant" && "border-alarm/40 bg-alarm-50/30")}>
            <div className="flex flex-wrap items-center gap-2">
              <EntityTag code={a.entity.code} name={a.entity.name} />
              <span className="text-[13px] font-medium text-ink">{a.entity.name}</span>
              <span className="text-[12px] text-ink-3">{a.jurisdiction === "DE" ? "Germany, BSIG" : "Netherlands, Cbw"}</span>
              <span className="flex-1" />
              {l ? <ResultPill result={l.result} /> : <Pill tone="amber">Not assessed</Pill>}
              {a.can_edit && (
                <Button size="xs" variant={l ? "outline" : "default"} onClick={() => setWizard(a)}>{l ? "Reassess" : "Assess significance"}</Button>
              )}
            </div>
            {l && (
              <div className="mt-1.5 space-y-1 text-[12.5px] text-ink-2">
                {l.met_criteria.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5"><span className="text-ink-3">Criteria met:</span>{l.met_criteria.map((m) => <span key={m.key} className="font-mono text-[12px]">{m.label}</span>)}</div>
                )}
                {l.result !== l.suggested_result && <div className="text-amber">Decision differs from the suggested result ({RESULT_LABEL[l.suggested_result]}).</div>}
                {l.rationale && <p className="whitespace-pre-line">{l.rationale}</p>}
                <div className="text-[12px] text-ink-3">Decided by {l.decided_by ?? "unknown"}, {fmtDateTime(l.decided_at)}</div>
              </div>
            )}
          </div>
        )
      })}
      {unsupported.length > 0 && (
        <p className="text-[12.5px] text-ink-3">
          {unsupported.map((a) => a.entity.code).join(", ")}: the wizard covers entities in Germany and the Netherlands only. Record the assessment in the significance rationale.
        </p>
      )}
      {data.assessments.length > data.affected.filter((a) => a.latest_assessment).length && (
        <div>
          <Button size="xs" variant="ghost" onClick={() => setHistory((v) => !v)}>{history ? "Hide earlier assessments" : `Show all ${data.assessments.length} assessments`}</Button>
          {history && (
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {data.assessments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-ink-2">
                  <span className="tabular text-ink-3">{fmtDateTime(a.decided_at)}</span><EntityTag code={a.entity.code} /><ResultPill result={a.result} />
                  <span>{a.decided_by}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {wizard && <WizardDialog incidentId={data.incident_id} affected={wizard} recurring={data.recurring} loss={data.profile.financial_loss_eur}
        awareAt={awareAt} onClose={() => setWizard(null)} onSaved={(o) => { setWizard(null); onChanged(o) }} />}
    </div>
  )
}

function WizardDialog({ incidentId, affected, recurring, loss, awareAt, onClose, onSaved }: {
  incidentId: number; affected: Affected; recurring: Recurring | null; loss: number | null; awareAt: string | null
  onClose: () => void; onSaved: (o: ReportingOverview) => void
}) {
  const cat = useCriteria()
  const juris = affected.jurisdiction!
  const prev = affected.latest_assessment
  const [profile, setProfile] = useState(prev?.sector_profile ?? affected.default_profile)
  const [answers, setAnswers] = useState<Record<string, Answer>>(prev?.answers ?? {})
  const [rationale, setRationale] = useState(prev?.rationale ?? "")
  const [override, setOverride] = useState<Result | null>(null)
  const [aware, setAware] = useState(toLocalInput(awareAt ?? new Date().toISOString()))
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => (cat.data?.criteria[juris] ?? []).filter((g) => g.profiles.includes(profile)), [cat.data, juris, profile])
  const keys = new Set(groups.flatMap((g) => g.criteria.map((c) => c.key)))
  const scoped = Object.fromEntries(Object.entries(answers).filter(([k]) => keys.has(k)))
  const suggested = evaluate(groups, scoped)
  const result = override ?? suggested
  const note = cat.data?.profile_notes[`${juris}:${profile}`]
  const unanswered = groups.flatMap((g) => g.criteria).filter((c) => !scoped[c.key]).length
  const save = useMutation({
    mutationFn: () => api.post<ReportingOverview>(`/incident-reporting/incidents/${incidentId}/assessments`, {
      entity_id: affected.entity.id, sector_profile: profile, answers: scoped, rationale: rationale.trim() || null,
      result: override && override !== suggested ? override : null,
      aware_at: !awareAt && result === "significant" ? fromLocalInput(aware) : null,
    }),
    onMutate: () => setError(null),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  })
  const needsRationale = override != null && override !== suggested && rationale.trim().length < 10
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Significance of the incident for {affected.entity.code}</DialogTitle>
          <DialogDescription>
            {juris === "DE"
              ? "Germany (BSIG). Answer each criterion; one yes makes the incident significant unless the exclusion applies. Unknown keeps the result undetermined; decide quickly, the early warning is due 24 hours after becoming aware."
              : "Netherlands (Cyberbeveiligingswet). Answer each criterion; one yes makes the incident significant unless the exclusion applies. Unknown keeps the result undetermined; decide quickly, the early warning is due 24 hours after becoming aware."}
          </DialogDescription>
        </DialogHeader>
        {cat.isLoading ? <p className="text-[13px] text-ink-3">Loading criteria…</p> : cat.error ? <ErrorState error={cat.error} /> : (
          <div className="space-y-4">
            {affected.sector_profiles.length > 1 && (
              <Field label="Sector" hint={affected.sector ? `Entity sector: ${affected.sector}` : undefined}>
                <OptionSelect value={profile} onChange={(v) => setProfile(v ?? profile)} options={affected.sector_profiles.map((p) => ({ value: p.key, label: p.label }))} />
              </Field>
            )}
            {note && <p className="rounded-md border border-amber/40 bg-amber-50/50 px-3 py-2 text-[12.5px] text-ink-2">{note}</p>}
            {groups.map((g) => (
              <fieldset key={g.key} className="rounded-md border">
                <legend className="ml-3 px-1 text-[13px] font-semibold text-ink">{g.title}</legend>
                <div className="px-3 pb-2">
                  {(g.intro || g.source) && (
                    <p className="mb-2 text-[12.5px] text-ink-3">{g.intro} {g.source && <span>Source: <Cite c={g.source} /></span>}</p>
                  )}
                  <ul className="divide-y">
                    {g.criteria.map((c) => (
                      <li key={c.key} className="grid gap-2 py-2 sm:grid-cols-[1fr_auto] sm:items-start">
                        <div>
                          <div className="text-[13px] font-medium text-ink">{c.kind === "exclusion" ? `Exclusion: ${c.label}` : c.label}</div>
                          <p className="text-[12.5px] text-ink-2">{c.detail}</p>
                          <div className="mt-0.5"><Cite c={c.ref} /></div>
                          {c.uses_threshold && (
                            <p className="mt-1 text-[12px] text-ink-3">
                              Threshold for {affected.entity.code}: <span className="tabular text-ink-2">{eur(affected.threshold_eur)}</span>
                              {affected.turnover_known ? "" : " (turnover not recorded, EUR 500,000 applies)"}.
                              {loss != null && <> Estimated loss so far: <span className={cn("tabular", loss > affected.threshold_eur ? "text-alarm" : "text-ink-2")}>{eur(loss)}</span>.</>}
                            </p>
                          )}
                          {c.uses_recurring && recurring && (
                            <p className="mt-1 text-[12px] text-ink-3">
                              {recurring.count} incidents with root cause “{recurring.category_label}” within 6 months, combined loss {eur(recurring.combined_loss_eur)}
                              {recurring.meets_financial_criterion ? " (above the threshold)" : " (below the threshold)"}.
                            </p>
                          )}
                        </div>
                        <Segmented size="sm" value={fromAnswer(scoped[c.key])} options={ANSWER_OPTIONS}
                          toneOf={(v) => (v === "Yes" ? (c.kind === "exclusion" ? "var(--ink-2)" : "var(--alarm)") : v === "No" ? "var(--petrol)" : "var(--amber)")}
                          onChange={(v) => setAnswers((s) => { const n = { ...s }; const a = toAnswer(v); if (a) n[c.key] = a; else delete n[c.key]; return n })} />
                      </li>
                    ))}
                  </ul>
                </div>
              </fieldset>
            ))}
            <div className="rounded-md border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-ink-2">Suggested result:</span><ResultPill result={suggested} />
                {unanswered > 0 && <span className="text-[12px] text-ink-3">{unanswered} criteria not answered</span>}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Decision" hint="Deviating from the suggestion needs a rationale">
                  <OptionSelect value={override ?? "__suggested"} onChange={(v) => setOverride(v === "__suggested" || !v ? null : (v as Result))}
                    options={[{ value: "__suggested", label: `Follow the suggestion (${RESULT_LABEL[suggested]})` },
                      ...(["significant", "not_significant", "undetermined"] as Result[]).filter((r) => r !== suggested).map((r) => ({ value: r, label: RESULT_LABEL[r] }))]} />
                </Field>
                {!awareAt && result === "significant" && (
                  <Field label="Became aware at" htmlFor="wiz-aware" hint="Starts the 24 h and 72 h deadlines">
                    <Input id="wiz-aware" type="datetime-local" value={aware} onChange={(e) => setAware(e.target.value)} />
                  </Field>
                )}
                <Field label="Rationale" className="sm:col-span-2" htmlFor="wiz-rationale">
                  <Textarea id="wiz-rationale" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)}
                    placeholder="Facts behind the answers, e.g. affected services, duration, data concerned" />
                </Field>
              </div>
              {result === "significant" && <p className="mt-2 text-[12.5px] text-ink-2">Saving opens the reporting track to the {juris === "DE" ? "BSI" : "CSIRT and competent authority"} for {affected.entity.code}.</p>}
            </div>
            {error && <ErrorState error={error} />}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending || !cat.data || needsRationale} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : `Save assessment: ${RESULT_LABEL[result].toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
