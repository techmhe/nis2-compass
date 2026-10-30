import { NavLink, Navigate, Route, Routes, useParams } from "react-router"
import { Code, ErrorState, Loading, PageHeader, StatusPill } from "@/components/common/basics"
import { ProjectGantt } from "@/components/project/gantt"
import { ProjectGates } from "@/components/project/gates"
import { ProjectOverview } from "@/components/project/overview"
import { MasterPlan } from "@/components/project/plan"
import { RaciMatrix } from "@/components/project/raci"
import { ProjectRaid } from "@/components/project/raid"
import { useProject } from "@/components/project/shared"
import { useAuth } from "@/hooks/useAuth"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const TABS = [
  { path: "", label: "Overview" },
  { path: "plan", label: "Master plan" },
  { path: "gantt", label: "Gantt" },
  { path: "gates", label: "Gates" },
  { path: "raci", label: "RACI" },
  { path: "raid", label: "RAID" },
]

export default function ProjectPage() {
  const { id } = useParams()
  const pid = Number(id)
  const { canAny } = useAuth()
  const project = useProject(pid)

  if (!canAny("projects.read")) return <ErrorState error="You do not have permission to view projects." />
  if (!Number.isFinite(pid)) return <ErrorState error="Invalid project link." />
  if (project.isLoading) return <Loading />
  if (project.error) return <ErrorState error={project.error} />
  const p = project.data!

  return (
    <div>
      <PageHeader
        title={p.name}
        description={p.description ?? undefined}
        actions={
          <div className="flex items-center gap-3 text-[12.5px] text-ink-3">
            <Code>{p.code}</Code>
            <StatusPill value={p.status} />
            <span className="tabular">{fmtDate(p.planned_start)} to {fmtDate(p.planned_finish)}</span>
          </div>
        }
      />
      <nav aria-label="Project sections" data-tour="project.tabs" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <NavLink key={t.path} to={t.path ? `/projects/${pid}/${t.path}` : `/projects/${pid}`} end
            className={({ isActive }) => cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<ProjectOverview project={p} />} />
        <Route path="plan" element={<MasterPlan projectId={pid} />} />
        <Route path="gantt" element={<ProjectGantt projectId={pid} />} />
        <Route path="gates" element={<ProjectGates projectId={pid} />} />
        <Route path="raci" element={<RaciMatrix projectId={pid} />} />
        <Route path="raid" element={<ProjectRaid projectId={pid} />} />
        <Route path="*" element={<Navigate to={`/projects/${pid}`} replace />} />
      </Routes>
    </div>
  )
}
