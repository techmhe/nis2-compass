import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, ChevronsDownUp, ExternalLink, Info, Plus, Scale, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, Empty, ErrorState, Loading, PageHeader, Pill } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { OptionSelect } from "@/components/common/fields"
import { Highlight } from "@/components/docs/shared"
import { AddRegulationDialog } from "@/components/regs/add-dialog"
import {
  ancestorsOf, buildTree, displayRootOf, isTitlesOnly, JURISDICTION_LABEL, KIND_LABEL, LANGUAGE_LABEL, lastDescendantPosition,
  type ProvisionTree, type RegulationDetail, tocRef,
} from "@/components/regs/model"
import { SectionReader } from "@/components/regs/reader"
import { Toc } from "@/components/regs/toc"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import type { Regulation, SearchHit } from "@/lib/types"
import { cn } from "@/lib/utils"

const PANE = "max-h-[45vh] overflow-y-auto scroll-thin lg:sticky lg:top-20 lg:max-h-[calc(100vh-104px)]"

export default function RegulationsPage() {
  const { id } = useParams()
  const regId = id ? Number(id) : null
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { canGlobal } = useAuth()
  const canManage = canGlobal("regulations.manage")
  const pParam = params.get("p")
  const selectedId = pParam ? Number(pParam) : null
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [scopeAll, setScopeAll] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t) }, [search])

  const list = useQuery({ queryKey: ["regulations"], queryFn: () => api.get<Regulation[]>("/regulations"), staleTime: 5 * 60_000 })
  const detail = useQuery({
    queryKey: ["regulations", regId],
    queryFn: () => api.get<RegulationDetail>(`/regulations/${regId}`),
    enabled: regId != null,
    staleTime: 10 * 60_000,
  })
  const tree = useMemo(() => (detail.data ? buildTree(detail.data.provisions) : null), [detail.data])
  const searchScope = regId != null && !scopeAll ? regId : null
  const hits = useQuery({
    queryKey: ["regulations", "search", debounced, searchScope],
    queryFn: () => api.get<SearchHit[]>("/regulations/search", { q: debounced, regulation_id: searchScope, limit: 50 }),
    enabled: debounced.length >= 2,
  })

  // ?k=<provision key> deep links (stable across re-imports) resolve to ?p=<id>
  const kParam = params.get("k")
  useEffect(() => {
    if (!kParam || !tree) return
    const node = [...tree.byId.values()].find((n) => n.key === kParam)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete("k")
      if (node) next.set("p", String(node.id))
      return next
    }, { replace: true })
  }, [kParam, tree, setParams])

  const select = useCallback((pid: number | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (pid == null) next.delete("p")
      else next.set("p", String(pid))
      return next
    })
  }, [setParams])

  const regulations = list.data ?? []
  const current = regulations.find((r) => r.id === regId) ?? detail.data?.regulation

  const searchBox = (
    <div className="relative w-[320px] max-w-full">
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search law text, e.g. Meldepflicht"
        className="pr-8 pl-8" aria-label="Search the regulations library" />
      {search && (
        <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setSearch("")} aria-label="Clear search">
          <X className="size-4" />
        </button>
      )}
    </div>
  )

  const searchPanel = debounced.length >= 2 && (
    <SearchResults embedded={regId != null} hits={hits.data} loading={hits.isFetching} error={hits.error} query={debounced}
      scopeLabel={regId != null ? (scopeAll ? "All regulations" : current?.short_title ?? "This regulation") : "All regulations"}
      onToggleScope={regId != null ? () => setScopeAll((v) => !v) : undefined}
      onPick={(h) => h.url && navigate(h.url)} activeId={selectedId} onClear={() => setSearch("")} />
  )

  return (
    <div>
      <PageHeader
        title="Regulations"
        description="The legal texts behind the requirement catalogue: NIS-2 and its implementing regulation, the German and Dutch transposition, and related standards."
        actions={
          <>
            {searchBox}
            {canManage && (
              <AddRegulationDialog onCreated={(r) => navigate(`/regulations/${r.id}`)}
                trigger={<Button variant="outline"><Plus /> Add custom regulation</Button>} />
            )}
          </>
        }
      />

      {list.error ? <ErrorState error={list.error} /> : (
        <div className={cn("grid items-start gap-4",
          regId != null ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[220px_290px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]")}>
          <aside data-tour="documents.regulations" className={cn(PANE, "rounded-md border bg-card", regId != null && "hidden xl:block")} aria-label="Regulations">
            <RegulationList regulations={regulations} loading={list.isLoading} activeId={regId} />
          </aside>

          {regId == null ? (
            <section className="min-w-0" aria-label="Library overview">
              {searchPanel || (list.isLoading ? <Loading /> : <Overview regulations={regulations} />)}
            </section>
          ) : (
            <RegulationView key={regId} regId={regId} regulations={regulations} current={current} detail={detail.data} tree={tree}
              loading={detail.isLoading} error={detail.error} selectedId={selectedId} onSelect={select} searchPanel={searchPanel || null}
              canManage={canManage} />
          )}
        </div>
      )}
    </div>
  )
}

function JurisdictionTag({ value }: { value: string }) {
  return <span className="inline-flex h-[18px] items-center rounded-[3px] border bg-surface px-1 font-mono text-[10.5px] text-ink-2" title={JURISDICTION_LABEL[value] ?? value}>{value}</span>
}

function RegulationList({ regulations, loading, activeId }: { regulations: Regulation[]; loading: boolean; activeId: number | null }) {
  if (loading) return <Loading />
  return (
    <nav className="p-1.5">
      <Link to="/regulations" className={cn("mb-1 flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px]", activeId == null ? "bg-petrol-50 text-petrol" : "text-ink-3 hover:bg-muted hover:text-ink")}>
        <Scale className="size-3.5" /> Library overview
      </Link>
      <ul className="space-y-0.5">
        {regulations.map((r) => (
          <li key={r.id}>
            <Link to={`/regulations/${r.id}`} aria-current={r.id === activeId ? "page" : undefined}
              title={r.status_note ?? undefined}
              className={cn("block rounded-[4px] px-2 py-1.5", r.id === activeId ? "bg-petrol-50" : "hover:bg-muted")}>
              <div className={cn("text-[13px] leading-snug font-medium", r.id === activeId ? "text-petrol" : "text-ink")}>{r.short_title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                <JurisdictionTag value={r.jurisdiction} />
                <span>{LANGUAGE_LABEL[r.language] ?? r.language}</span>
                {r.version_date && <span className="tabular">{fmtDate(r.version_date)}</span>}
                {r.linked_requirements > 0 && (
                  <span className="tabular ml-auto text-petrol" title={`${r.linked_requirements} requirements linked`}>{r.linked_requirements} req.</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Overview({ regulations }: { regulations: Regulation[] }) {
  if (!regulations.length) return <Empty title="The library is empty">An administrator can add regulations with “Add custom regulation”.</Empty>
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {regulations.map((r) => (
        <article key={r.id} className="rounded-md border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/regulations/${r.id}`} className="text-[15px] font-semibold text-ink hover:text-petrol">{r.short_title}</Link>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3" title={r.title}>{r.title}</p>
            </div>
            <Button size="sm" variant="outline" asChild><Link to={`/regulations/${r.id}`}>Open</Link></Button>
          </div>
          <RegulationFacts r={r} className="mt-2" />
          <RegulationNotes r={r} className="mt-3" clamp />
        </article>
      ))}
    </div>
  )
}

function RegulationFacts({ r, className }: { r: Regulation; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2", className)}>
      <span className="inline-flex items-center gap-1.5"><JurisdictionTag value={r.jurisdiction} />{JURISDICTION_LABEL[r.jurisdiction] ?? r.jurisdiction}</span>
      <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
      <span>{LANGUAGE_LABEL[r.language] ?? r.language}</span>
      {r.version_date && <span>Version of {fmtDate(r.version_date)}</span>}
      {r.provision_count > 0 && <span className="tabular">{r.provision_count} provisions</span>}
      <span className={cn("tabular", r.linked_requirements ? "text-petrol" : "text-ink-3")}>{r.linked_requirements} linked requirements</span>
      {!r.is_builtin && <Pill tone="brass">Custom</Pill>}
    </div>
  )
}

function RegulationNotes({ r, className, clamp, titlesOnly }: { r: Regulation; className?: string; clamp?: boolean; titlesOnly?: boolean }) {
  const [open, setOpen] = useState(!clamp)
  const showTitlesNote = titlesOnly ?? r.kind === "standard"
  return (
    <div className={cn("space-y-2 text-[12.5px]", className)}>
      {r.status_note && (
        <div>
          <div className="font-medium text-ink-2">Status</div>
          <p className={cn("text-ink-2", !open && "line-clamp-3")}>{r.status_note}</p>
        </div>
      )}
      {open && r.license_note && (
        <div>
          <div className="font-medium text-ink-2">Source and licence</div>
          <p className="text-ink-3">{r.license_note}</p>
        </div>
      )}
      {showTitlesNote && (
        <p className="flex gap-1.5 rounded-md bg-muted px-2.5 py-2 text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
          <span>
            This standard is protected by copyright, so the library contains clause and control titles only. They are enough to map
            requirements and navigate; read the full wording in your licensed copy.
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {clamp && (r.status_note || r.license_note) && (
          <button type="button" className="text-petrol hover:underline" onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Show status and licence"}</button>
        )}
        {r.source_url && (
          <a href={r.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-petrol hover:underline">
            Official source <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function SearchResults({ hits, loading, error, query, scopeLabel, onToggleScope, onPick, activeId, onClear, embedded }: {
  embedded?: boolean
  hits: SearchHit[] | undefined
  loading: boolean
  error: unknown
  query: string
  scopeLabel: string
  onToggleScope?: () => void
  onPick: (h: SearchHit) => void
  activeId: number | null
  onClear: () => void
}) {
  return (
    <div className={embedded ? "" : "rounded-md border bg-card"}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[12.5px]">
        <span className="text-ink-3">{loading ? "Searching…" : `${hits?.length ?? 0} results for “${query}”`}</span>
        <span className="ml-auto text-ink-3">in</span>
        {onToggleScope ? (
          <button type="button" onClick={onToggleScope} className="rounded-[4px] border px-1.5 py-0.5 text-ink-2 hover:border-petrol hover:text-petrol"
            title="Switch between this regulation and the whole library">{scopeLabel}</button>
        ) : <span className="text-ink-2">{scopeLabel}</span>}
        <Button size="icon-xs" variant="ghost" aria-label="Close search results" onClick={onClear}><X /></Button>
      </div>
      {error ? <ErrorState error={error} className="m-3" /> : (hits?.length ?? 0) === 0 && !loading ? (
        <p className="p-4 text-[13px] text-ink-3">Nothing found. Search works on words in the original language of each text, for example “Meldepflicht” (BSIG) or “meldplicht” (Cbw).</p>
      ) : (
        <ul className="divide-y">
          {(hits ?? []).map((h) => (
            <li key={h.source_id}>
              <button type="button" onClick={() => onPick(h)}
                className={cn("block w-full px-3 py-2 text-left hover:bg-muted/60", h.source_id === activeId && "bg-petrol-50/60")}>
                <div className="text-[13px] font-medium text-ink">{h.title}</div>
                <div className="mt-0.5 line-clamp-3 text-[12.5px] whitespace-pre-line text-ink-2"><Highlight text={h.snippet} /></div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RegulationView({ regId, regulations, current, detail, tree, loading, error, selectedId, onSelect, searchPanel, canManage }: {
  regId: number
  regulations: Regulation[]
  current: Regulation | undefined
  detail: RegulationDetail | undefined
  tree: ProvisionTree | null
  loading: boolean
  error: unknown
  selectedId: number | null
  onSelect: (id: number | null) => void
  searchPanel: ReactNode
  canManage: boolean
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [tocFilter, setTocFilter] = useState("")
  const [closedFor, setClosedFor] = useState<number | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  const root = tree && selectedId != null ? displayRootOf(tree, selectedId) : null
  const titlesOnly = detail ? isTitlesOnly(detail.regulation, detail.provisions) : false

  // expand the table of contents down to the displayed section, then bring both into view
  useEffect(() => {
    if (!tree || selectedId == null) return
    const anc = ancestorsOf(tree, selectedId)
    if (root && tree.tocChildren.has(root.id)) anc.push(root)
    setExpanded((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const a of anc) if (!next.has(a.id)) { next.add(a.id); changed = true }
      return changed ? next : prev
    })
    const t = window.setTimeout(() => {
      const el = document.getElementById(`prov-${selectedId}`)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.top < 72 || r.top > window.innerHeight - 140) el.scrollIntoView({ block: "start", behavior: "smooth" })
      }
      if (root) document.getElementById(`toc-${root.id}`)?.scrollIntoView({ block: "nearest" })
    }, 60)
    return () => window.clearTimeout(t)
  }, [tree, selectedId, root])

  // first visit: open the top level of the contents
  useEffect(() => {
    if (tree && expanded.size === 0 && selectedId == null) {
      const tops = tree.tocChildren.get(null) ?? []
      if (tops.length <= 3) setExpanded(new Set(tops.map((t) => t.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  const toggle = useCallback((id: number) => setExpanded((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }), [])
  const pick = useCallback((id: number) => { setClosedFor(null); onSelect(id) }, [onSelect])

  const del = useMutation({
    mutationFn: () => api.del(`/regulations/${regId}`),
    onSuccess: () => {
      toast.success("Regulation deleted")
      qc.invalidateQueries({ queryKey: ["regulations"] })
      navigate("/regulations")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const nav = useMemo(() => {
    if (!tree || !root) return { prev: null, next: null }
    const pos = tree.position.get(root.id)!
    const end = lastDescendantPosition(tree, root.id)
    const prev = [...tree.leaves].reverse().find((l) => tree.position.get(l.id)! < pos) ?? null
    const next = tree.leaves.find((l) => tree.position.get(l.id)! > end) ?? null
    return { prev, next }
  }, [tree, root])

  return (
    <>
      <aside className={cn(PANE, "rounded-md border bg-card")} aria-label="Contents">
        <div className="sticky top-0 z-10 space-y-2 border-b bg-card p-2">
          <div className="xl:hidden">
            <OptionSelect size="sm" value={String(regId)} onChange={(v) => v && navigate(`/regulations/${v}`)}
              options={regulations.map((r) => ({ value: String(r.id), label: r.short_title }))} />
          </div>
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-ink-3" />
              <Input value={tocFilter} onChange={(e) => setTocFilter(e.target.value)} placeholder="Filter headings"
                className="h-8 pl-7 text-[12.5px]" aria-label="Filter the table of contents" />
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Collapse all" title="Collapse all" onClick={() => setExpanded(new Set())}><ChevronsDownUp /></Button>
          </div>
        </div>
        <div className="p-1.5">
          {searchPanel ? <div className="-m-1.5">{searchPanel}</div> : loading ? <Loading /> : tree && (
            <Toc tree={tree} expanded={expanded} onToggle={toggle} activeId={root?.id ?? null} onSelect={pick} filter={tocFilter} />
          )}
        </div>
      </aside>

      <section className="min-w-0" aria-label="Text">
        {error ? <ErrorState error={error} /> : loading || !detail || !tree ? <Loading /> : (
          <div className="rounded-md border bg-card">
            <header className="border-b px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold text-ink">{detail.regulation.short_title}</h2>
                  {(root == null || aboutOpen) && <p className="mt-0.5 text-[12.5px] text-ink-3">{detail.regulation.title}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {root != null && (
                    <Button size="xs" variant="ghost" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen}>
                      <Info /> {aboutOpen ? "Hide details" : "About this text"}
                    </Button>
                  )}
                  {canManage && !detail.regulation.is_builtin && (
                    <Confirm title={`Delete “${detail.regulation.short_title}”?`}
                      description="The regulation, all its provisions and their requirement links are removed. Built-in regulations cannot be deleted."
                      confirmLabel="Delete regulation" onConfirm={() => del.mutate()}
                      trigger={<Button size="xs" variant="ghost" className="text-alarm"><Trash2 /> Delete</Button>} />
                  )}
                </div>
              </div>
              {(root == null || aboutOpen) && (
                <>
                  <RegulationFacts r={{ ...detail.regulation, provision_count: detail.provisions.length, linked_requirements: current?.linked_requirements ?? detail.regulation.linked_requirements }} className="mt-2" />
                  <RegulationNotes r={detail.regulation} titlesOnly={titlesOnly} className="mt-3 max-w-[90ch]" />
                </>
              )}
            </header>

            {root ? (
              <div className="px-5 py-4">
                <Breadcrumb tree={tree} rootId={root.id} onSelect={pick} />
                <SectionReader tree={tree} root={root} selectedId={selectedId === closedFor ? null : selectedId}
                  onSelect={pick} onClose={() => setClosedFor(selectedId)} lang={detail.regulation.language} />
                <div className="mt-8 flex items-center justify-between gap-3 border-t pt-3">
                  {nav.prev ? (
                    <Button variant="ghost" size="sm" onClick={() => pick(nav.prev!.id)} className="max-w-[48%]">
                      <ChevronLeft /> <span className="truncate"><Code className="mr-1">{tocRef(tree, nav.prev.ref)}</Code>{nav.prev.heading}</span>
                    </Button>
                  ) : <span />}
                  {nav.next && (
                    <Button variant="ghost" size="sm" onClick={() => pick(nav.next!.id)} className="max-w-[48%]">
                      <span className="truncate"><Code className="mr-1">{tocRef(tree, nav.next.ref)}</Code>{nav.next.heading}</span> <ChevronRight />
                    </Button>
                  )}
                </div>
              </div>
            ) : selectedId != null ? (
              <Empty title="Provision not found" className="py-8">It may have been removed. Choose an entry from the contents.</Empty>
            ) : (
              <ContentsOverview tree={tree} onSelect={pick} />
            )}
          </div>
        )}
      </section>
    </>
  )
}

function Breadcrumb({ tree, rootId, onSelect }: { tree: ProvisionTree; rootId: number; onSelect: (id: number) => void }) {
  const anc = ancestorsOf(tree, rootId)
  if (!anc.length) return null
  return (
    <nav aria-label="Position in the regulation" className="mb-3 flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
      {anc.map((a, i) => (
        <span key={a.id} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" />}
          <button type="button" onClick={() => onSelect(a.id)} className="hover:text-petrol">
            <span className="font-mono">{tocRef(tree, a.ref)}</span>{a.heading ? ` ${a.heading}` : ""}
          </button>
        </span>
      ))}
    </nav>
  )
}

function ContentsOverview({ tree, onSelect }: { tree: ProvisionTree; onSelect: (id: number) => void }) {
  const tops = tree.tocChildren.get(null) ?? []
  if (!tops.length) return <Empty title="No provisions">This regulation has no provisions yet.</Empty>
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-[13px] font-semibold text-ink">Contents</h3>
      <ul className="divide-y rounded-md border">
        {tops.map((t) => {
          const kids = tree.tocChildren.get(t.id) ?? []
          const links = tree.subtreeLinks.get(t.id) ?? 0
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onSelect(t.id)} className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-muted/60">
                <Code className="w-28 shrink-0 truncate">{tocRef(tree, t.ref)}</Code>
                <span className="min-w-0 flex-1 text-[13px] text-ink">{t.heading ?? t.text?.slice(0, 120)}</span>
                {kids.length > 0 && <span className="tabular shrink-0 text-[12px] text-ink-3">{kids.length} parts</span>}
                {links > 0 && <span className="tabular shrink-0 text-[12px] text-petrol">{links} links</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[12.5px] text-ink-3">Choose a part to read its full text. Provisions marked with a requirement count are referenced by the catalogue; select them to see how each entity is doing.</p>
    </div>
  )
}
