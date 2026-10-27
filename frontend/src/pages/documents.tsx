import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, ChevronDown, Download, FileText, Globe, Link2, Search, Tag, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { EntityTag, Empty, ErrorState, Loading, PageHeader, StatusPill } from "@/components/common/basics"
import { Confirm, UploadDialog } from "@/components/common/collab"
import { OptionSelect } from "@/components/common/fields"
import { Classification, DOC_STATUSES, Highlight, metaOf, ReviewDate, type DocumentsMeta } from "@/components/docs/shared"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import type { DocumentItem } from "@/lib/types"
import { cn } from "@/lib/utils"

type SortKey = "title" | "doc_type" | "status" | "classification" | "entity" | "owner" | "version" | "review" | "links" | "updated"

const SORTERS: Record<SortKey, (d: DocumentItem) => string | number> = {
  title: (d) => d.title.toLowerCase(),
  doc_type: (d) => d.doc_type,
  status: (d) => DOC_STATUSES.indexOf(d.status as (typeof DOC_STATUSES)[number]),
  classification: (d) => ["Public", "Internal", "Confidential", "Restricted"].indexOf(d.classification),
  entity: (d) => d.entity?.code ?? "",
  owner: (d) => d.owner?.display_name ?? "",
  version: (d) => d.current_version?.version_no ?? 0,
  review: (d) => d.next_review_date ?? "9999",
  links: (d) => d.link_count,
  updated: (d) => d.updated_at,
}

