import { useEffect, type ReactNode } from "react"
import { NavLink, useNavigate, useParams } from "react-router"
import { Bot, Building2, FileSpreadsheet, History, KeyRound, ListOrdered, Server, ShieldCheck, Users, UsersRound } from "lucide-react"
import { Empty, PageHeader } from "@/components/common/basics"
import { AiSection } from "@/components/admin/ai"
import { AuditSection } from "@/components/admin/audit"
import { ChaptersSection } from "@/components/admin/chapters"
import { DataSection } from "@/components/admin/data"
import { EntitiesSection } from "@/components/admin/entities"
import { RolesSection } from "@/components/admin/roles"
import { StakeholdersSection } from "@/components/admin/stakeholders"
import { SystemSection } from "@/components/admin/system"
import { UsersSection } from "@/components/admin/users"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

interface AdminSection {
  key: string
  label: string
  icon: ReactNode
  description: string
  visible: boolean
  render: () => ReactNode
}

export default function AdminPage() {
  const params = useParams()
  const navigate = useNavigate()
  const { canAny, canGlobal } = useAuth()
  const current = (params["*"] ?? "").split("/")[0]

  const sections: AdminSection[] = [
    { key: "users", label: "Users", icon: <Users />, visible: canGlobal("users.manage"),
      description: "Accounts, role assignments and entity scopes. A role assigned to an entity applies to that entity's data only.",
      render: () => <UsersSection /> },
    { key: "roles", label: "Roles and permissions", icon: <KeyRound />, visible: canGlobal("roles.manage") || canGlobal("users.manage"),
      description: "What each role may do. Built-in roles can be adjusted; the administrator role is fixed.",
      render: () => <RolesSection canEdit={canGlobal("roles.manage")} /> },
    { key: "entities", label: "Entities", icon: <Building2 />, visible: canAny("entities.manage"),
      description: "Legal entities of the group with their NIS-2 classification, competent authority and registration.",
      render: () => <EntitiesSection /> },
    { key: "stakeholders", label: "Stakeholders", icon: <UsersRound />, visible: canGlobal("entities.manage"),
      description: "Roles and people that can be named as responsible in the assessment, action plan and project. Link a stakeholder to a user so the work shows up in their “My work”.",
      render: () => <StakeholdersSection /> },
    { key: "chapters", label: "Chapters and targets", icon: <ListOrdered />, visible: canGlobal("catalog.manage"),
      description: "Target maturity per chapter of the requirement catalogue. Every change is recorded with a reason.",
      render: () => <ChaptersSection /> },
    { key: "ai", label: "AI assistant", icon: <Bot />, visible: canGlobal("settings.manage"),
      description: "Connection to an OpenAI-compatible model endpoint for the assistant, summaries and semantic search.",
      render: () => <AiSection /> },
    { key: "data", label: "Import and export", icon: <FileSpreadsheet />, visible: canAny("reports.export") || canAny("assessments.edit"),
      description: "Excel workbooks in the format of the original GAP analysis and project plan.",
      render: () => <DataSection /> },
    { key: "audit", label: "Audit log", icon: <History />, visible: canAny("audit.read"),
      description: "Every change, sign-in, export and download, with the acting user and IP address.",
      render: () => <AuditSection /> },
    { key: "system", label: "System", icon: <Server />, visible: canGlobal("settings.manage"),
      description: "Runtime configuration, single sign-on, search index and general settings.",
      render: () => <SystemSection /> },
  ]
  const visible = sections.filter((s) => s.visible)
  const active = visible.find((s) => s.key === current)

  useEffect(() => {
    if (!active && visible.length) navigate(`/admin/${visible[0].key}`, { replace: true })
  }, [active, visible, navigate])

  if (!visible.length) {
    return (
      <div>
        <PageHeader title="Administration" />
        <Empty title="No administration rights" icon={<ShieldCheck className="size-6" />}>
          Your roles do not include any administrative permission. Ask an administrator if you need access.
        </Empty>
      </div>
    )
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Administration" className="lg:sticky lg:top-20">
        <div className="mb-3 px-2 text-[15px] font-semibold text-ink">Administration</div>
        <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
          {visible.map((s) => (
            <li key={s.key}>
              <NavLink to={`/admin/${s.key}`} data-tour={`admin.${s.key}`}
                className={({ isActive }) => cn("flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] [&_svg]:size-4 [&_svg]:shrink-0",
                  isActive ? "bg-petrol-50 font-medium text-petrol" : "text-ink-2 hover:bg-muted hover:text-ink")}>
                {s.icon}{s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        {active && (
          <>
            <PageHeader title={active.label} description={active.description} />
            {active.render()}
          </>
        )}
      </div>
    </div>
  )
}
