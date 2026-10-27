import { Link, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Stamp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EntityTag } from "@/components/common/basics"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ManagementBodyFlag, targetTypeLabel, type Approval } from "./shared"

/** "Approvals waiting for me" block for My work. Renders nothing while there is nothing to decide. */
export function ApprovalsWaiting({ className }: { className?: string }) {
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ["approvals", "list", "waiting", "pending"],
    queryFn: () => api.get<Approval[]>("/approvals", { mine: "waiting", status: "pending" }),
  })
  const rows = q.data ?? []
  if (!rows.length) return null
  const shown = rows.slice(0, 6)
  return (
    <section aria-labelledby="approvals-waiting" className={cn("rounded-md border bg-card", className)}>
      <header className="flex items-baseline gap-2 border-b px-4 py-2.5">
        <h2 id="approvals-waiting" className="text-[13.5px] font-semibold text-ink">Approvals waiting for me</h2>
        <span className="tabular text-[12.5px] text-ink-3">{rows.length}</span>
        <Link to="/approvals" className="ml-auto text-[12.5px] text-petrol hover:underline">Open approval inbox</Link>
      </header>
      <ul>
        {shown.map((a) => (
          <li key={a.id} className="group flex items-center gap-3 border-b px-4 py-2 last:border-0 hover:bg-muted/40">
            <Stamp className="size-4 shrink-0 text-ink-3" />
            <button onClick={() => navigate(`/approvals?request=${a.id}`)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] text-ink group-hover:text-petrol">{a.target_label}</span>
              <span className="block text-[11.5px] text-ink-3">{targetTypeLabel(a.target_type)}, requested by {a.requested_by?.display_name ?? "unknown"}</span>
            </button>
            {a.meta?.requires_management_body && <ManagementBodyFlag className="hidden md:inline-flex" />}
            {a.entity && <EntityTag code={a.entity.code} name={a.entity.name} />}
            <span className={cn("tabular w-28 shrink-0 text-right text-[12.5px]", a.overdue ? "font-medium text-alarm" : "text-ink-3")}>
              {a.due_date ? (a.overdue ? `Overdue ${fmtDate(a.due_date)}` : `Due ${fmtDate(a.due_date)}`) : ""}
            </span>
            <Button size="xs" variant="outline" onClick={() => navigate(`/approvals?request=${a.id}`)}>Review</Button>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && (
        <div className="border-t px-4 py-2 text-[12.5px] text-ink-3">
          {rows.length - shown.length} more in the <Link to="/approvals" className="text-petrol hover:underline">approval inbox</Link>.
        </div>
      )}
    </section>
  )
}
