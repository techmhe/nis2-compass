import { NavLink, Navigate, Route, Routes, useParams, useSearchParams } from "react-router"
import { ErrorState, PageHeader } from "@/components/common/basics"
import { AssetSheet, AssetsTab } from "@/components/inventory/assets"
import { BiaTab } from "@/components/inventory/bia"
import { DependenciesTab } from "@/components/inventory/dependencies"
import { OverviewTab } from "@/components/inventory/overview"
import { ExerciseSheet, PlanSheet, PlansTab } from "@/components/inventory/plans"
import { ServiceSheet, ServicesTab } from "@/components/inventory/services"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const TABS = [
  { path: "", label: "Overview" },
  { path: "services", label: "Services" },
  { path: "assets", label: "Assets" },
  { path: "dependencies", label: "Dependencies" },
  { path: "bia", label: "BIA" },
  { path: "plans", label: "Plans and exercises" },
]

const SHEETS = ["service", "asset", "plan", "exercise"] as const

function BiaRoute() {
  const { id } = useParams()
  const n = Number(id)
  return Number.isFinite(n) ? <BiaTab biaId={n} /> : <Navigate to="/inventory/bia" replace />
}

export default function InventoryPage() {
  const { canAny } = useAuth()
  const [params, setParams] = useSearchParams()
  if (!canAny("assets.read")) return <ErrorState error="You do not have permission to view services, assets and continuity data." />

  const sheetId = (k: (typeof SHEETS)[number]) => {
    const v = params.get(k)
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) ? n : null
  }
  const close = (k: (typeof SHEETS)[number]) => setParams((p) => { p.delete(k); return p }, { replace: true })
  // search params survive tab changes only for the entity filter
  const keep = params.get("entity") ? `?entity=${params.get("entity")}` : ""

  return (
    <div>
      <PageHeader
        title="Services and continuity"
        description="Inventory of services, processes and assets with their dependencies (IR 2024/2690 point 12.4), business impact analysis (4.1.3), continuity plans and the exercise and restore-test log (4.1.4, 4.2.6)."
      />
      <nav aria-label="Services and continuity sections" className="mb-5 flex gap-1 overflow-x-auto border-b scroll-thin">
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/inventory${t.path ? `/${t.path}` : ""}${keep}`} end={t.path === ""}
            className={({ isActive }) => cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-petrol text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="services" element={<ServicesTab />} />
        <Route path="assets" element={<AssetsTab />} />
        <Route path="dependencies" element={<DependenciesTab />} />
        <Route path="bia" element={<BiaTab biaId={null} />} />
        <Route path="bia/:id" element={<BiaRoute />} />
        <Route path="plans" element={<PlansTab />} />
        <Route path="*" element={<Navigate to="/inventory" replace />} />
      </Routes>

      <ServiceSheet id={sheetId("service")} onClose={() => close("service")} />
      <AssetSheet id={sheetId("asset")} onClose={() => close("asset")} />
      <PlanSheet id={sheetId("plan")} onClose={() => close("plan")} />
      <ExerciseSheet id={sheetId("exercise")} onClose={() => close("exercise")} />
    </div>
  )
}
