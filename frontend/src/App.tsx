import { lazy, Suspense, type ReactNode } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router"
import { AppShell } from "@/components/app-shell"
import { ErrorState, Loading } from "@/components/common/basics"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useSetupStatus } from "@/hooks/useSetupStatus"
import LoginPage from "@/pages/login"

const Dashboard = lazy(() => import("@/pages/dashboard"))
const MyWork = lazy(() => import("@/pages/my-work"))
const Assessments = lazy(() => import("@/pages/assessments"))
const AssessmentWorkspace = lazy(() => import("@/pages/assessment-workspace"))
const Catalog = lazy(() => import("@/pages/catalog"))
const RequirementPage = lazy(() => import("@/pages/requirement"))
const ActionPlan = lazy(() => import("@/pages/action-plan"))
const ProjectPage = lazy(() => import("@/pages/project"))
const WorkPackages = lazy(() => import("@/pages/work-packages"))
const WorkPackagePage = lazy(() => import("@/pages/work-package"))
const Tasks = lazy(() => import("@/pages/tasks"))
const Documents = lazy(() => import("@/pages/documents"))
const DocumentPage = lazy(() => import("@/pages/document"))
const Regulations = lazy(() => import("@/pages/regulations"))
const Incidents = lazy(() => import("@/pages/incidents"))
const IncidentPage = lazy(() => import("@/pages/incident"))
const Assistant = lazy(() => import("@/pages/assistant"))
const Admin = lazy(() => import("@/pages/admin"))
const Profile = lazy(() => import("@/pages/profile"))
const Help = lazy(() => import("@/pages/help"))
const EntityPage = lazy(() => import("@/pages/entity"))
const Governance = lazy(() => import("@/pages/governance"))
const Risks = lazy(() => import("@/pages/risks"))
const RiskPage = lazy(() => import("@/pages/risk"))
const Controls = lazy(() => import("@/pages/controls"))
const Approvals = lazy(() => import("@/pages/approvals"))
const Suppliers = lazy(() => import("@/pages/suppliers"))
const SupplierPage = lazy(() => import("@/pages/supplier"))
const Inventory = lazy(() => import("@/pages/inventory"))
const Reports = lazy(() => import("@/pages/reports"))
const Checks = lazy(() => import("@/pages/checks"))
const Audits = lazy(() => import("@/pages/audits"))
const SetupPage = lazy(() => import("@/pages/setup"))

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading className="h-screen justify-center" />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (me.must_change_password && location.pathname !== "/profile") return <Navigate to="/profile?force=1" replace />
  return <>{children}</>
}

export function App() {
  const setup = useSetupStatus()
  if (setup.isLoading) return <Loading className="h-screen justify-center" />
  if (setup.isError) {
    // Without the answer the app cannot tell the setup page from the login page; do not guess.
    return <div className="mx-auto max-w-md p-8"><ErrorState error={setup.error} /><Button className="mt-4" onClick={() => window.location.reload()}>Reload</Button></div>
  }
  // While the first-run setup is due, every route is the setup page; afterwards the page is gone.
  if (setup.data?.needed) {
    return (
      <Routes>
        <Route path="/setup" element={<S><SetupPage /></S>} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<S><Dashboard /></S>} />
        <Route path="my-work" element={<S><MyWork /></S>} />
        <Route path="assessments" element={<S><Assessments /></S>} />
        <Route path="assessments/:id" element={<S><AssessmentWorkspace /></S>} />
        <Route path="catalog" element={<S><Catalog /></S>} />
        <Route path="catalog/:id" element={<S><RequirementPage /></S>} />
        <Route path="action-plan" element={<S><ActionPlan /></S>} />
        <Route path="projects/:id/*" element={<S><ProjectPage /></S>} />
        <Route path="work-packages" element={<S><WorkPackages /></S>} />
        <Route path="work-packages/:id" element={<S><WorkPackagePage /></S>} />
        <Route path="tasks" element={<S><Tasks /></S>} />
        <Route path="documents" element={<S><Documents /></S>} />
        <Route path="documents/:id" element={<S><DocumentPage /></S>} />
        <Route path="regulations" element={<S><Regulations /></S>} />
        <Route path="regulations/:id" element={<S><Regulations /></S>} />
        <Route path="incidents" element={<S><Incidents /></S>} />
        <Route path="incidents/:id" element={<S><IncidentPage /></S>} />
        <Route path="entities/:id" element={<S><EntityPage /></S>} />
        <Route path="governance/*" element={<S><Governance /></S>} />
        <Route path="audits/*" element={<S><Audits /></S>} />
        <Route path="risks" element={<S><Risks /></S>} />
        <Route path="risks/:id" element={<S><RiskPage /></S>} />
        <Route path="controls/*" element={<S><Controls /></S>} />
        <Route path="approvals" element={<S><Approvals /></S>} />
        <Route path="suppliers" element={<S><Suppliers /></S>} />
        <Route path="suppliers/:id" element={<S><SupplierPage /></S>} />
        <Route path="inventory/*" element={<S><Inventory /></S>} />
        <Route path="reports/*" element={<S><Reports /></S>} />
        <Route path="checks" element={<S><Checks /></S>} />
        <Route path="assistant" element={<S><Assistant /></S>} />
        <Route path="assistant/:id" element={<S><Assistant /></S>} />
        <Route path="admin/*" element={<S><Admin /></S>} />
        <Route path="profile" element={<S><Profile /></S>} />
        <Route path="help" element={<S><Help /></S>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}

function NotFound() {
  return <div className="p-10 text-center text-ink-3">This page does not exist.</div>
}
