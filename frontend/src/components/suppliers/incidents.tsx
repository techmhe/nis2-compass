import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link2, Siren, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section, StatusPill } from "@/components/common/basics"
import { Combo } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import type { EntityBrief, Incident } from "@/lib/types"
import type { SupplierDetail } from "./shared"

interface IncidentBrief {
  id: number
  code: string
  title: string
  severity: string
  status: string
  is_significant: boolean | null
  detected_at: string | null
  aware_at: string | null
  entity: EntityBrief | null
}
interface SupplierIncidents { linked: IncidentBrief[]; mentions: IncidentBrief[]; can_read_incidents: boolean }

export function IncidentsTab({ supplier }: { supplier: SupplierDetail }) {
  const { canAny } = useAuth()
  const qc = useQueryClient()
  const key = ["suppliers", "incidents", supplier.id]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<SupplierIncidents>(`/suppliers/${supplier.id}/incidents`) })
  const all = useQuery({ queryKey: ["incidents", "list"], queryFn: () => api.get<Incident[]>("/incidents"), enabled: supplier.can_edit && canAny("incidents.read") })
  const [pick, setPick] = useState<number | null>(null)
  const link = useMutation({
    mutationFn: (id: number) => api.post(`/suppliers/${supplier.id}/incidents`, { incident_id: id }),
    onSuccess: () => { toast.success("Incident linked"); setPick(null); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const unlink = useMutation({
    mutationFn: (id: number) => api.del(`/suppliers/${supplier.id}/incidents/${id}`),
    onSuccess: () => { toast.success("Link removed"); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  const data = q.data!
  if (!data.can_read_incidents) {
    return <Section><Empty title="No access to the incident register" icon={<Siren className="size-6" />}>You need permission to view incidents to see which incidents involve this supplier.</Empty></Section>
  }
  const linkedIds = new Set(data.linked.map((i) => i.id))
  const options = (all.data ?? []).filter((i) => !linkedIds.has(i.id)).map((i) => ({ value: i.id, label: `${i.code} ${i.title}`, hint: i.entity?.code ?? "Group" }))

  return (
    <div className="space-y-4">
      <Section title="Linked incidents"
        actions={supplier.can_edit && (
          <div className="flex items-center gap-2">
            <Combo value={pick} onChange={setPick} items={options} placeholder="Choose incident…" searchPlaceholder="Search incidents…" className="h-8 w-64" />
            <Button size="sm" variant="outline" disabled={pick == null || link.isPending} onClick={() => pick != null && link.mutate(pick)}><Link2 /> Link incident</Button>
          </div>
        )}
        bodyClassName="p-0">
        {data.linked.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">No incidents are linked to this supplier. Link incidents the supplier caused, reported or was affected by (IR 2024/2690 point 5.1.4(d) and 5.1.7(b)).</p>
        ) : (
          <IncidentList rows={data.linked} action={supplier.can_edit ? (i) => (
            <Button variant="ghost" size="icon-sm" aria-label={`Unlink ${i.code}`} onClick={() => unlink.mutate(i.id)}><Unlink /></Button>
          ) : undefined} />
        )}
      </Section>
      <Section title="Incidents mentioning this supplier" bodyClassName="p-0">
        {data.mentions.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">No other incident mentions {supplier.name} in its title or description.</p>
        ) : (
          <IncidentList rows={data.mentions} action={supplier.can_edit ? (i) => (
            <Button size="xs" variant="outline" disabled={link.isPending} onClick={() => link.mutate(i.id)}><Link2 /> Link</Button>
          ) : undefined} />
        )}
      </Section>
    </div>
  )
}

function IncidentList({ rows, action }: { rows: IncidentBrief[]; action?: (i: IncidentBrief) => ReactNode }) {
  return (
    <ul>
      {rows.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0">
          <Code>{i.code}</Code>
          <Link to={`/incidents/${i.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:text-petrol">{i.title}</Link>
          {i.entity ? <EntityTag code={i.entity.code} name={i.entity.name} /> : <span className="text-[12px] text-ink-3">Group</span>}
          <StatusPill value={i.severity} />
          <StatusPill value={i.status} />
          {i.is_significant && <Pill tone="alarm">Significant</Pill>}
          <span className="tabular w-24 text-right text-[12.5px] text-ink-3">{fmtDate(i.aware_at ?? i.detected_at)}</span>
          {action?.(i)}
        </li>
      ))}
    </ul>
  )
}
