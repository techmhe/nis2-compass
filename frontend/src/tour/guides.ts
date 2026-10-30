import { recommendedChapters } from "./recommend"
import type { ChapterId } from "./types"

/** Stands for the main project's page; the id is only known at run time. */
export const PROJECT_PATH = "/projects/:main"

export interface GuidePage { label: string; to: string; /** Held anywhere, else the page is shown as plain text. */ perm?: string }

export interface RoleGuide {
  /** Key of the built-in role, see backend/app/core/permissions.py. */
  key: string
  /** The role's display name; the same as in the backend. */
  name: string
  whatYouDo: string
  typicalWork: string[]
  pages: GuidePage[]
}

/** The 7 built-in roles, from the security officer to the auditor. */
export const ROLE_GUIDES: RoleGuide[] = [
  {
    key: "security_officer",
    name: "Information Security Officer",
    whatYouDo: "You own the NIS-2 programme. You keep the assessments, the action plan and the project moving, and you report the state of compliance to management.",
    typicalWork: [
      "Check the compliance matrix and the largest gaps on the Dashboard",
      "Review assessments and turn gaps into findings in the action plan",
      "Steer the project, its gates and the work packages",
      "Keep risks, controls, suppliers and incidents up to date",
      "Prepare reports for management and the authorities",
    ],
    pages: [
      { label: "Dashboard", to: "/" },
      { label: "Assessments", to: "/assessments", perm: "assessments.read" },
      { label: "Action plan", to: "/action-plan", perm: "findings.read" },
      { label: "Project", to: PROJECT_PATH, perm: "projects.read" },
      { label: "Governance", to: "/governance", perm: "governance.read" },
      { label: "Reports", to: "/reports", perm: "assessments.read" },
    ],
  },
  {
    key: "admin",
    name: "Administrator",
    whatYouDo: "You run the system for the group. You set up the companies, the users and their roles, and the system settings.",
    typicalWork: [
      "Add the legal entities of the group and set their NIS-2 classification",
      "Create users and assign roles, for the whole group or for one company",
      "Adjust the built-in roles or add your own",
      "Check the system settings and the search index",
      "Look into the audit log when you need to know who changed what",
    ],
    pages: [
      { label: "Administration", to: "/admin" },
      { label: "Users", to: "/admin/users", perm: "users.manage" },
      { label: "Roles", to: "/admin/roles", perm: "roles.manage" },
      { label: "Entities", to: "/admin/entities", perm: "entities.manage" },
      { label: "System", to: "/admin/system", perm: "settings.manage" },
      { label: "Audit log", to: "/admin/audit", perm: "audit.read" },
    ],
  },
  {
    key: "project_manager",
    name: "Project Manager",
    whatYouDo: "You plan and steer the implementation project. You keep the master plan, the gates, the work packages and the tasks on track.",
    typicalWork: [
      "Keep the master plan and the gates current",
      "Maintain who is responsible in the RACI matrix",
      "Bundle findings into work packages and follow their progress",
      "Assign and follow up tasks on the board",
      "Run the data quality checks and decide approvals",
    ],
    pages: [
      { label: "Project", to: PROJECT_PATH, perm: "projects.read" },
      { label: "Work packages", to: "/work-packages", perm: "workpackages.read" },
      { label: "Tasks", to: "/tasks" },
      { label: "Data quality", to: "/checks", perm: "assessments.read" },
      { label: "Approvals", to: "/approvals" },
    ],
  },
  {
    key: "assessor",
    name: "Assessor",
    whatYouDo: "You conduct the GAP assessment interviews and record what you find. Gaps become findings in the action plan.",
    typicalWork: [
      "Open an assessment and work through its requirements",
      "Rate Implemented, Documented and Effectiveness, and attach evidence",
      "Record findings and follow them in the action plan",
      "Record risks and incidents that come up in the interviews",
    ],
    pages: [
      { label: "Assessments", to: "/assessments", perm: "assessments.read" },
      { label: "Requirements", to: "/catalog", perm: "catalog.read" },
      { label: "Action plan", to: "/action-plan", perm: "findings.read" },
      { label: "Risks", to: "/risks", perm: "risks.read" },
      { label: "Incidents", to: "/incidents", perm: "incidents.read" },
    ],
  },
  {
    key: "contributor",
    name: "Contributor",
    whatYouDo: "You answer the requirements for your company and upload the evidence. You also work on the tasks assigned to you.",
    typicalWork: [
      "Open My work to see your questions, tasks and approvals",
      "Set the Scope of a requirement first, then rate it",
      "Upload evidence or link a document",
      "Comment where you need input from a colleague",
      "Save an answer as draft until it is ready for review",
    ],
    pages: [
      { label: "My work", to: "/my-work" },
      { label: "Assessments", to: "/assessments", perm: "assessments.read" },
      { label: "Documents", to: "/documents", perm: "documents.read" },
      { label: "Tasks", to: "/tasks" },
      { label: "Assistant", to: "/assistant", perm: "ai.use" },
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    whatYouDo: "You follow the programme without changing anything. You see where the group stands and can read the documents and regulations.",
    typicalWork: [
      "Read the Dashboard for coverage, scores and gaps",
      "Look up policies and other documents",
      "Check the registrations and obligations in Governance",
      "Ask the Assistant a question about the programme",
    ],
    pages: [
      { label: "Dashboard", to: "/" },
      { label: "Governance", to: "/governance", perm: "governance.read" },
      { label: "Documents", to: "/documents", perm: "documents.read" },
      { label: "Regulations", to: "/regulations", perm: "regulations.read" },
      { label: "Assistant", to: "/assistant", perm: "ai.use" },
    ],
  },
  {
    key: "auditor",
    name: "Auditor",
    whatYouDo: "You review the programme independently. You can read everything, including the audit log, and export reports.",
    typicalWork: [
      "Read the audit programme, audit findings and reviews",
      "Check documents and evidence against the answers",
      "Follow the registrations and obligations in Governance",
      "Export reports for your review",
    ],
    pages: [
      { label: "Audits & reviews", to: "/audits", perm: "audits.read" },
      { label: "Governance", to: "/governance", perm: "governance.read" },
      { label: "Documents", to: "/documents", perm: "documents.read" },
      { label: "Reports", to: "/reports", perm: "assessments.read" },
      { label: "Audit log", to: "/admin/audit", perm: "audit.read" },
    ],
  },
]

/** The chapters recommended for a role, whatever the current user can open. */
export function guideChapters(roleKey: string): ChapterId[] {
  return recommendedChapters([{ key: roleKey }], () => true, [])
}