export default function DocumentsPage() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const q = params.get("q") ?? ""
  const docType = params.get("type")
  const status = params.get("status")
  const entityId = params.get("entity")
  const tag = params.get("tag")
  const overdueOnly = params.get("overdue") === "1"
  const [qInput, setQInput] = useState(q)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const setParam = (patch: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    }, { replace: true })
  }

  // debounce the full-text search box into the URL; take over URL changes made elsewhere (back button, links)
  const pushedQ = useRef(q)
  useEffect(() => {
    const t = setTimeout(() => {
      const v = qInput.trim()
      if (v !== pushedQ.current) {
        pushedQ.current = v
        setParam({ q: v || null })
      }
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])
  useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q
      setQInput(q)
    }
  }, [q])

  const entities = useEntities()
  const meta = useQuery({ queryKey: ["doc-meta"], queryFn: () => api.get<DocumentsMeta>("/documents/meta"), staleTime: 10 * 60_000 })
  const tags = useQuery({ queryKey: ["documents", "tags"], queryFn: () => api.get<{ tag: string; count: number }[]>("/documents/tags") })
  const list = useQuery({
    queryKey: ["documents", "list", { q, docType, status, entityId, tag }],
    queryFn: () => api.get<DocumentItem[]>("/documents", { q, doc_type: docType, status, entity_id: entityId, tag }),
    placeholderData: keepPreviousData,
  })

  const rows = useMemo(() => {
    let out = list.data ?? []
    if (overdueOnly) out = out.filter((d) => d.review_overdue)
    if (sort) {
      const f = SORTERS[sort.key]
      out = [...out].sort((a, b) => {
        const x = f(a), y = f(b)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      })
    }
    return out
  }, [list.data, overdueOnly, sort])

  // drop selections that are no longer visible
  useEffect(() => {
    setSelected((s) => {
      const visible = new Set(rows.map((r) => r.id))
      const next = new Set([...s].filter((id) => visible.has(id)))
      return next.size === s.size ? s : next
    })
  }, [rows])

  const filtersActive = !!(q || docType || status || entityId || tag || overdueOnly)
  const overdueCount = (list.data ?? []).filter((d) => d.review_overdue).length
  const selectedDocs = rows.filter((r) => selected.has(r.id))
  const allSelected = rows.length > 0 && selected.size === rows.length

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))

  async function bulk(label: string, fn: (d: DocumentItem) => Promise<unknown>) {
    setBusy(true)
    const errors: string[] = []
    let ok = 0
    for (const d of selectedDocs) {
      try {
        await fn(d)
        ok += 1
      } catch (e) {
        errors.push(`${d.title}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    qc.invalidateQueries({ queryKey: ["documents"] })
    if (ok) toast.success(`${label}: ${ok} document${ok === 1 ? "" : "s"}`)
    if (errors.length) toast.error(`${errors.length} could not be changed`, { description: errors.slice(0, 4).join("\n") })
    if (!errors.length) setSelected(new Set())
  }

  const canUpload = canAny("documents.upload")
  const canManageAny = canAny("documents.manage")

  const header = (key: SortKey, label: string, className?: string) => {
    const active = sort?.key === key
    return (
      <th className={cn("px-2 py-2 font-medium", className)} aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}>
        <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-ink">
          {label}
          {active && (sort!.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </th>
    )
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Policies, procedures and evidence for the NIS-2 programme. Content is full-text searchable and can be linked to requirements, answers and tasks."
        actions={canUpload && (
          <UploadDialog defaultType="Policy" onDone={(doc) => navigate(`/documents/${doc.id}`)}
            trigger={<Button><Upload /> Upload document</Button>} />
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[360px] min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search titles and document text"
            className="pr-8 pl-8" aria-label="Search documents" />
          {qInput && (
            <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setQInput("")} aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
        <OptionSelect className="w-40" value={docType} onChange={(v) => setParam({ type: v })} allowNone noneLabel="All types"
          placeholder="All types" options={meta.data?.types ?? []} />
        <OptionSelect className="w-36" value={status} onChange={(v) => setParam({ status: v })} allowNone noneLabel="All statuses"
          placeholder="All statuses" options={DOC_STATUSES} />
        <OptionSelect className="w-44" value={entityId} onChange={(v) => setParam({ entity: v })} allowNone noneLabel="All entities"
          placeholder="All entities"
          options={(entities.data ?? []).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
        <OptionSelect className="w-40" value={tag} onChange={(v) => setParam({ tag: v })} allowNone noneLabel="All tags" placeholder="All tags"
          options={(tags.data ?? []).map((t) => ({ value: t.tag, label: <span>{t.tag} <span className="tabular text-ink-3">{t.count}</span></span> }))} />
        <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
          <Switch id="overdue-only" checked={overdueOnly} onCheckedChange={(v) => setParam({ overdue: v ? "1" : null })} />
          <Label htmlFor="overdue-only" className="text-[13px] font-normal text-ink-2">Review overdue{overdueCount ? <span className="tabular ml-1 text-alarm">{overdueCount}</span> : null}</Label>
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setQInput(""); setParams(new URLSearchParams(), { replace: true }) }}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      <div className="rounded-md border bg-card">
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[12.5px] text-ink-3">
          {selected.size > 0 ? (
            <>
              <span className="font-medium text-ink">{selected.size} selected</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={busy}>Set status <ChevronDown /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-[12px] text-ink-3">Change status of {selected.size} documents</DropdownMenuLabel>
                  {DOC_STATUSES.map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => bulk(`Status set to ${s}`, (d) => api.put(`/documents/${d.id}`, { ...metaOf(d), status: s }))}>
                      <StatusPill value={s} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <BulkTag disabled={busy} onApply={(t) => bulk(`Tag "${t}" added`, (d) => api.put(`/documents/${d.id}`, { ...metaOf(d), tags: [...new Set([...d.tags, t])] }))} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => bulk("Downloaded", (d) => d.current_version
                ? download(`/documents/${d.id}/versions/${d.current_version.id}/download`, d.current_version.filename)
                : Promise.reject(new Error("no file (external link)")))}>
                <Download /> Download files
              </Button>
              {canManageAny && (
                <Confirm title={`Delete ${selected.size} documents?`} description="All versions and links are removed permanently. This cannot be undone."
                  confirmLabel="Delete documents" onConfirm={() => bulk("Deleted", (d) => api.del(`/documents/${d.id}`))}
                  trigger={<Button size="sm" variant="outline" disabled={busy} className="text-alarm"><Trash2 /> Delete</Button>} />
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </>
          ) : (
            <span className="tabular">
              {list.isFetching && !list.isLoading ? "Updating…" : `${rows.length} document${rows.length === 1 ? "" : "s"}`}
              {q && rows.length > 0 && <> matching “{q}”, best matches first</>}
            </span>
          )}
        </div>

        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : rows.length === 0 ? (
          filtersActive ? (
            <Empty title="No documents match" action={<Button variant="outline" size="sm" onClick={() => { setQInput(""); setParams(new URLSearchParams(), { replace: true }) }}>Clear filters</Button>}>
              Try other search words or remove a filter. Search looks at titles, tags and the extracted text of every file.
            </Empty>
          ) : (
            <Empty title="No documents yet" icon={<FileText className="size-6" />}
              action={canUpload && <UploadDialog defaultType="Policy" onDone={(doc) => navigate(`/documents/${doc.id}`)} trigger={<Button size="sm"><Upload /> Upload document</Button>} />}>
              Upload policies, procedures and evidence. They can then be linked to requirements and assessment answers.
            </Empty>
          )
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="w-9 py-2 pr-1 pl-3">
                    <Checkbox aria-label="Select all documents" checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                      onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </th>
                  {header("title", "Title", "min-w-[260px]")}
                  {header("doc_type", "Type")}
                  {header("status", "Status")}
                  {header("classification", "Classification", "hidden xl:table-cell")}
                  {header("entity", "Entity")}
                  {header("owner", "Owner", "hidden lg:table-cell")}
                  {header("version", "Version")}
                  {header("review", "Next review")}
                  {header("links", "Links", "text-right")}
                  {header("updated", "Updated", "hidden xl:table-cell pr-3")}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className={cn("group border-b align-top last:border-0 hover:bg-muted/50", selected.has(d.id) && "bg-petrol-50/50")}>
                    <td className="py-2 pr-1 pl-3">
                      <Checkbox aria-label={`Select ${d.title}`} checked={selected.has(d.id)}
                        onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(d.id); else n.delete(d.id); return n })} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        {d.external_url && !d.current_version ? <Globe className="size-3.5 shrink-0 text-ink-3" aria-label="External link" /> : null}
                        <Link to={`/documents/${d.id}`} className="font-medium text-ink hover:text-petrol">{d.title}</Link>
                      </div>
                      {d.snippet ? (
                        <div className="mt-0.5 line-clamp-2 max-w-[70ch] text-[12px] whitespace-pre-line text-ink-3"><Highlight text={d.snippet} /></div>
                      ) : d.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.tags.slice(0, 4).map((t) => (
                            <button key={t} type="button" onClick={() => setParam({ tag: t })}
                              className="rounded-[4px] bg-muted px-1.5 text-[11.5px] leading-5 text-ink-2 hover:bg-accent">{t}</button>
                          ))}
                          {d.tags.length > 4 && <span className="text-[11.5px] text-ink-3">+{d.tags.length - 4}</span>}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-ink-2">{d.doc_type}</td>
                    <td className="px-2 py-2"><StatusPill value={d.status} /></td>
                    <td className="hidden px-2 py-2 xl:table-cell"><Classification value={d.classification} /></td>
                    <td className="px-2 py-2">{d.entity ? <EntityTag code={d.entity.code} name={d.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}</td>
                    <td className="hidden px-2 py-2 text-ink-2 lg:table-cell">{d.owner?.display_name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="tabular px-2 py-2 text-ink-2">
                      {d.version_label ?? (d.current_version ? `v${d.current_version.version_no}` : "–")}
                    </td>
                    <td className="px-2 py-2"><ReviewDate date={d.next_review_date} overdue={d.review_overdue} /></td>
                    <td className="tabular px-2 py-2 text-right text-ink-2">
                      {d.link_count ? <span className="inline-flex items-center gap-1"><Link2 className="size-3 text-ink-3" />{d.link_count}</span> : <span className="text-ink-3">–</span>}
                    </td>
                    <td className="tabular hidden px-2 py-2 pr-3 text-[12.5px] whitespace-nowrap text-ink-3 xl:table-cell">{fmtDate(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function BulkTag({ onApply, disabled }: { onApply: (tag: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const apply = () => {
    const t = value.trim()
    if (!t) return
    onApply(t)
    setValue("")
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}><Tag /> Add tag</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); apply() }}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. backup" aria-label="Tag" />
          <Button type="submit" size="sm" disabled={!value.trim()}>Add</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
