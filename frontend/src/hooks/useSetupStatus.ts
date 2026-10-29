import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface SetupOptions {
  jurisdictions: { code: string; name: string; legal_forms: string[]; competent_authority: string; csirt: string }[]
  sectors: { key: string; label: string }[]
  size_classes: string[]
  password_min_length: number
  local_enabled: boolean
  oidc_enabled: boolean
  project_exists: boolean
  roles: OfferedRole[]
}

export interface OfferedRole {
  name: string
  description: string | null
  kind: string
  mandatory: boolean
  /** Only set for the external advisers: offered when a company in this country is entered. */
  country: string | null
}

/** Whether the first-run setup is still due. It never flips back, so it is fetched once per page load. */
export function useSetupStatus() {
  return useQuery({ queryKey: ["setup-status"], queryFn: () => api.get<{ needed: boolean }>("/setup/status"), staleTime: Infinity })
}

/** Choices for the setup page; /entities/options needs a session, this one does not. */
export function useSetupOptions() {
  return useQuery({ queryKey: ["setup-options"], queryFn: () => api.get<SetupOptions>("/setup/options"), staleTime: Infinity })
}
