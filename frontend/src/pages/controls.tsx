import { NavLink, Navigate, Route, Routes } from "react-router"
import { PageHeader } from "@/components/common/basics"
import { ActivitiesTab } from "@/components/controls/activities"
import { CalendarTab } from "@/components/controls/calendar"
import { EvidenceTab } from "@/components/controls/evidence"
import { ExceptionsTab } from "@/components/controls/exceptions"
import { KpisTab } from "@/components/controls/kpis"
import { AdvisoriesTab } from "@/components/threats/advisories"
import { VulnerabilitiesTab } from "@/components/threats/vulnerabilities"
import { cn } from "@/lib/utils"

const TABS = [
  { path: "calendar", label: "Calendar" },
  { path: "activities", label: "Activities" },
  { path: "evidence", label: "Evidence" },
  { path: "exceptions", label: "Exceptions" },
  { path: "advisories", label: "Advisories" },
  { path: "vulnerabilities", label: "Vulnerabilities" },
  { path: "kpis", label: "KPIs" },
]

export default function ControlsPage() {
  return (
    <div>
      <PageHeader
        title="Controls and KPIs"
        description="Recurring control activities per entity with their results and evidence, documented exceptions, and the key performance indicators used for the effectiveness evaluation (IR 2024/2690 point 7, Cbb Art. 18)."
      />
      <nav aria-label="Controls sections" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/controls/${t.path}`}
            className={({ isActive }) => cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/controls/calendar" replace />} />
        <Route path="calendar" element={<CalendarTab />} />
        <Route path="activities" element={<ActivitiesTab />} />
        <Route path="evidence" element={<EvidenceTab />} />
        <Route path="exceptions" element={<ExceptionsTab />} />
        <Route path="advisories" element={<AdvisoriesTab />} />
        <Route path="vulnerabilities" element={<VulnerabilitiesTab />} />
        <Route path="kpis" element={<KpisTab />} />
        <Route path="*" element={<Navigate to="/controls/calendar" replace />} />
      </Routes>
    </div>
  )
}
