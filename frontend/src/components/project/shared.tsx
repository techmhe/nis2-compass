import { useQuery } from "@tanstack/react-query"
import { differenceInCalendarDays, parseISO } from "date-fns"
import { api } from "@/lib/api"
import type { Activity, Gate, Phase, Project, RaidRecord } from "@/lib/types"
import { cn } from "@/lib/utils"

export interface ProjectDashboard {
  activities: {
    total: number; completed: number; in_progress: number; blocked: number; overall_progress: number
    green: number; amber: number; red: number; not_planned: number; finishing_next_30_days: number
  }
  phases: { phase: string; activities: number; completed: number; progress: number; overdue: number }[]
  gates: { id: number; code: string; planned_date: string | null; status: string; decision: string | null; activities: number; open_activities: number; days_to_gate: number | null; overdue: boolean }[]
  work_packages: { total: number; by_status: Record<string, number>; high_priority_open: number; overdue: number }
  raid: { open_risks: number; open_issues: number; decisions: number; high_severity_open: number; escalations: number; overdue: number }
}

export interface GanttRow {
  type: "activity" | "work_package"
  id: number
  code: string
  title: string
  planned_start: string | null
  planned_finish: string | null
  status: string
  progress: number
  priority: string
  schedule_status: string
  phase: { id?: number; name: string; sort_order?: number } | null
  is_milestone?: boolean
  dependencies?: { id: number; code: string }[]
  owner?: { name: string } | null
  gate?: { id: number; code: string } | null
}

export interface GanttData {
  project: { id: number; name: string; planned_start: string | null; planned_finish: string | null }
  start: string | null
  end: string | null
  rows: GanttRow[]
  gates: { id: number; code: string; planned_date: string | null; status: string; decision: string | null }[]
}

export const projectKeys = {
  project: (id: number) => ["project", id] as const,
  activities: (id: number) => ["activities", id] as const,
  gates: (id: number) => ["gates", id] as const,
  phases: (id: number) => ["phases", id] as const,
  raid: (id: number) => ["raid", id] as const,
  raci: (id: number) => ["raci", id] as const,
  gantt: (id: number) => ["gantt", id] as const,
  dashboard: (id: number) => ["project-dashboard", id] as const,
}

/** Everything that depends on activities, for invalidation after edits. */
export const ACTIVITY_DEPENDENT = ["activities", "gantt", "project-dashboard", "gates", "dash-home", "me-work"]

export function useProject(id: number) {
  return useQuery({ queryKey: projectKeys.project(id), queryFn: () => api.get<Project>(`/projects/${id}`), enabled: Number.isFinite(id) })
}
export function useActivities(id: number) {
  return useQuery({ queryKey: projectKeys.activities(id), queryFn: () => api.get<Activity[]>(`/projects/${id}/activities`) })
}
export function useGates(id: number) {
  return useQuery({ queryKey: projectKeys.gates(id), queryFn: () => api.get<Gate[]>(`/projects/${id}/gates`) })
}
export function usePhases(id: number) {
  return useQuery({ queryKey: projectKeys.phases(id), queryFn: () => api.get<Phase[]>(`/projects/${id}/phases`), staleTime: 60_000 })
}
export function useRaid(id: number) {
  return useQuery({ queryKey: projectKeys.raid(id), queryFn: () => api.get<RaidRecord[]>(`/projects/${id}/raid`) })
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null
  return differenceInCalendarDays(parseISO(d), new Date())
}

export function daysLabel(days: number | null): string {
  if (days == null) return "–"
  if (days === 0) return "today"
  if (days > 0) return days === 1 ? "in 1 day" : `in ${days} days`
  return days === -1 ? "1 day late" : `${-days} days late`
}

const SCHEDULE_DOT: Record<string, string> = {
  Green: "bg-sage", Amber: "bg-amber", Red: "bg-alarm", "Not Planned": "bg-input",
}
const SCHEDULE_LABEL: Record<string, string> = {
  Green: "On schedule", Amber: "Finishing soon", Red: "Overdue", "Not Planned": "Not planned",
}

/** Compact traffic light used in tables. */
export function ScheduleDot({ value, withLabel = true, className }: { value: string; withLabel?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-ink-2", className)} title={SCHEDULE_LABEL[value] ?? value}>
      <span className={cn("size-2 rounded-full", SCHEDULE_DOT[value] ?? "bg-input")} />
      {withLabel && (SCHEDULE_LABEL[value] ?? value)}
    </span>
  )
}

/** Normalise empty strings to null for API payloads. */
export function nn<T>(v: T | "" | undefined): T | null {
  return v === "" || v === undefined ? null : v
}

/** Tone for a RAID/impact rating. */
export function ratingTone(v: string | null | undefined): string {
  return v === "High" ? "alarm" : v === "Medium" ? "amber" : v === "Low" ? "sage" : "neutral"
}
