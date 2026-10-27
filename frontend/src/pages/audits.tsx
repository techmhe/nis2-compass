import { NavLink, Navigate, Route, Routes } from "react-router"
import { EffectivenessReviewsView } from "@/components/audits/effectiveness"
import { FindingsView } from "@/components/audits/findings"
import { ManagementReviewsView } from "@/components/audits/management"
import { ProgrammeAuditsView } from "@/components/audits/programme"
import { ErrorState, PageHeader } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const TABS = [
  { path: "programme", label: "Programme & audits" },
  { path: "findings", label: "Findings" },
  { path: "effectiveness-reviews", label: "Effectiveness reviews" },
  { path: "management-reviews", label: "Management reviews" },
]

export default function AuditsPage() {
  const { canAny } = useAuth()
  if (!canAny("audits.read")) return <ErrorState error="You do not have permission to view audits and reviews." />
  return (
    <div>
      <PageHeader title="Audits & reviews"
        description="The audit programme, internal and external audits with their findings, the Cbb Art. 18 effectiveness evaluation and the ISO/IEC 27001 9.3 management review." />
      <nav aria-label="Audits sections" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/audits/${t.path}`}
            className={({ isActive }) => cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="programme" replace />} />
        <Route path="programme" element={<ProgrammeAuditsView />} />
        <Route path="findings" element={<FindingsView />} />
        <Route path="effectiveness-reviews" element={<EffectivenessReviewsView />} />
        <Route path="management-reviews" element={<ManagementReviewsView />} />
        <Route path="*" element={<Navigate to="/audits/programme" replace />} />
      </Routes>
    </div>
  )
}
