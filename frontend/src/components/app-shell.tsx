import { useEffect, useState, type ReactNode } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bell, BookOpen, Bot, FileBarChart, Boxes, CalendarCheck, ClipboardList, Landmark, ShieldAlert, Stamp, Truck, CalendarRange, ChevronsLeft, ChevronsRight, ClipboardCheck, FileStack, FolderKanban,
  Gauge, KeyRound, LayoutList, ListChecks, LogOut, Monitor, Moon, PackageCheck, Scale, Search, Settings, Siren,
  Sun, UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/common/collab"
import { PageErrorBoundary } from "@/components/error-boundary"
import { useAuth } from "@/hooks/useAuth"
import { useMainProject } from "@/hooks/useRefData"
import { useTheme } from "@/hooks/useTheme"
import { api } from "@/lib/api"
import { fromNow } from "@/lib/format"
import type { NotificationItem, SearchHit } from "@/lib/types"
import { cn } from "@/lib/utils"

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string; end?: boolean }

function useNav(): { group: string; items: NavItem[] }[] {
  const { project } = useMainProject()
  const pid = project?.id ?? 1
  return [
    { group: "Overview", items: [
      { to: "/", label: "Dashboard", icon: <Gauge />, end: true },
      { to: "/my-work", label: "My work", icon: <UserRound /> },
      { to: "/reports", label: "Reports", icon: <FileBarChart />, perm: "assessments.read" },
    ] },
    { group: "Assess", items: [
      { to: "/assessments", label: "Assessments", icon: <ClipboardCheck />, perm: "assessments.read" },
      { to: "/catalog", label: "Requirements", icon: <LayoutList />, perm: "catalog.read" },
      { to: "/action-plan", label: "Action plan", icon: <ListChecks />, perm: "findings.read" },
    ] },
    { group: "Govern", items: [
      { to: "/governance", label: "Governance", icon: <Landmark />, perm: "governance.read" },
      { to: "/audits", label: "Audits & reviews", icon: <ClipboardList />, perm: "audits.read" },
      { to: "/risks", label: "Risks", icon: <ShieldAlert />, perm: "risks.read" },
      { to: "/controls", label: "Controls & KPIs", icon: <CalendarCheck />, perm: "controls.read" },
      { to: "/approvals", label: "Approvals", icon: <Stamp /> },
      { to: "/checks", label: "Data quality", icon: <ListChecks />, perm: "assessments.read" },
    ] },
    { group: "Implement", items: [
      { to: `/projects/${pid}`, label: "Project", icon: <CalendarRange />, perm: "projects.read" },
      { to: "/work-packages", label: "Work packages", icon: <PackageCheck />, perm: "workpackages.read" },
      { to: "/tasks", label: "Tasks", icon: <FolderKanban /> },
    ] },
    { group: "Knowledge", items: [
      { to: "/documents", label: "Documents", icon: <FileStack />, perm: "documents.read" },
      { to: "/regulations", label: "Regulations", icon: <Scale />, perm: "regulations.read" },
      { to: "/assistant", label: "Assistant", icon: <Bot />, perm: "ai.use" },
    ] },
    { group: "Operate", items: [
      { to: "/incidents", label: "Incidents", icon: <Siren />, perm: "incidents.read" },
      { to: "/suppliers", label: "Suppliers", icon: <Truck />, perm: "suppliers.read" },
      { to: "/inventory", label: "Services & continuity", icon: <Boxes />, perm: "assets.read" },
    ] },
  ]
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { canAny, config } = useAuth()
  const nav = useNav()
  const adminVisible = ["users.manage", "roles.manage", "settings.manage", "audit.read", "entities.manage", "catalog.manage"].some(canAny)
  const item = (it: NavItem) => (
    <NavLink key={it.to} to={it.to} end={it.end}
      className={({ isActive }) => cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        isActive ? "bg-sidebar-accent text-white" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white",
        collapsed && "justify-center px-0",
      )}>
      {collapsed ? (
        <Tooltip><TooltipTrigger asChild><span className="flex">{it.icon}</span></TooltipTrigger><TooltipContent side="right">{it.label}</TooltipContent></Tooltip>
      ) : <>{it.icon}<span className="truncate">{it.label}</span></>}
    </NavLink>
  )
  return (
    <aside className={cn("sticky top-0 flex h-screen print:hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width]",
      collapsed ? "w-[56px]" : "w-[232px]")}>
      <Link to="/" className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <Logo />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[14px] font-semibold text-white">{config?.app_name ?? "NIS2 Compass"}</div>
            <div className="text-[11px] text-sidebar-muted">NIS-2 programme</div>
          </div>
        )}
      </Link>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2 scroll-thin">
        {nav.map((g) => {
          const items = g.items.filter((i) => !i.perm || canAny(i.perm))
          if (!items.length) return null
          return (
            <div key={g.group}>
              {!collapsed && <div className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-muted">{g.group}</div>}
              <div className="space-y-0.5">{items.map(item)}</div>
            </div>
          )
        })}
      </nav>
      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        {adminVisible && item({ to: "/admin", label: "Administration", icon: <Settings /> })}
        <button onClick={onToggle} className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-white [&_svg]:size-4", collapsed && "justify-center px-0")}>
          {collapsed ? <ChevronsRight /> : <><ChevronsLeft /> Collapse</>}
        </button>
      </div>
    </aside>
  )
}

