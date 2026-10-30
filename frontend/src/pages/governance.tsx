import { NavLink, Navigate, Route, Routes } from "react-router"
import { ErrorState, PageHeader, Stat } from "@/components/common/basics"
import { LegalView } from "@/components/governance/legal"
import { ManagementView } from "@/components/governance/management"
import { ObligationsView } from "@/components/governance/obligations"
import { RegistrationsView } from "@/components/governance/registrations"
import { useGovOverview } from "@/components/governance/shared"
import { TrainingsView } from "@/components/governance/trainings"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const TABS = [
  { path: "obligations", label: "Obligations", tour: "programme.obligations" },
  { path: "registrations", label: "Registrations", tour: "programme.registrations" },
  { path: "management", label: "Management body", tour: "programme.management" },
  { path: "trainings", label: "Trainings", tour: "programme.trainings" },
  { path: "legal", label: "Legal basis", tour: "programme.legal" },
]

function OverviewStrip() {
  const q = useGovOverview()
  const d = q.data
  if (!d) return null
  const ob = d.obligations, ch = d.registration_changes, tr = d.training
  return (
    <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-4">
      <Stat label="Overdue obligations" value={ob.overdue} hint={`${ob.open} open, ${ob.due_soon} due within 30 days`} tone={ob.overdue ? "alarm" : undefined} />
      <Stat label="Registration changes to report" value={ch.pending} hint={ch.overdue ? `${ch.overdue} past the two-week deadline` : "Two weeks from becoming known"} tone={ch.overdue ? "alarm" : ch.pending ? "amber" : undefined} />
      <Stat label="Training overdue" value={tr.overdue} hint={`${tr.members} active members, ${tr.due} due`} tone={tr.overdue ? "alarm" : undefined} />
      <Stat label="Members compliant" value={tr.members ? `${tr.compliant} of ${tr.members}` : "–"} hint="Training rule met" tone={tr.members && tr.compliant === tr.members ? "petrol" : undefined} />
    </div>
  )
}

export default function GovernancePage() {
  const { canAny } = useAuth()
  if (!canAny("governance.read")) return <ErrorState error="You do not have permission to view governance data." />
  return (
    <div>
      <PageHeader title="Governance"
        description="Registrations with the authorities, the obligation calendar, the management body with its decisions and trainings, and the legal basis of each requirement per jurisdiction." />
      <OverviewStrip />
      <nav aria-label="Governance sections" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/governance/${t.path}`} data-tour={t.tour}
            className={({ isActive }) => cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="obligations" replace />} />
        <Route path="obligations" element={<ObligationsView />} />
        <Route path="registrations" element={<RegistrationsView />} />
        <Route path="management" element={<ManagementView />} />
        <Route path="trainings" element={<TrainingsView />} />
        <Route path="legal" element={<LegalView />} />
        <Route path="*" element={<Navigate to="/governance/obligations" replace />} />
      </Routes>
    </div>
  )
}
