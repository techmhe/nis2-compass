import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Pencil, RefreshCw, Scale, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Meter, Pill, Section } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { useChapters, useRequirements, type RequirementDetailResp } from "@/components/assess/shared"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { govKeys, LegalBadge, legalText, useLegalTags } from "./shared"
import { LEGAL_STATUS_LABEL, type BindingGaps, type EntityProfile, type LegalStatus, type LegalTag, type RequirementLegalResp } from "./types"

const JUR_LABEL: Record<string, string> = { DE: "Germany", NL: "Netherlands", EU: "IR 2024/2690 (digital providers)" }

/* ---------- curation ---------- */

function TagEditor({ tag, provisions, onSaved }: { tag: LegalTag; provisions: RequirementDetailResp["provisions"]; onSaved: () => void }) {
  const [status, setStatus] = useState<LegalStatus>(tag.status)
  const [prov, setProv] = useState<number | null>(tag.basis_provision_id)
  const [label, setLabel] = useState(tag.basis_label ?? "")
  const [note, setNote] = useState(tag.note ?? "")
  const qc = useQueryClient()
  const dirty = status !== tag.status || prov !== tag.basis_provision_id || label !== (tag.basis_label ?? "") || note !== (tag.note ?? "")
  const save = useMutation({
    mutationFn: () => api.patch<LegalTag>(`/governance/legal/${tag.id}`, { status, basis_provision_id: prov, basis_label: label.trim() || null, note: note.trim() || null }),
    onSuccess: () => { toast.success(`${tag.jurisdiction} tag saved`); qc.invalidateQueries({ queryKey: ["gov-legal"] }); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  const relevant = provisions.filter((p) => (tag.jurisdiction === "DE" ? ["BSIG", "STOERFALLV", "NIS2"] : tag.jurisdiction === "NL" ? ["CBW", "CBB"] : ["IR2024/2690"]).includes(p.regulation_code))
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Pill tone="outline">{tag.jurisdiction}</Pill>
        <span className="text-[13px] font-medium">{JUR_LABEL[tag.jurisdiction]}</span>
        {!tag.is_auto && <Pill tone="brass" className="ml-auto">Curated</Pill>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status"><OptionSelect value={status} onChange={(v) => setStatus((v ?? "benchmark") as LegalStatus)} options={(Object.keys(LEGAL_STATUS_LABEL) as LegalStatus[]).map((s) => ({ value: s, label: LEGAL_STATUS_LABEL[s] }))} /></Field>
        <Field label="Basis provision">
          <OptionSelect value={prov != null ? String(prov) : null} onChange={(v) => setProv(v ? Number(v) : null)} allowNone noneLabel="None"
            options={relevant.map((p) => ({ value: String(p.provision_id), label: `${p.regulation_code} ${p.ref}` }))} />
        </Field>
        <Field label="Basis label" hint="Shown on the badge" className="col-span-2" htmlFor={`lbl-${tag.id}`}><Input id={`lbl-${tag.id}`} value={label} onChange={(e) => setLabel(e.target.value)} className="font-mono text-[12.5px]" /></Field>
        <Field label="Note" className="col-span-2" htmlFor={`note-${tag.id}`}><Textarea id={`note-${tag.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-2 flex justify-end"><Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save {tag.jurisdiction} tag</Button></div>
    </div>
  )
}

export function CurateDialog({ requirementId, onOpenChange }: { requirementId: number | null; onOpenChange: (o: boolean) => void }) {
  const legal = useQuery({ queryKey: govKeys.requirementLegal(requirementId ?? 0), queryFn: () => api.get<RequirementLegalResp>(`/governance/legal/requirements/${requirementId}`), enabled: requirementId != null })
  const req = useQuery({ queryKey: ["requirement", requirementId], queryFn: () => api.get<RequirementDetailResp>(`/requirements/${requirementId}`), enabled: requirementId != null })
  return (
    <Dialog open={requirementId != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Legal status of {req.data ? <Code className="text-[15px] text-ink">{req.data.requirement.number}</Code> : "requirement"}</DialogTitle>
          <DialogDescription>{req.data?.requirement.section.replace(/^[\d.]+\s*/, "")}. Curated tags are kept when automatic tags are rebuilt.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto scroll-thin pr-1">
          {legal.error ? <ErrorState error={legal.error} /> : !legal.data || req.isLoading ? <Loading /> : (
            legal.data.rows.map((t) => <TagEditor key={`${t.id}-${t.status}-${t.basis_label}`} tag={t} provisions={req.data?.provisions ?? []} onSaved={() => legal.refetch()} />)
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- requirement page section ---------- */

export function RequirementLegalSection({ requirementId }: { requirementId: number }) {
  const { canAny } = useAuth()
  const [curating, setCurating] = useState<number | null>(null)
  const q = useQuery({ queryKey: govKeys.requirementLegal(requirementId), queryFn: () => api.get<RequirementLegalResp>(`/governance/legal/requirements/${requirementId}`), enabled: canAny("catalog.read") })
  if (!canAny("catalog.read")) return null
  return (
    <Section title="Legal status by jurisdiction"
      actions={q.data?.can_edit ? <Button size="xs" variant="ghost" onClick={() => setCurating(requirementId)}><Pencil /> Curate</Button> : undefined}>
      {q.isLoading ? <Loading className="p-2" /> : q.error ? <ErrorState error={q.error} /> : !q.data?.rows.length ? (
        <p className="text-[13px] text-ink-3">No legal status recorded for this requirement.</p>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {q.data.rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-2 text-[13px]">
                <Pill tone="outline" className="w-8 justify-center">{t.jurisdiction}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <LegalBadge tag={t} />
                    {t.regulation_id && t.basis_provision_id && (
                      <Link to={`/regulations/${t.regulation_id}?p=${t.basis_provision_id}`} className="text-[12px] text-petrol hover:underline">Open provision</Link>
                    )}
                  </div>
                  {t.note && <p className="mt-0.5 text-[12px] text-ink-3">{t.note}</p>}
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t pt-2">
            <div className="mb-1 text-[12px] text-ink-3">Effective per entity</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {q.data.entities.map((e) => (
                <span key={e.entity.id} className="inline-flex items-center gap-1.5">
                  <EntityTag code={e.entity.code} name={e.entity.name} />
                  {e.effective ? <LegalBadge tag={e.effective} short /> : <span className="text-[12px] text-ink-3">not tagged</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <CurateDialog requirementId={curating} onOpenChange={(o) => !o && setCurating(null)} />
    </Section>
  )
}

/* ---------- binding gaps ---------- */

export function useBindingGaps() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: govKeys.gaps, queryFn: () => api.get<BindingGaps>("/governance/binding-gaps"), enabled: canAny("assessments.read") })
}

/** Dashboard tile: open binding gaps per entity (binding requirements with a finding or not yet answered). */
export function BindingGapsTile() {
  const { canAny } = useAuth()
  const q = useBindingGaps()
  if (!canAny("assessments.read")) return null
  return (
    <Section title="Open binding gaps" actions={canAny("governance.read") ? <Link to="/governance/legal" className="text-[12.5px] text-petrol hover:underline">Legal basis</Link> : undefined}>
      {q.isLoading ? <Loading className="p-2" /> : q.error ? <ErrorState error={q.error} /> : !q.data?.entities.length ? (
        <p className="text-[13px] text-ink-3">No assessment in the current round that you can see.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.entities.map((e) => (
              <li key={e.entity.id}>
                <Link to={`/assessments/${e.assessment_id}`} className="-m-1 block rounded-md p-1 hover:bg-muted/60">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex items-center gap-2"><EntityTag code={e.entity.code} /> <span className="truncate">{e.entity.name}</span></span>
                    <span className={cn("tabular font-semibold", e.open ? "text-alarm" : "text-sage")}>{e.open}<span className="font-normal text-ink-3"> of {e.binding}</span></span>
                  </div>
                  <Meter value={e.binding ? (e.binding - e.open) / e.binding : 1} className="mt-1.5" tone={e.open ? "alarm" : "petrol"} />
                  <div className="mt-1 flex justify-between text-[12px] text-ink-3">
                    <span>{e.findings} with finding</span>
                    <span>{e.unanswered} not answered</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">Binding = statutory for the entity's country (BSIG, Cbw/Cbb). The bar shows binding requirements without an open gap.</p>
        </>
      )}
    </Section>
  )
}

function GapsPanel() {
  const q = useBindingGaps()
  const [open, setOpen] = useState<number | null>(null)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  if (!q.data?.entities.length) return null
  return (
    <Section title={`Open binding gaps${q.data.round_name ? ` in ${q.data.round_name}` : ""}`} bodyClassName="p-0">
      <ul>
        {q.data.entities.map((e) => (
          <li key={e.entity.id} className="border-b last:border-0">
            <button className="grid w-full grid-cols-[20px_60px_minmax(0,1fr)_120px_110px_110px] items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-muted/40"
              onClick={() => setOpen(open === e.entity.id ? null : e.entity.id)} aria-expanded={open === e.entity.id}>
              {open === e.entity.id ? <ChevronDown className="size-4 text-ink-3" /> : <ChevronRight className="size-4 text-ink-3" />}
              <EntityTag code={e.entity.code} name={e.entity.name} />
              <span className="truncate">{e.entity.name}</span>
              <span className="tabular text-ink-2">{e.binding} binding</span>
              <span className={cn("tabular", e.findings ? "text-alarm" : "text-ink-3")}>{e.findings} findings</span>
              <span className={cn("tabular", e.unanswered ? "text-amber" : "text-ink-3")}>{e.unanswered} unanswered</span>
            </button>
            {open === e.entity.id && (
              e.items.length === 0 ? <p className="px-4 pb-3 pl-12 text-[13px] text-ink-3">No open gaps in binding requirements.</p> : (
                <ul className="max-h-80 overflow-y-auto scroll-thin pb-2">
                  {e.items.map((i) => (
                    <li key={i.requirement_id} className="grid grid-cols-[60px_minmax(0,1fr)_220px_100px] items-center gap-3 py-1 pr-4 pl-12 text-[12.5px]">
                      <Link to={`/assessments/${e.assessment_id}?req=${i.requirement_id}`} className="hover:text-petrol"><Code>{i.number}</Code></Link>
                      <span className="truncate text-ink-2">{i.section.replace(/^[\d.]+\s*/, "")}</span>
                      <Code className="truncate text-[11.5px] text-ink-3">{i.basis_label}</Code>
                      <Pill tone={i.kind === "finding" ? "alarm" : "amber"}>{i.kind === "finding" ? "Finding" : "Not answered"}</Pill>
                    </li>
                  ))}
                </ul>
              )
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

/* ---------- entity profiles ---------- */

function ProfileDialog({ profile, onOpenChange }: { profile: EntityProfile | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nis2_entity_type: "", ir: false, rationale: "", reviewed_at: "" })
  useEffect(() => {
    if (profile) setF({ nis2_entity_type: profile.nis2_entity_type ?? "", ir: profile.ir_2024_2690_applicable, rationale: profile.rationale ?? "", reviewed_at: profile.reviewed_at ?? isoDate(new Date()) })
  }, [profile])
  const save = useMutation({
    mutationFn: () => api.put<EntityProfile>(`/governance/profiles/${profile!.entity.id}`, { nis2_entity_type: f.nis2_entity_type.trim() || null, ir_2024_2690_applicable: f.ir, rationale: f.rationale.trim() || null, reviewed_at: f.reviewed_at || null }),
    onSuccess: () => { toast.success("Entity profile saved"); qc.invalidateQueries({ queryKey: govKeys.profiles }); qc.invalidateQueries({ queryKey: ["gov-legal"] }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={profile != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>NIS-2 profile of {profile?.entity.name}</DialogTitle>
          <DialogDescription>The profile decides which requirements are binding for the entity.</DialogDescription>
        </DialogHeader>
        <Field label="NIS-2 entity type" htmlFor="pf-type"><Input id="pf-type" value={f.nis2_entity_type} onChange={(e) => setF({ ...f, nis2_entity_type: e.target.value })} placeholder="Important entity – Annex II manufacturing" /></Field>
        <label className="flex items-start gap-3 rounded-md border p-3 text-[13px]">
          <Switch checked={f.ir} onCheckedChange={(v) => setF({ ...f, ir: v })} className="mt-0.5" />
          <span>
            <span className="font-medium">IR (EU) 2024/2690 applies</span>
            <span className="block text-[12.5px] text-ink-3">Only for DNS, TLD, cloud, data-centre, CDN, managed (security) service providers, marketplaces, search engines, social networks and trust services. When on, the IR annex points become binding for this entity.</span>
          </span>
        </label>
        <Field label="Rationale" htmlFor="pf-rat"><Textarea id="pf-rat" rows={3} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
        <Field label="Reviewed on" htmlFor="pf-rev"><Input id="pf-rev" type="date" value={f.reviewed_at} onChange={(e) => setF({ ...f, reviewed_at: e.target.value })} className="w-44" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- main view ---------- */

export function LegalView() {
  const { can, canGlobal } = useAuth()
  const qc = useQueryClient()
  const profiles = useQuery({ queryKey: govKeys.profiles, queryFn: () => api.get<EntityProfile[]>("/governance/profiles") })
  const tags = useLegalTags()
  const reqs = useRequirements()
  const chapters = useChapters()
  const [editProfile, setEditProfile] = useState<EntityProfile | null>(null)
  const [curating, setCurating] = useState<number | null>(null)
  const [chapter, setChapter] = useState<string | null>(null)
  const [binding, setBinding] = useState<string | null>(null)
  const [curatedOnly, setCuratedOnly] = useState(false)
  const [text, setText] = useState("")
  const canCurate = canGlobal("governance.manage") || canGlobal("catalog.manage")

  const rebuild = useMutation({
    mutationFn: () => api.post<{ updated: number }>("/governance/legal/rebuild", { overwrite_curated: false }),
    onSuccess: (r) => { toast.success(`${r.updated} automatic tags rebuilt; curated tags kept`); qc.invalidateQueries({ queryKey: ["gov-legal"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const chapterById = useMemo(() => new Map((chapters.data ?? []).map((c) => [c.id, c])), [chapters.data])
  const rows = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (reqs.data ?? []).filter((r) => {
      const t = tags.byReq.get(r.id) ?? {}
      if (chapter && String(chapterById.get(r.chapter_id)?.number) !== chapter) return false
      if (binding && t[binding as "DE" | "NL" | "EU"]?.status !== "binding") return false
      if (curatedOnly && !Object.values(t).some((x) => x && !x.is_auto)) return false
      if (q && !`${r.number} ${r.section} ${Object.values(t).map((x) => x?.basis_label ?? "").join(" ")}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [reqs.data, tags.byReq, chapter, binding, curatedOnly, text, chapterById])

  const counts = useMemo(() => {
    const c = { DE: 0, NL: 0 }
    for (const t of tags.data ?? []) if (t.status === "binding" && (t.jurisdiction === "DE" || t.jurisdiction === "NL")) c[t.jurisdiction]++
    return c
  }, [tags.data])

  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-card px-4 py-3 text-[13px] text-ink-2">
        <p><span className="font-medium text-ink">Why this matters.</span> The Annex of IR (EU) 2024/2690 binds only digital providers. For the German entities, the catalogue is a benchmark that concretises § 30(2) BSIG; reporting, registration and management duties (chapters 14–16) are binding. For the Dutch entities, Cbb Art. 6–18 and the Cbw duties are binding. The badges show the basis for each requirement and entity.</p>
        <p className="mt-1 text-ink-3"><span className="tabular font-medium text-ink">{counts.DE}</span> requirements binding in Germany, <span className="tabular font-medium text-ink">{counts.NL}</span> in the Netherlands.</p>
      </div>

      <Section title="Entity profiles" bodyClassName="p-0">
        {profiles.isLoading ? <Loading /> : profiles.error ? <ErrorState error={profiles.error} className="m-4" /> : (
          <ul>
            {(profiles.data ?? []).map((p) => (
              <li key={p.entity.id} className="grid grid-cols-[60px_minmax(0,1fr)_200px_auto] items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0">
                <EntityTag code={p.entity.code} name={p.entity.name} />
                <div className="min-w-0">
                  <div className="truncate text-ink">{p.nis2_entity_type ?? <span className="text-ink-3">Entity type not recorded</span>}</div>
                  {p.rationale && <div className="truncate text-[12px] text-ink-3" title={p.rationale}>{p.rationale}</div>}
                </div>
                <span>{p.ir_2024_2690_applicable ? <Pill tone="petrol">IR 2024/2690 applies</Pill> : <Pill tone="outline">IR 2024/2690 not applicable</Pill>}
                  {p.reviewed_at && <span className="block text-[11.5px] text-ink-3">Reviewed {fmtDate(p.reviewed_at)}</span>}</span>
                {can("governance.manage", p.entity.id) ? <Button size="icon-xs" variant="ghost" aria-label={`Edit profile of ${p.entity.code}`} onClick={() => setEditProfile(p)}><Pencil /></Button> : <span />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <GapsPanel />

      <Section title="Legal status of the requirements" bodyClassName="p-0"
        actions={canCurate ? (
          <Confirm title="Rebuild automatic tags?" description="Automatic tags are recalculated from the requirement links and chapter rules. Curated tags are kept."
            confirmLabel="Rebuild tags" destructive={false} onConfirm={() => rebuild.mutateAsync()}
            trigger={<Button size="xs" variant="ghost" disabled={rebuild.isPending}><RefreshCw /> Rebuild automatic tags</Button>} />
        ) : undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <div className="w-64"><OptionSelect value={chapter} onChange={setChapter} allowNone noneLabel="All chapters" placeholder="All chapters"
            options={(chapters.data ?? []).map((c) => ({ value: String(c.number), label: `${c.number} ${c.title}` }))} /></div>
          <div className="w-48"><OptionSelect value={binding} onChange={setBinding} allowNone noneLabel="Any status" placeholder="Any status"
            options={[{ value: "DE", label: "Binding in Germany" }, { value: "NL", label: "Binding in the Netherlands" }]} /></div>
          <div className="relative w-60">
            <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Number, title or basis" className="pl-8" aria-label="Search legal tags" />
            {text && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear search"><X className="size-4" /></button>}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2"><Switch checked={curatedOnly} onCheckedChange={setCuratedOnly} aria-label="Curated only" /> Curated only</label>
          <span className="ml-auto text-[12.5px] text-ink-3"><span className="tabular font-medium text-ink">{rows.length}</span> requirements</span>
        </div>
        {tags.isLoading || reqs.isLoading ? <Loading /> : tags.error ? <ErrorState error={tags.error} className="m-4" /> : rows.length === 0 ? (
          <Empty icon={<Scale className="size-6" />} title="No requirements match">Change the chapter, status or search filter.</Empty>
        ) : (
          <div className="max-h-[640px] overflow-auto scroll-thin">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="w-[70px] px-4 py-2 font-medium">No.</th>
                  <th className="px-3 py-2 font-medium">Requirement</th>
                  <th className="w-[260px] px-3 py-2 font-medium">Germany</th>
                  <th className="w-[260px] px-3 py-2 font-medium">Netherlands</th>
                  <th className="w-[90px] px-3 py-2 font-medium">IR annex</th>
                  {canCurate && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = tags.byReq.get(r.id) ?? {}
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-1.5"><Link to={`/catalog/${r.id}`} className="hover:text-petrol"><Code className="text-ink">{r.number}</Code></Link></td>
                      <td className="max-w-0 truncate px-3 py-1.5 text-ink-2" title={r.section}>{r.section.replace(/^[\d.]+\s*/, "")}</td>
                      {(["DE", "NL"] as const).map((j) => (
                        <td key={j} className="max-w-0 px-3 py-1.5">{t[j] ? <LegalBadge tag={t[j]!} /> : <span className="text-ink-3">–</span>}</td>
                      ))}
                      <td className="px-3 py-1.5">{t.EU ? <span title={legalText(t.EU)} className="text-[12px] text-ink-3">{t.EU.status === "binding" ? "Binding" : "Benchmark"}</span> : <span className="text-ink-3">–</span>}</td>
                      {canCurate && <td className="px-2 py-1.5"><Button size="icon-xs" variant="ghost" aria-label={`Curate legal status of ${r.number}`} onClick={() => setCurating(r.id)}><Pencil /></Button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ProfileDialog profile={editProfile} onOpenChange={(o) => !o && setEditProfile(null)} />
      <CurateDialog requirementId={curating} onOpenChange={(o) => !o && setCurating(null)} />
    </div>
  )
}
