export const SCOPE_VALUES = ["In Scope", "Central at HQ", "Not Applicable"] as const
export const IMPL_VALUES = ["Yes", "Partial", "No", "N/A"] as const
export const EFF_VALUES = ["Effective", "Partial", "Not Tested", "Ineffective", "N/A"] as const
export const EFFORT_VALUES = ["Low", "Medium", "High"] as const
export const PRIORITY_VALUES = ["High", "Medium", "Low"] as const
export const ACTION_STATUS = ["Not Started", "In Progress", "Completed", "Blocked", "Deferred"] as const
export const PROJECT_STATUS = ["Not Started", "In Progress", "Completed", "Blocked", "Deferred", "Cancelled"] as const
export const RAID_TYPES = ["Risk", "Issue", "Decision", "Assumption"] as const
export const RAID_STATUS = ["Open", "In Progress", "Closed", "Accepted", "Escalated"] as const
export const RATING = ["High", "Medium", "Low"] as const
export const RACI_VALUES = ["R", "A", "C", "I", "A/R", "-"] as const
export const MEASURE_AREAS = [
  "Governance", "Risk Management", "Incident Handling and Reporting", "Business Continuity", "Supply Chain Security",
  "Access Control", "Asset Management", "Awareness and Training", "Cryptography", "Vulnerability Management",
  "Logging and Monitoring", "Physical Security", "Supplier and MSP Governance",
] as const
export const TASK_STATUSES = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
] as const
export const TASK_STATUS_LABEL: Record<string, string> = Object.fromEntries(TASK_STATUSES.map((s) => [s.key, s.label]))
export const ASSESSMENT_STATUS: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", in_review: "In review", completed: "Completed",
}
export const NIS2_CLASS: Record<string, string> = {
  essential: "Essential entity", important: "Important entity", not_in_scope: "Not in scope", tbd: "To be determined",
}
export const INCIDENT_SEVERITY = ["Low", "Medium", "High", "Critical"] as const
export const INCIDENT_STATUS = ["Open", "Contained", "Resolved", "Closed"] as const
