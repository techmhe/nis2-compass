import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Flag, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, Segmented, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { RAID_STATUS, RAID_TYPES, RATING } from "@/lib/constants"
import { fmtDate, isoDate } from "@/lib/format"
import type { RaidRecord } from "@/lib/types"
import { cn } from "@/lib/utils"
import { nn, projectKeys, ratingTone, useRaid } from "./shared"

const LEVEL: Record<string, number> = { Low: 1, Medium: 2, High: 3 }
const CLOSED = ["Closed", "Accepted"]

function severityOf(impact: string | null, probability: string | null): string | null {
  if (!impact || !probability) return null
  const v = LEVEL[impact] * LEVEL[probability]
  return v >= 6 ? "High" : v >= 3 ? "Medium" : "Low"
}

const SEV_BG: Record<string, string> = { High: "var(--alarm)", Medium: "var(--amber)", Low: "var(--sage)" }

/** 3×3 impact × probability grid with the record's cell highlighted. */
export function HeatIndicator({ impact, probability, severity, size = 6 }: { impact: string | null; probability: string | null; severity: string | null; size?: number }) {
  const label = impact && probability ? `Impact ${impact}, probability ${probability}: severity ${severity ?? severityOf(impact, probability)}` : severity ? `Severity ${severity}` : "Not rated"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-grid shrink-0 gap-[1.5px]" style={{ gridTemplateColumns: `repeat(3, ${size}px)` }} role="img" aria-label={label}>
          {[3, 2, 1].map((imp) => [1, 2, 3].map((prob) => {
            const sev = severityOf(Object.keys(LEVEL)[imp - 1], Object.keys(LEVEL)[prob - 1])!
            const active = impact && probability && LEVEL[impact] === imp && LEVEL[probability] === prob
            return (
              <span key={`${imp}${prob}`} className="rounded-[1px]"
                style={{ width: size, height: size, background: SEV_BG[sev], opacity: active ? 1 : 0.18 }} />
            )
          }))}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ProjectRaid({ projectId }: { projectId: number }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const raid = useRaid(projectId)
  const entities = useEntities()
  const [params, setParams] = useSearchParams()
  const [type, setType] = useState<string>("All")
  const [q, setQ] = useState("")
  const [hideClosed, setHideClosed] = useState(false)
  const recordParam = params.get("record")
  const openRecord = recordParam === "new" ? "new" : recordParam ? Number(recordParam) : null

  const setOpen = (v: number | "new" | null) => {
    const p = new URLSearchParams(params)
    if (v == null) p.delete("record")
    else p.set("record", String(v))
    setParams(p, { replace: v == null })
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: 0 }
    for (const r of raid.data ?? []) {
      if (hideClosed && CLOSED.includes(r.status)) continue
      c.All++
      c[r.type] = (c[r.type] ?? 0) + 1
    }
    return c
  }, [raid.data, hideClosed])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (raid.data ?? []).filter((r) => (type === "All" || r.type === type) && (!hideClosed || !CLOSED.includes(r.status))
      && (!t || `${r.code} ${r.title} ${r.mitigation ?? ""} ${r.owner?.name ?? ""}`.toLowerCase().includes(t)))
  }, [raid.data, type, q, hideClosed])

  if (raid.isLoading) return <Loading />
  if (raid.error) return <ErrorState error={raid.error} />
  const current = typeof openRecord === "number" ? raid.data?.find((r) => r.id === openRecord) ?? null : null
  const entityCode = (id: number | null) => entities.data?.find((e) => e.id === id)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="RAID type" className="inline-flex rounded-md border bg-surface p-0.5">
          {["All", ...RAID_TYPES].map((t) => (
            <button key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)}
              className={cn("flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 text-[12.5px] font-medium", type === t ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>
              {t === "All" ? "All" : `${t}s`}
              <span className={cn("tabular text-[11.5px]", type === t ? "text-white/80" : "text-ink-3")}>{counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative w-60">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RAID" className="pl-8" aria-label="Search RAID records" />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={hideClosed} onCheckedChange={setHideClosed} /> Hide closed and accepted</label>
        {canManage && <Button className="ml-auto" onClick={() => setOpen("new")}><Plus /> New record</Button>}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card scroll-thin">
        {rows.length === 0 ? (
          <Empty title={raid.data?.length ? "No records match" : "The RAID register is empty"}>
            {raid.data?.length ? "Change the type filter or search to see more records." : canManage ? "Log risks, issues, assumptions and decisions of the project here." : "No risks, issues, assumptions or decisions have been logged yet."}
          </Empty>
        ) : (
          <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3 [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="w-[64px]">ID</th>
                <th className="w-[96px]">Type</th>
                <th className="min-w-[300px]">Title</th>
                <th className="w-[110px]">Severity</th>
                <th className="w-[170px]">Owner</th>
                <th className="w-[96px]">Raised</th>
                <th className="w-[130px]">Target date</th>
                <th className="w-[110px]">Status</th>
                <th className="w-[44px]"><span className="sr-only">Escalation</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ent = entityCode(r.entity_id)
                return (
                  <tr key={r.id} onClick={() => setOpen(r.id)}
                    className={cn("cursor-pointer align-top hover:bg-muted/40 [&>td]:border-b [&>td]:px-3 [&>td]:py-2.5", openRecord === r.id && "bg-petrol-50/60")}>
                    <td><button className="hover:text-petrol" onClick={(e) => { e.stopPropagation(); setOpen(r.id) }}><Code>{r.code}</Code></button></td>
                    <td className="text-ink-2">{r.type}</td>
                    <td>
                      <div className="flex items-start gap-2 text-ink">{r.title}{ent && <EntityTag code={ent.code} name={ent.name} />}</div>
                      {r.mitigation && <div className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{r.type === "Decision" ? "Decision: " : "Mitigation: "}{r.mitigation}</div>}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <HeatIndicator impact={r.impact} probability={r.probability} severity={r.severity} />
                        {r.severity ? <Pill tone={ratingTone(r.severity)}>{r.severity}</Pill> : <span className="text-ink-3">–</span>}
                      </span>
                    </td>
                    <td className="text-ink-2">{r.owner?.name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="tabular text-ink-2">{fmtDate(r.date_raised)}</td>
                    <td>
                      <div className="tabular text-ink-2">{fmtDate(r.target_date)}</div>
                      {r.due_status && r.due_status !== "Closed" && r.due_status !== "On track" && <StatusPill value={r.due_status} className="mt-0.5" />}
                    </td>
                    <td><StatusPill value={r.status} /></td>
                    <td>
                      {r.escalation_needed && !CLOSED.includes(r.status) && (
                        <Tooltip>
                          <TooltipTrigger asChild><Flag className="size-4 fill-alarm text-alarm" aria-label="Escalation needed" /></TooltipTrigger>
                          <TooltipContent>Escalation needed</TooltipContent>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <RaidSheet projectId={projectId} record={current} isNew={openRecord === "new"} canManage={canManage}
        open={openRecord === "new" || !!current} onClose={() => setOpen(null)} defaultType={type === "All" ? "Risk" : type} />
    </div>
  )
}

interface RaidForm {
  type: string; date_raised: string; title: string; impact: string | null; probability: string | null; severity: string | null
  owner_id: number | null; mitigation: string; target_date: string; status: string; escalation_needed: boolean; resolution: string; entity_id: number | null
}

function toForm(r: RaidRecord | null, defaultType: string): RaidForm {
  return {
    type: r?.type ?? defaultType, date_raised: r?.date_raised ?? isoDate(new Date()), title: r?.title ?? "", impact: r?.impact ?? null,
    probability: r?.probability ?? null, severity: r?.severity ?? null, owner_id: r?.owner?.id ?? null, mitigation: r?.mitigation ?? "",
    target_date: r?.target_date ?? "", status: r?.status ?? "Open", escalation_needed: r?.escalation_needed ?? false,
    resolution: r?.resolution ?? "", entity_id: r?.entity_id ?? null,
  }
}

function RaidSheet({ projectId, record, isNew, canManage, open, onClose, defaultType }: {
  projectId: number; record: RaidRecord | null; isNew: boolean; canManage: boolean; open: boolean; onClose: () => void; defaultType: string
}) {
  const qc = useQueryClient()
  const [f, setF] = useState<RaidForm>(() => toForm(record, defaultType))
  const [key, setKey] = useState("")
  const k = open ? String(record?.id ?? "new") : ""
  if (k !== key) { setKey(k); if (open) setF(toForm(isNew ? null : record, defaultType)) }
  const set = <K extends keyof RaidForm>(k: K, v: RaidForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const computed = severityOf(f.impact, f.probability)
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: projectKeys.raid(projectId) })
    qc.invalidateQueries({ queryKey: ["project-dashboard"] })
    qc.invalidateQueries({ queryKey: ["me-work"] })
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type: f.type, date_raised: nn(f.date_raised), title: f.title.trim(), impact: f.impact, probability: f.probability,
        severity: computed ? null : f.severity, owner_id: f.owner_id, mitigation: nn(f.mitigation.trim()), target_date: nn(f.target_date),
        status: f.status, escalation_needed: f.escalation_needed, resolution: nn(f.resolution.trim()), entity_id: f.entity_id,
      }
      return record && !isNew ? api.put<RaidRecord>(`/projects/raid/${record.id}`, body) : api.post<RaidRecord>(`/projects/${projectId}/raid`, body)
    },
    onSuccess: (r) => { toast.success(record && !isNew ? `Saved ${r.code}` : `Created ${r.code}`); invalidate(); onClose() },
    onError: (e: Error) => toast.error(`Could not save the record: ${e.message}`),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/projects/raid/${record!.id}`),
    onSuccess: () => { toast.success(`Deleted ${record!.code}`); invalidate(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const ro = !canManage
  const mitigationLabel = f.type === "Decision" ? "Decision and rationale" : f.type === "Assumption" ? "Validation approach" : "Mitigation / response"

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[560px]">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 pr-6">
            {record && !isNew ? <><Code className="text-[14px]">{record.code}</Code><span className="truncate">{record.title}</span></> : "New RAID record"}
          </SheetTitle>
          <SheetDescription>
            {record && !isNew ? `${record.type} raised ${fmtDate(record.date_raised)}` : "Log a risk, issue, assumption or decision."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <fieldset disabled={ro} className="grid grid-cols-2 gap-3">
            <Field label="Type" className="col-span-2">
              <Segmented value={f.type} onChange={(v) => v && set("type", v)} options={RAID_TYPES} disabled={ro} size="sm" />
            </Field>
            <Field label="Title" className="col-span-2"><Textarea rows={2} value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Impact"><OptionSelect value={f.impact} onChange={(v) => set("impact", v)} options={RATING} allowNone noneLabel="Not rated" disabled={ro} /></Field>
            <Field label="Probability"><OptionSelect value={f.probability} onChange={(v) => set("probability", v)} options={RATING} allowNone noneLabel="Not rated" disabled={ro} /></Field>
            <Field label="Severity" className="col-span-2" hint={computed ? "Calculated from impact × probability." : "Set impact and probability to calculate, or choose manually."}>
              <div className="flex items-center gap-3">
                <HeatIndicator impact={f.impact} probability={f.probability} severity={computed ?? f.severity} size={9} />
                {computed ? <Pill tone={ratingTone(computed)}>{computed}</Pill> : (
                  <OptionSelect className="w-40" value={f.severity} onChange={(v) => set("severity", v)} options={RATING} allowNone noneLabel="Not rated" disabled={ro} />
                )}
              </div>
            </Field>
            <Field label="Owner"><StakeholderSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} disabled={ro} placeholder="Select owner…" /></Field>
            <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} disabled={ro} groupLabel="Group-wide" /></Field>
            <Field label="Date raised"><Input type="date" value={f.date_raised} onChange={(e) => set("date_raised", e.target.value)} /></Field>
            <Field label="Target date"><Input type="date" value={f.target_date} onChange={(e) => set("target_date", e.target.value)} /></Field>
            <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Open")} options={RAID_STATUS} disabled={ro} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-2">
              <Switch checked={f.escalation_needed} onCheckedChange={(v) => set("escalation_needed", v)} disabled={ro} /> Escalation needed
            </label>
            <Field label={mitigationLabel} className="col-span-2"><Textarea rows={3} value={f.mitigation} onChange={(e) => set("mitigation", e.target.value)} /></Field>
            <Field label="Resolution" className="col-span-2"><Textarea rows={2} value={f.resolution} onChange={(e) => set("resolution", e.target.value)} /></Field>
          </fieldset>
          {canManage && (
            <div className="flex items-center gap-2">
              {record && !isNew && (
                <Confirm title={`Delete ${record.code}?`} description="The record and its comments are removed permanently."
                  trigger={<Button variant="ghost" className="text-alarm hover:text-alarm"><Trash2 /> Delete record</Button>} onConfirm={() => del.mutate()} />
              )}
              <Button variant="outline" className="ml-auto" onClick={onClose}>Cancel</Button>
              <Button disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : record && !isNew ? "Save changes" : "Create record"}</Button>
            </div>
          )}
          {record && !isNew && (
            <div className="border-t pt-4">
              <h3 className="mb-2 text-[13.5px] font-semibold">Comments</h3>
              <CommentsPanel targetType="raid" targetId={record.id} canComment={canManage} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
