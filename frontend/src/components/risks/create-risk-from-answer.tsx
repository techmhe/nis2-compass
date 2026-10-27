import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Code } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { NewRiskDialog, type RiskDraft } from "./new-risk-dialog"
import { LevelPill, RiskStatusPill, useCanManageRisk, type Risk } from "./shared"

interface AnswerDraft {
  answer_id: number
  entity: { id: number; code: string; name: string }
  requirement: { id: number; number: string; section: string }
  implemented: string | null
  gap_description: string | null
  title: string
  scenario: string
  existing_controls: string | null
  can_create: boolean
}

/**
 * Gap-to-risk bridge for the assessment answer panel: lists the risks linked to this answer (with their residual
 * level) and creates a new risk prefilled from the requirement and the gap description; the answer is linked as
 * the risk's gap.
 *
 * Props:
 * - answerId: the assessment answer
 * - requirementNumber / section: shown in the dialog title (the prefill itself comes from the server)
 * - entityId: entity of the assessment (the new risk belongs to it)
 * - onCreated(riskId): optional; default navigates to the new risk
 * - className: optional wrapper class
 */
export function CreateRiskFromAnswer({ answerId, requirementNumber, section, entityId, onCreated, className }: {
  answerId: number
  requirementNumber: string
  section?: string
  entityId: number
  onCreated?: (riskId: number) => void
  className?: string
}) {
  const { canAny } = useAuth()
  const canManage = useCanManageRisk()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const enabled = canAny("risks.read")
  const linked = useQuery({
    queryKey: ["risks", "linked", "answer", answerId],
    queryFn: () => api.get<(Risk & { link_type: string })[]>("/risks/linked", { target_type: "answer", target_id: answerId }),
    enabled,
  })
  const draft = useQuery({
    queryKey: ["risks", "from-answer", answerId],
    queryFn: () => api.get<AnswerDraft>(`/risks/from-answer/${answerId}`),
    enabled: enabled && open,
  })
  if (!enabled) return null
  const risks = linked.data ?? []
  const allowed = canManage(entityId)
  const dialogDraft: Partial<RiskDraft> | undefined = draft.data
    ? { entity_id: draft.data.entity.id, title: draft.data.title, scenario: draft.data.scenario, existing_controls: draft.data.existing_controls ?? "" }
    : undefined

  return (
    <div className={cn("space-y-2", className)}>
      {risks.length > 0 ? (
        <ul className="space-y-1">
          {risks.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
              <ShieldAlert className="size-4 shrink-0 text-ink-3" />
              <Code className="shrink-0">{r.code}</Code>
              <Link to={`/risks/${r.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-petrol" title={r.title}>{r.title}</Link>
              <span className="text-[11.5px] text-ink-3">Residual</span>
              <LevelPill level={r.residual_level} />
              <RiskStatusPill status={r.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">No risk is linked to this answer.{allowed ? " Record the risk that results from the gap." : ""}</p>
      )}
      {draft.error && <p className="text-[12.5px] text-alarm">{(draft.error as Error).message}</p>}
      {allowed && (
        <Button size="sm" variant="outline" disabled={open && draft.isFetching} onClick={() => setOpen(true)}>
          <ShieldAlert /> {open && draft.isFetching ? "Preparing…" : "Create risk from gap"}
        </Button>
      )}
      <NewRiskDialog open={open && !!dialogDraft} onOpenChange={setOpen} draft={dialogDraft} sourceAnswerId={answerId} lockEntity
        title={`Create risk from gap ${requirementNumber}`}
        description={`Prefilled from requirement ${requirementNumber}${section ? ` (${section})` : ""} and the gap description. The answer is linked as the source gap.`}
        onCreated={(d) => {
          qc.invalidateQueries({ queryKey: ["risks", "linked", "answer", answerId] })
          if (onCreated) onCreated(d.risk.id)
          else navigate(`/risks/${d.risk.id}`)
        }} />
    </div>
  )
}
