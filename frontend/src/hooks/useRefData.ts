import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Entity, Project, Round, Stakeholder } from "@/lib/types"
import { useAuth } from "./useAuth"

export function useEntities() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: ["entities"], queryFn: () => api.get<Entity[]>("/entities"), staleTime: 5 * 60_000, enabled: canAny("entities.read") })
}

export interface EntityOptions {
  jurisdictions: { code: string; name: string; legal_forms: string[] }[]
  sectors: { key: string; label: string }[]
  size_classes: string[]
}

export function useEntityOptions() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: ["entity-options"], queryFn: () => api.get<EntityOptions>("/entities/options"), staleTime: Infinity, enabled: canAny("entities.read") })
}

export function useStakeholders() {
  return useQuery({ queryKey: ["stakeholders"], queryFn: () => api.get<Stakeholder[]>("/stakeholders"), staleTime: 5 * 60_000 })
}

export interface DirectoryUser { id: number; email: string; display_name: string; job_title: string | null; is_active: boolean }
export function useUsers() {
  return useQuery({ queryKey: ["users-directory"], queryFn: () => api.get<DirectoryUser[]>("/users/directory"), staleTime: 5 * 60_000 })
}

export function useRounds() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: ["rounds"], queryFn: () => api.get<Round[]>("/rounds"), staleTime: 60_000, enabled: canAny("assessments.read") })
}

export function useProjects() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects"), staleTime: 60_000, enabled: canAny("projects.read") })
}

/** The main implementation project (first project). */
export function useMainProject() {
  const q = useProjects()
  return { ...q, project: q.data?.[0] }
}
