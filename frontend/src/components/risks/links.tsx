import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EntityTag, ErrorState, Meter, Pill, StatusPill } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDate, pct } from "@/lib/format"
import { cn } from "@/lib/utils"
import { targetLabel, useRiskMeta, type LinkType, type Risk, type RiskLinkRow } from "./shared"

interface Option { id: number; label: string; hint: string | null; entity_code: string | null }

const ADD_LABEL: Record<LinkType, string> = {
  gap: "Link gap", control: "Link control", affected: "Link object", treatment: "Link measure",
}
const EMPTY_TEXT: Record<LinkType, string> = {
  gap: "No gap linked. Link the assessment answers whose gaps cause this risk.",
  control: "No assessment answers linked as existing controls.",
  affected: "No affected objects linked. Link documents, incidents, assets or suppliers the risk concerns.",
  treatment: "No measures linked. Link the action plan items or work packages that treat this risk.",
}

/** Linked objects of one link type with add and remove. */
export function RiskLinkList({ risk, type, links, canEdit, onChange, compactEmpty }: {
  risk: Risk
  type: LinkType
  links: RiskLinkRow[]
  canEdit: boolean
  onChange: () => void
  compactEmpty?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rows = links.filter((l) => l.link_type === type)
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/risks/${risk.id}/links/${id}`),
    onSuccess: () => { toast.success("Link removed"); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">{compactEmpty ? "None linked." : EMPTY_TEXT[type]}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((l) => <LinkRow key={l.id} l={l} canEdit={canEdit} onRemove={() => remove.mutate(l.id)} />)}
        </ul>
      )}
      {canEdit && (
        <>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> {ADD_LABEL[type]}</Button>
          <AddLinkDialog open={open} onOpenChange={setOpen} risk={risk} type={type} existing={rows} onDone={onChange} />
        </>
      )}
    </div>
  )
}

function LinkRow({ l, canEdit, onRemove }: { l: RiskLinkRow; canEdit: boolean; onRemove: () => void }) {
  const label = !l.exists ? <span className="text-ink-3 italic">Deleted {targetLabel(l.target_type).toLowerCase()}</span>
    : !l.accessible ? <span className="text-ink-3 italic">No access to this {targetLabel(l.target_type).toLowerCase()}</span>
      : l.url ? <Link to={l.url} className="text-ink hover:text-petrol">{l.label}</Link> : <span className="text-ink">{l.label}</span>
  const dueTone = l.info?.due_status === "Overdue" ? "text-alarm font-medium" : "text-ink-3"
  return (
    <li className="group flex items-start gap-2 px-3 py-2 text-[13px]">
      <Link2 className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          <span>{targetLabel(l.target_type)}</span>
          {l.info?.entity_code && <EntityTag code={l.info.entity_code} />}
          {l.target_type === "answer" && l.info && (
            <span>Implemented: <span className="text-ink-2">{l.info.implemented ?? "not answered"}</span>{l.info.score != null && <>, score <span className="tabular text-ink-2">{pct(l.info.score)}</span></>}</span>
          )}
          {l.owner && <span>{l.owner}</span>}
          {l.due && <span className={dueTone}>Due {fmtDate(l.due)}</span>}
          {l.note && <span className="italic">{l.note}</span>}
        </div>
        {l.target_type === "answer" && l.info?.gap && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{l.info.gap}</p>}
        {l.progress != null && <div className="mt-1.5 flex max-w-[260px] items-center gap-2"><Meter value={l.progress} /><span className="tabular text-[12px] text-ink-3">{pct(l.progress)}</span></div>}
      </div>
      {l.status && l.target_type !== "answer" && <StatusPill value={l.status} />}
      {canEdit && (
        <button type="button" className="rounded p-0.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-alarm focus-visible:opacity-100"
          aria-label={`Remove link to ${l.label ?? "object"}`} onClick={onRemove}>
          <X className="size-3.5" />
        </button>
      )}
    </li>
  )
}

function AddLinkDialog({ open, onOpenChange, risk, type, existing, onDone }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  risk: Risk
  type: LinkType
  existing: RiskLinkRow[]
  onDone: () => void
}) {
  const meta = useRiskMeta()
  const targetTypes = type === "gap" || type === "control" ? ["answer"] : type === "treatment" ? ["action_item", "work_package"]
    : (meta.data?.link_targets ?? ["answer", "document", "incident"]).filter((t) => t !== "risk")
  const [targetType, setTargetType] = useState<string>(targetTypes[0])
  const [q, setQ] = useState("")
  const [note, setNote] = useState("")
  const tt = targetTypes.includes(targetType) ? targetType : targetTypes[0]
  const options = useQuery({
    queryKey: ["risks", "link-options", tt, q, risk.entity?.id ?? null],
    queryFn: () => api.get<Option[]>("/risks/link-options", { target_type: tt, q: q.trim() || undefined, entity_id: risk.entity?.id }),
    enabled: open,
  })
  const taken = new Set(existing.filter((l) => l.target_type === tt).map((l) => l.target_id))
  const add = useMutation({
    mutationFn: (id: number) => api.post(`/risks/${risk.id}/links`, { link_type: type, target_type: tt, target_id: id, note: note.trim() || null }),
    onSuccess: () => { toast.success("Linked"); setNote(""); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{ADD_LABEL[type]}</DialogTitle>
          <DialogDescription>
            {type === "gap" || type === "control"
              ? `Answers of the current assessment round${risk.entity ? ` of ${risk.entity.name}` : ""}.`
              : type === "treatment" ? "Action plan items and work packages that reduce this risk. Linking a measure sets the risk to In treatment."
                : "Any object the risk concerns."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-2">
            {targetTypes.length > 1 ? (
              <OptionSelect value={tt} onChange={(v) => setTargetType(v ?? targetTypes[0])} options={targetTypes.map((t) => ({ value: t, label: targetLabel(t) }))} />
            ) : <div className="flex items-center text-[13px] text-ink-2">{targetLabel(tt)}</div>}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number, code or title" aria-label="Search objects" autoFocus />
          </div>
          <Field label="Note (optional)" htmlFor="link-note">
            <Input id="link-note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="e.g. covers the remote access part" />
          </Field>
          {options.error && <ErrorState error={options.error} />}
          <ul className="max-h-80 space-y-0.5 overflow-auto scroll-thin">
            {options.isLoading && <li className="p-2 text-[13px] text-ink-3">Searching…</li>}
            {!options.isLoading && (options.data ?? []).length === 0 && <li className="p-2 text-[13px] text-ink-3">Nothing found. Try another search term.</li>}
            {(options.data ?? []).map((o) => {
              const isTaken = taken.has(o.id)
              return (
                <li key={o.id}>
                  <button type="button" disabled={isTaken || add.isPending} onClick={() => add.mutate(o.id)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]", isTaken ? "opacity-50" : "hover:bg-muted")}>
                    <span className="min-w-0 flex-1 truncate text-ink">{o.label}</span>
                    {o.entity_code && <EntityTag code={o.entity_code} />}
                    {o.hint && <span className="shrink-0 text-[12px] text-ink-3">{o.hint}</span>}
                    {isTaken && <Pill tone="outline">Linked</Pill>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
