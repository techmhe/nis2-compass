import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, setUnauthorizedHandler } from "@/lib/api"
import type { AuthConfig, Me } from "@/lib/types"

interface AuthState {
  me: Me | null
  config: AuthConfig | undefined
  loading: boolean
  /** Permission held group-wide or (if entityId given) for that entity. */
  can: (perm: string, entityId?: number | null) => boolean
  /** Permission held anywhere (group-wide or for at least one entity). */
  canAny: (perm: string) => boolean
  /** Permission held group-wide. */
  canGlobal: (perm: string) => boolean
  logout: () => Promise<void>
  refresh: () => Promise<unknown>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<AuthConfig>("/auth/config"), staleTime: Infinity })
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me")
      } catch (e: any) {
        if (e?.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["me"], null)
    })
  }, [qc])

  const me = meQ.data ?? null
  const can = useCallback(
    (perm: string, entityId?: number | null) => {
      if (!me) return false
      if (me.global_permissions.includes(perm)) return true
      return entityId != null && (me.entity_permissions[String(entityId)] ?? []).includes(perm)
    },
    [me],
  )
  const canAny = useCallback((perm: string) => !!me?.permissions.includes(perm), [me])
  const canGlobal = useCallback((perm: string) => !!me?.global_permissions.includes(perm), [me])
  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout")
    } finally {
      qc.clear()
      qc.setQueryData(["me"], null)
      window.location.href = "/login"
    }
  }, [qc])

  const value = useMemo<AuthState>(
    () => ({ me, config: config.data, loading: meQ.isLoading, can, canAny, canGlobal, logout, refresh: meQ.refetch }),
    [me, config.data, meQ.isLoading, can, canAny, canGlobal, logout, meQ.refetch],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAuth outside AuthProvider")
  return v
}
