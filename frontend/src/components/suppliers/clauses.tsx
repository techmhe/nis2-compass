import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, FileText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Section } from "@/components/common/basics"
import { Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fromNow } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ClausePill, type ClauseRow, type ClauseStatus, DocumentPicker, type SupplierDetail, supplierKey } from "./shared"

const STATUSES: { value: ClauseStatus; label: string; active: string }[] = [
  { value: "agreed", label: "Agreed", active: "bg-petrol text-white" },
  { value: "partial", label: "Partial", active: "bg-amber text-white" },
  { value: "missing", label: "Missing", active: "bg-alarm text-white" },
  { value: "na", label: "N/A", active: "bg-ink-3 text-white" },
]

export function ClausesTab({ supplier }: { supplier: SupplierDetail }) {
  const c = supplier.clause_counts
  return (
    <Section
      title="Contract clauses (IR 2024/2690 point 5.1.4)"
      actions={supplier.provision && <Link to={supplier.provision.url} className="text-[12.5px] text-petrol hover:underline">Open IR 2024/2690 point 5.1.4</Link>}
      bodyClassName="p-0"
    >
      <p className="border-b px-4 py-2.5 text-[12.5px] text-ink-3">
        Contracts with suppliers and service providers must cover the following points where appropriate. {c.agreed} agreed, {c.partial} partial, {c.missing} missing, {c.na} not applicable.
      </p>
      <ul>
        {supplier.clause_list.map((row) => <ClauseItem key={row.clause} supplierId={supplier.id} row={row} canEdit={supplier.can_edit} />)}
      </ul>
    </Section>
  )
}

function ClauseItem({ supplierId, row, canEdit }: { supplierId: number; row: ClauseRow; canEdit: boolean }) {
  const qc = useQueryClient()
  const [reference, setReference] = useState(row.reference ?? "")
  const [note, setNote] = useState(row.note ?? "")
  const [docId, setDocId] = useState<number | null>(row.document?.id ?? null)
  const [expanded, setExpanded] = useState(false)
  const dirty = reference !== (row.reference ?? "") || note !== (row.note ?? "") || docId !== (row.document?.id ?? null)
  const save = useMutation({
    mutationFn: (status: ClauseStatus) => api.put<SupplierDetail>(`/suppliers/${supplierId}/clauses/${row.clause}`, {
      status, reference: reference.trim() || null, note: note.trim() || null, document_id: docId,
    }),
    onSuccess: (d) => {
      qc.setQueryData(supplierKey(supplierId), d)
      qc.invalidateQueries({ queryKey: ["suppliers", "list"] })
      toast.success(`Clause 5.1.4(${row.clause}) saved`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <li className="border-b px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-start gap-3">
        <Code className="mt-0.5 w-14 shrink-0">5.1.4({row.clause})</Code>
        <div className="min-w-[240px] flex-1">
          <div className="font-medium text-ink">{row.title}</div>
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-petrol">
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Hide provision text" : "Show provision text"}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-1 max-w-[80ch] text-[12.5px] text-ink-2">({row.clause}) {row.text}</p>
            </CollapsibleContent>
          </Collapsible>
        </div>
        {canEdit ? (
          <div role="radiogroup" aria-label={`Status of clause ${row.clause}`} className="inline-flex rounded-md border bg-surface p-0.5">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" role="radio" aria-checked={row.status === s.value} disabled={save.isPending}
                onClick={() => row.status !== s.value && save.mutate(s.value)}
                className={cn("h-7 rounded-[4px] px-2.5 text-[12.5px] font-medium", row.status === s.value ? s.active : "text-ink-2 hover:bg-muted")}>
                {s.label}
              </button>
            ))}
          </div>
        ) : <ClausePill status={row.status} />}
      </div>
      <div className="mt-2 ml-[68px] grid gap-2 md:grid-cols-[1fr_1fr]">
        {canEdit ? (
          <>
            <Field label="Contract reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. MSA § 12.3, DPA annex 2" maxLength={200} /></Field>
            <Field label="Contract document"><DocumentPicker value={docId} onChange={setDocId} /></Field>
            <Field label="Note" className="md:col-span-2"><Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gaps, negotiation status, SLA details" /></Field>
            <div className="flex items-center gap-3 md:col-span-2">
              {dirty && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(row.status)}>Save clause details</Button>}
              {row.document && <DocLink doc={row.document} />}
              {row.updated_at && row.id && <span className="text-[12px] text-ink-3">Updated {fromNow(row.updated_at)}</span>}
            </div>
          </>
        ) : (
          <div className="space-y-1 text-[12.5px] text-ink-2 md:col-span-2">
            {row.reference && <div>Reference: {row.reference}</div>}
            {row.note && <div className="text-ink-3">{row.note}</div>}
            {row.document && <DocLink doc={row.document} />}
          </div>
        )}
      </div>
    </li>
  )
}

function DocLink({ doc }: { doc: { id: number; title: string } }) {
  return (
    <Link to={`/documents/${doc.id}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-petrol hover:underline">
      <FileText className="size-3.5" /> {doc.title}
    </Link>
  )
}
