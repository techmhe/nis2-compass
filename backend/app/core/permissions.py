"""Permission catalogue and built-in roles.

Permissions are coarse, verb-oriented strings. Role assignments can be scoped to a legal entity; for
entity-bound objects (answers, action items, entity documents ...) a scoped assignment grants the permission
only for that entity, a group-wide assignment grants it everywhere.
"""

PERMISSIONS: dict[str, str] = {
    "entities.read": "View legal entities",
    "entities.manage": "Create and edit legal entities and stakeholders",
    "catalog.read": "View requirement catalogue",
    "catalog.manage": "Edit requirements, chapters and chapter targets",
    "assessments.read": "View assessments and answers",
    "assessments.edit": "Answer requirements",
    "assessments.manage": "Create assessment rounds, lock and complete assessments",
    "findings.read": "View the action plan",
    "findings.manage": "Create and edit action plan items",
    "projects.read": "View projects, master plan, gates, RACI and RAID",
    "projects.manage": "Edit projects, master plan, gates, RACI and RAID",
    "workpackages.read": "View work packages",
    "workpackages.manage": "Create and edit work packages",
    "tasks.read": "View all tasks",
    "tasks.manage": "Create, assign and edit any task",
    "documents.read": "View and download documents",
    "documents.upload": "Upload documents and new versions",
    "documents.manage": "Edit metadata and delete any document",
    "regulations.read": "Browse the regulations library",
    "regulations.manage": "Edit regulations and requirement links",
    "governance.read": "View registrations, management body, trainings and obligations",
    "governance.manage": "Maintain registrations, management body, decisions and trainings",
    "risks.read": "View the risk register",
    "risks.manage": "Create, assess and treat risks",
    "assets.read": "View services, assets, BIA and continuity exercises",
    "assets.manage": "Maintain services, assets, BIA and continuity exercises",
    "suppliers.read": "View the supplier register",
    "suppliers.manage": "Maintain suppliers, contract clauses and supplier assessments",
    "controls.read": "View recurring controls, evidence and KPIs",
    "controls.manage": "Plan recurring controls and KPIs",
    "audits.read": "View the audit programme, audits, findings and effectiveness/management reviews",
    "audits.manage": "Plan audits, record findings and maintain effectiveness/management reviews",
    "incidents.read": "View the incident register",
    "incidents.manage": "Record and edit incidents",
    "ai.use": "Use the AI assistant",
    "reports.export": "Export reports and workbooks",
    "audit.read": "View the audit log",
    "users.manage": "Manage users and role assignments",
    "roles.manage": "Manage roles and permissions",
    "settings.manage": "Manage system settings (AI, OIDC info, branding)",
}

ALL = list(PERMISSIONS)
READ_ALL = [p for p in ALL if p.endswith(".read")]

BUILTIN_ROLES: list[dict] = [
    {
        "key": "admin",
        "name": "Administrator",
        "description": "Full access including users, roles and system settings.",
        "permissions": ALL,
    },
    {
        "key": "security_officer",
        "name": "Information Security Officer",
        "description": "Owns the NIS2 programme: assessments, action plan, project, documents.",
        "permissions": [p for p in ALL if p not in ("roles.manage", "settings.manage")],
    },
    {
        "key": "project_manager",
        "name": "Project Manager",
        "description": "Plans and steers the implementation project, work packages and tasks.",
        "permissions": READ_ALL
        + [
            "projects.manage",
            "workpackages.manage",
            "tasks.manage",
            "findings.manage",
            "documents.upload",
            "controls.manage",
            "ai.use",
            "reports.export",
        ],
    },
    {
        "key": "assessor",
        "name": "Assessor",
        "description": "Conducts the GAP assessment interviews and records findings.",
        "permissions": READ_ALL
        + [
            "assessments.edit",
            "findings.manage",
            "documents.upload",
            "incidents.manage",
            "risks.manage",
            "assets.manage",
            "suppliers.manage",
            "controls.manage",
            "ai.use",
            "reports.export",
        ],
    },
    {
        "key": "contributor",
        "name": "Contributor",
        "description": "Entity staff: answers requirements, uploads evidence and works on assigned tasks.",
        "permissions": [
            "entities.read",
            "catalog.read",
            "assessments.read",
            "assessments.edit",
            "findings.read",
            "projects.read",
            "workpackages.read",
            "documents.read",
            "documents.upload",
            "regulations.read",
            "incidents.read",
            "governance.read",
            "risks.read",
            "assets.read",
            "suppliers.read",
            "controls.read",
            "audits.read",
            "ai.use",
        ],
    },
    {
        "key": "viewer",
        "name": "Viewer",
        "description": "Read-only access to all content.",
        "permissions": [p for p in READ_ALL if p != "audit.read"] + ["ai.use"],
    },
    {
        "key": "auditor",
        "name": "Auditor",
        "description": "Read-only access including the audit log and exports.",
        "permissions": READ_ALL + ["reports.export"],
    },
]