export function Logo({ className }: { className?: string }) {
  // Compass needle over a shield outline: orientation within a regulated space
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <path d="M16 2.5 27 6.5v8.2c0 7-4.6 12.3-11 14.8C9.6 27 5 21.7 5 14.7V6.5L16 2.5Z" fill="none" stroke="#3fb0b8" strokeWidth="1.8" />
      <path d="M16 8.5 19 16l-3 7.5L13 16l3-7.5Z" fill="#d4a54a" />
      <circle cx="16" cy="16" r="1.4" fill="#1b2230" />
    </svg>
  )
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [q, setQ] = useState("")
  const navigate = useNavigate()
  const nav = useNav()
  const { canAny } = useAuth()
  const [debounced, setDebounced] = useState("")
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(t) }, [q])
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => api.get<SearchHit[]>("/search", { q: debounced, limit: 20 }),
    enabled: open && debounced.trim().length >= 2,
  })
  const go = (to: string) => { setOpen(false); setQ(""); navigate(to) }
  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => { (acc[h.source_label] ??= []).push(h); return acc }, {})
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search everything" className="sm:max-w-2xl" shouldFilter={false}>
      <CommandInput value={q} onValueChange={setQ} placeholder="Search documents, requirements, answers, law text, tasks…" />
      <CommandList className="max-h-[60vh]">
        {debounced.trim().length < 2 ? (
          <CommandGroup heading="Go to">
            {nav.flatMap((g) => g.items).filter((i) => !i.perm || canAny(i.perm)).map((i) => (
              <CommandItem key={i.to} onSelect={() => go(i.to)}>{i.icon}{i.label}</CommandItem>
            ))}
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>{isFetching ? "Searching…" : "Nothing found."}</CommandEmpty>
            {canAny("ai.use") && (
              <CommandGroup heading="Ask the assistant">
                <CommandItem onSelect={() => go(`/assistant?q=${encodeURIComponent(q)}`)}><Bot /> Ask: “{q}”</CommandItem>
              </CommandGroup>
            )}
            {Object.entries(grouped).map(([label, items]) => (
              <CommandGroup key={label} heading={label}>
                {items.map((h) => (
                  <CommandItem key={`${h.source_type}-${h.source_id}`} onSelect={() => h.url && go(h.url)} className="items-start">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{h.title}</div>
                      <div className="line-clamp-1 text-[12px] text-ink-3">{h.snippet.replace(/[«»]/g, "")}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}

function Notifications() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unread: number; items: NotificationItem[] }>("/notifications"),
    refetchInterval: 60_000,
  })
  const read = useMutation({
    mutationFn: (ids?: number[]) => api.post("/notifications/read", ids ?? null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })
  const unread = data?.unread ?? 0
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
          <Bell />
          {unread > 0 && <span className="tabular absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-alarm px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          {unread > 0 && <button className="text-[12px] text-petrol hover:underline" onClick={() => read.mutate(undefined)}>Mark all as read</button>}
        </div>
        <ul className="max-h-96 overflow-auto scroll-thin">
          {(data?.items ?? []).length === 0 && <li className="p-4 text-[13px] text-ink-3">You're all caught up.</li>}
          {(data?.items ?? []).map((n) => (
            <li key={n.id}>
              <button className={cn("w-full border-b px-3 py-2 text-left last:border-0 hover:bg-muted", !n.is_read && "bg-petrol-50/60")}
                onClick={() => { if (!n.is_read) read.mutate([n.id]); if (n.link) navigate(n.link) }}>
                <div className="text-[13px] text-ink">{n.title}</div>
                {n.body && <div className="line-clamp-2 text-[12px] text-ink-3">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-ink-3">{fromNow(n.created_at)}</div>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function UserMenu() {
  const { me, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  if (!me) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" aria-label="Account menu">
          <UserAvatar name={me.display_name} className="size-7" />
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-[13px] font-medium text-ink">{me.display_name}</span>
            <span className="block text-[11px] text-ink-3">{me.roles.map((r) => r.name).filter((v, i, a) => a.indexOf(v) === i).join(", ") || "No role"}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-[13px] font-medium">{me.display_name}</div>
          <div className="text-[12px] text-ink-3">{me.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")}><KeyRound /> Profile & security</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />} Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => navigate("/help")}><BookOpen /> Help & scoring model</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("nis2-sidebar") === "1" } catch { return false }
  })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("nis2-sidebar", c ? "0" : "1") } catch { /* ignore */ } return !c })
  const fullBleed = /^\/(assessments\/\d+|assistant)/.test(location.pathname)
  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-3 border-b bg-background/90 px-5 backdrop-blur">
          <button onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-surface px-3 text-left text-[13px] text-ink-3 hover:border-input">
            <Search className="size-4" />
            <span className="flex-1 truncate">Search or ask…</span>
            <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px] text-ink-3">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {canAny("ai.use") && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/assistant")} className="text-ink-2"><Bot /> Assistant</Button>
            )}
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className={cn("min-w-0 flex-1", fullBleed ? "" : "mx-auto w-full max-w-[1480px] px-6 py-6")}>
          <PageErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </PageErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
    </div>
  )
}
