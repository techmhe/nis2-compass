import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookCheck, Check, ChevronLeft, Download, ExternalLink, Eye, Link2, MoreHorizontal, Sparkles, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { EntityTag, ErrorState, KV, Loading, PageHeader, Pill, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Markdown, UserAvatar } from "@/components/common/collab"
import { Combo, EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { ExtractedText, FilePreview, previewKind } from "@/components/docs/preview"
import { Classification, DOC_STATUSES, LINK_TYPE_LABEL, metaOf, parseTags, ReviewDate, type DocumentMetaIn, type DocumentsMeta } from "@/components/docs/shared"
import { NewVersionDialog } from "@/components/docs/version-dialog"
import { ApprovalPanel } from "@/components/approvals/approval-panel"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError, download } from "@/lib/api"
import { bytes, fmtDate, fmtDateTime, fromNow, isoDate } from "@/lib/format"
import type { DocumentItem, DocVersion, Requirement } from "@/lib/types"
import { cn } from "@/lib/utils"

interface DocLinkRow { id: number; target_type: string; target_id: number | null; label: string; url: string | null; note: string | null }
interface DocDetail {
  document: DocumentItem
  versions: DocVersion[]
  links: DocLinkRow[]
  acknowledgements: { user: string; user_id: number; version_id: number | null; acknowledged_at: string }[]
  acknowledged_by_me: boolean
  can_edit: boolean
}
interface AiSummary { summary?: string; key_obligations?: string[]; nis2_topics?: string[]; suggested_tags?: string[] }

export default function DocumentPage() {
  const { id } = useParams()
  const docId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can, canAny, me } = useAuth()
  const key = ["documents", "detail", docId]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DocDetail>(`/documents/${docId}`), enabled: Number.isFinite(docId) })
  const meta = useQuery({ queryKey: ["doc-meta"], queryFn: () => api.get<DocumentsMeta>("/documents/meta"), staleTime: 10 * 60_000 })
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)
  const [tab, setTab] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ["documents"] })

  const ack = useMutation({
    mutationFn: () => api.post(`/documents/${docId}/acknowledge`),
    onSuccess: () => { toast.success("Marked as read"); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/documents/${docId}`),
    onSuccess: () => { toast.success("Document deleted"); qc.removeQueries({ queryKey: key }); refresh(); navigate("/documents") },
    onError: (e: Error) => toast.error(e.message),
  })
  const ai = useMutation({
    mutationFn: () => api.post<AiSummary>(`/ai/assist/document/${docId}/summary`),
    onMutate: () => { setSummaryError(null) },
    onSuccess: (r) => setSummary(r),
    onError: (e: Error) => {
      setSummary(null)
      setSummaryError(e instanceof ApiError && e.status === 503
        ? "The AI assistant is not configured. An administrator can connect a model under Administration, AI assistant."
        : e.message)
    },
  })

  if (q.isLoading) return <Loading />
  if (q.error) {
    return (
      <div>
        <BackLink />
        <ErrorState error={(q.error as ApiError).status === 404 ? "This document does not exist or you have no access to it." : q.error} />
      </div>
    )
  }
  if (!q.data) return null
  const { document: doc, versions, links, acknowledgements, acknowledged_by_me, can_edit } = q.data
  const current = doc.current_version
  const previewVersion = versions.find((v) => v.id === previewVersionId) ?? current ?? null
  const hasPreview = !!previewKind(previewVersion)
  const activeTab = tab ?? (hasPreview ? "preview" : "text")
  const entityId = doc.entity?.id ?? null
  const canUploadVersion = can_edit || can("documents.upload", entityId)
  const canDelete = can("documents.manage", entityId) || (can_edit && doc.status === "Draft")
  const canComment = entityId == null ? canAny("documents.upload") : can("documents.upload", entityId)

  const downloadVersion = (v: DocVersion) =>
    download(`/documents/${doc.id}/versions/${v.id}/download`, v.filename).catch((e: Error) => toast.error(`Download failed: ${e.message}`))

  return (
    <div>
      <BackLink />
      <PageHeader
        title={doc.title}
        actions={
          <>
            {current && <Button variant="outline" onClick={() => downloadVersion(current)}><Download /> Download</Button>}
            {doc.external_url && (
              <Button variant="outline" asChild><a href={doc.external_url} target="_blank" rel="noreferrer noopener"><ExternalLink /> Open link</a></Button>
            )}
            {canUploadVersion && (
              <NewVersionDialog doc={doc} maxMb={meta.data?.max_upload_mb} trigger={<Button variant="outline"><Upload /> Upload new version</Button>} />
            )}
            {acknowledged_by_me ? (
              <Button variant="outline" disabled className="text-petrol disabled:opacity-100"><Check /> You have read this version</Button>
            ) : (
              <Button onClick={() => ack.mutate()} disabled={ack.isPending}><BookCheck /> I have read this</Button>
            )}
            {canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-alarm focus:text-alarm" onSelect={() => setConfirmDelete(true)}><Trash2 /> Delete document</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
          <StatusPill value={doc.status} />
          <span className="text-ink-2">{doc.doc_type}</span>
          <Classification value={doc.classification} />
          {doc.entity ? <EntityTag code={doc.entity.code} name={doc.entity.name} /> : <span>Group-wide</span>}
          {(doc.version_label || current) && <span>Version <span className="tabular text-ink-2">{doc.version_label ?? `v${current?.version_no}`}</span></span>}
          {doc.review_overdue && <Pill tone="alarm">Review overdue since {fmtDate(doc.next_review_date)}</Pill>}
        </div>
      </PageHeader>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{doc.title}”?</AlertDialogTitle>
            <AlertDialogDescription>All {versions.length} version{versions.length === 1 ? "" : "s"}, {links.length} link{links.length === 1 ? "" : "s"} and comments are removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-alarm hover:bg-alarm/90" onClick={() => del.mutate()}>Delete document</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {doc.description && <p className="max-w-[80ch] text-[13.5px] text-ink-2">{doc.description}</p>}

          {previewVersion ? (
            <Section bodyClassName="p-4 pt-3">
              <Tabs value={activeTab} onValueChange={setTab}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="preview" disabled={!hasPreview}>Preview</TabsTrigger>
                    <TabsTrigger value="text">Text</TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
                    <span className="max-w-[320px] truncate" title={previewVersion.filename}>{previewVersion.filename}</span>
                    <span className="tabular">v{previewVersion.version_no}</span>
                    {previewVersion.id !== current?.id && (
                      <Button size="xs" variant="outline" onClick={() => setPreviewVersionId(null)}>Show current version</Button>
                    )}
                  </div>
                </div>
                <TabsContent value="preview" className="mt-2">
                  {hasPreview && activeTab === "preview" && <FilePreview docId={doc.id} version={previewVersion} title={doc.title} />}
                </TabsContent>
                <TabsContent value="text" className="mt-2">
                  <ExtractedText docId={doc.id} version={previewVersion} />
                </TabsContent>
              </Tabs>
            </Section>
          ) : (
            <Section title="Content">
              <p className="text-[13px] text-ink-3">
                {doc.external_url
                  ? <>This document is kept outside the system: <a className="text-petrol underline underline-offset-2" href={doc.external_url} target="_blank" rel="noreferrer noopener">{doc.external_url}</a>. Upload a file to make its text searchable here.</>
                  : "No file has been uploaded yet."}
              </p>
            </Section>
          )}

          {canAny("ai.use") && (
            <AiSummarySection summary={summary} error={summaryError} pending={ai.isPending} hasText={!!current}
              onRun={() => ai.mutate()} onClear={() => { setSummary(null); setSummaryError(null) }}
              canEdit={can_edit} doc={doc} />
          )}

          <Section title="Version history" bodyClassName="p-0">
            {versions.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">No versions yet.{canUploadVersion ? " Upload a file to start the history." : ""}</p>
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-2 py-2 font-medium">File</th>
                      <th className="px-2 py-2 font-medium">Change note</th>
                      <th className="px-2 py-2 font-medium">Uploaded</th>
                      <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id} className={cn("border-b align-top last:border-0", v.id === previewVersion?.id && "bg-muted/50")}>
                        <td className="tabular px-4 py-2 whitespace-nowrap">
                          v{v.version_no}
                          {v.id === current?.id && <Pill tone="petrol" className="ml-2">Current</Pill>}
                        </td>
                        <td className="px-2 py-2">
                          <div className="max-w-[280px] truncate text-ink" title={v.filename}>{v.filename}</div>
                          <div className="text-[12px] text-ink-3">
                            {bytes(v.size)}{v.page_count ? `, ${v.page_count} pages` : ""}
                            {v.extraction_status !== "ok" && <span className="text-amber">, no text extracted</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-ink-2">{v.change_note ?? <span className="text-ink-3">–</span>}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-ink-2">
                          <div>{v.uploaded_by?.display_name ?? "Unknown"}</div>
                          <div className="text-[12px] text-ink-3" title={fmtDateTime(v.uploaded_at)}>{fmtDate(v.uploaded_at)}</div>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <Button size="icon-sm" variant="ghost" aria-label={`View version ${v.version_no}`} title="View"
                            onClick={() => { setPreviewVersionId(v.id); window.scrollTo({ top: 0, behavior: "smooth" }) }}><Eye /></Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Download version ${v.version_no}`} title="Download"
                            onClick={() => downloadVersion(v)}><Download /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <LinkedObjects docId={doc.id} links={links} canEdit={can_edit} onChange={() => qc.invalidateQueries({ queryKey: key })} />

          <Section title="Comments">
            <CommentsPanel targetType="document" targetId={doc.id} canComment={canComment} />
          </Section>
        </div>

        <div className="space-y-5">
          <ApprovalPanel targetType="document" targetId={doc.id} entityId={entityId} onChanged={refresh} />
          <DetailsForm key={doc.updated_at} doc={doc} canEdit={can_edit} canApprove={can("documents.manage", entityId)} meta={meta.data} />
          <Acknowledgements acks={acknowledgements} versions={versions} current={current} meName={me?.display_name} />
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/documents" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol">
      <ChevronLeft className="size-3.5" /> Documents
    </Link>
  )
}

function DetailsForm({ doc, canEdit, canApprove, meta }: { doc: DocumentItem; canEdit: boolean; canApprove: boolean; meta?: DocumentsMeta }) {
  const qc = useQueryClient()
  const initial = metaOf(doc)
  const [form, setForm] = useState<DocumentMetaIn>(initial)
  const [tagText, setTagText] = useState(doc.tags.join(", "))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof DocumentMetaIn>(k: K, v: DocumentMetaIn[K]) => setForm((f) => ({ ...f, [k]: v }))
  const payload: DocumentMetaIn = { ...form, tags: parseTags(tagText) }
  const dirty = JSON.stringify(payload) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: () => api.put<DocumentItem>(`/documents/${doc.id}`, {
      ...payload,
      description: payload.description?.trim() || null,
      version_label: payload.version_label?.trim() || null,
      approved_by: payload.approved_by?.trim() || null,
      external_url: payload.external_url?.trim() || null,
    }),
    onMutate: () => setError(null),
    onSuccess: () => { toast.success("Document details saved"); qc.invalidateQueries({ queryKey: ["documents"] }) },
    onError: (e: Error) => setError(e.message),
  })

  if (!canEdit) {
    return (
      <Section title="Details">
        <KV label="Type">{doc.doc_type}</KV>
        <KV label="Status"><StatusPill value={doc.status} /></KV>
        <KV label="Classification"><Classification value={doc.classification} /></KV>
        <KV label="Entity">{doc.entity ? `${doc.entity.code} ${doc.entity.name}` : "Group-wide"}</KV>
        <KV label="Owner">{doc.owner?.display_name}</KV>
        <KV label="Version label">{doc.version_label}</KV>
        <KV label="Approved">{doc.approved_at ? `${fmtDate(doc.approved_at)}${doc.approved_by ? ` by ${doc.approved_by}` : ""}` : null}</KV>
        <KV label="Next review"><ReviewDate date={doc.next_review_date} overdue={doc.review_overdue} /></KV>
        <KV label="Tags">{doc.tags.length ? <div className="flex flex-wrap gap-1">{doc.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div> : null}</KV>
        <KV label="Created">{fmtDate(doc.created_at)}</KV>
        <p className="mt-2 text-[12px] text-ink-3">Only the owner and document managers can edit these details.</p>
      </Section>
    )
  }

  const approving = form.status === "Approved" && doc.status !== "Approved"
  return (
    <Section title="Details">
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Title" className="col-span-2" htmlFor="doc-title">
          <Input id="doc-title" value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={400} />
        </Field>
        <Field label="Description" className="col-span-2" htmlFor="doc-desc">
          <Textarea id="doc-desc" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Type">
          <OptionSelect value={form.doc_type} onChange={(v) => set("doc_type", v ?? "Other")} options={meta?.types ?? [form.doc_type]} />
        </Field>
        <Field label="Status" hint={!canApprove ? "Only document managers can set Approved." : undefined}>
          <OptionSelect value={form.status}
            onChange={(v) => {
              const s = v ?? "Draft"
              setForm((f) => ({ ...f, status: s, approved_at: s === "Approved" && !f.approved_at && canApprove ? isoDate(new Date()) : f.approved_at }))
            }}
            options={DOC_STATUSES.map((s) => ({ value: s, label: s === "Approved" && !canApprove ? <span className="text-ink-3">Approved (managers only)</span> : s }))} />
        </Field>
        <Field label="Classification">
          <OptionSelect value={form.classification} onChange={(v) => set("classification", v ?? "Internal")} options={meta?.classifications ?? [form.classification]} />
        </Field>
        <Field label="Version label" htmlFor="doc-vl">
          <Input id="doc-vl" value={form.version_label ?? ""} onChange={(e) => set("version_label", e.target.value)} maxLength={40} />
        </Field>
        <Field label="Entity" className="col-span-2">
          <EntitySelect value={form.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide (all entities)" />
        </Field>
        <Field label="Owner" className="col-span-2">
          <UserSelect value={form.owner_id} onChange={(v) => set("owner_id", v)} placeholder="Owner…" />
        </Field>
        <Field label="Approved on" htmlFor="doc-appr">
          <Input id="doc-appr" type="date" value={form.approved_at ?? ""} onChange={(e) => set("approved_at", e.target.value || null)} disabled={!canApprove} />
        </Field>
        <Field label="Approved by" htmlFor="doc-apprby">
          <Input id="doc-apprby" value={form.approved_by ?? ""} onChange={(e) => set("approved_by", e.target.value)} disabled={!canApprove} placeholder="Your name, or e.g. Management board" />
        </Field>
        <Field label="Next review" htmlFor="doc-review" className="col-span-2" hint="Documents past this date are flagged as review overdue.">
          <Input id="doc-review" type="date" value={form.next_review_date ?? ""} onChange={(e) => set("next_review_date", e.target.value || null)} />
        </Field>
        <Field label="Tags" hint="Comma separated" className="col-span-2" htmlFor="doc-tags">
          <Input id="doc-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="policy, backup" />
        </Field>
        <Field label="External link" className="col-span-2" htmlFor="doc-url" hint="Optional, for documents kept in another system (must start with https://)">
          <Input id="doc-url" type="url" value={form.external_url ?? ""} onChange={(e) => set("external_url", e.target.value)} placeholder="https://" />
        </Field>
        {approving && canApprove && (
          <p className="col-span-2 rounded-md bg-petrol-50 px-3 py-2 text-[12.5px] text-petrol">Saving records this document as approved{form.approved_at ? ` on ${fmtDate(form.approved_at)}` : ""}.</p>
        )}
        {error && <ErrorState className="col-span-2" error={error} />}
        <div className="col-span-2 flex items-center gap-2">
          <Button type="submit" disabled={!dirty || !form.title.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => { setForm(initial); setTagText(doc.tags.join(", ")); setError(null) }}>Discard</Button>
          )}
          <span className="ml-auto text-[12px] text-ink-3">Updated {fromNow(doc.updated_at)}</span>
        </div>
      </form>
    </Section>
  )
}

function LinkedObjects({ docId, links, canEdit, onChange }: { docId: number; links: DocLinkRow[]; canEdit: boolean; onChange: () => void }) {
  const { canAny } = useAuth()
  const canLinkReq = canAny("assessments.edit") && canAny("catalog.read")
  const [reqId, setReqId] = useState<number | null>(null)
  const reqs = useQuery({
    queryKey: ["requirements", "all"],
    queryFn: () => api.get<Requirement[]>("/requirements"),
    enabled: canLinkReq,
    staleTime: 10 * 60_000,
  })
  const linkedReqIds = useMemo(() => new Set(links.filter((l) => l.target_type === "requirement").map((l) => l.target_id)), [links])
  const add = useMutation({
    mutationFn: (id: number) => api.post(`/documents/${docId}/links`, { target_type: "requirement", target_id: id }),
    onSuccess: () => { toast.success("Requirement linked"); setReqId(null); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  const unlink = useMutation({
    mutationFn: (linkId: number) => api.del(`/documents/links/${linkId}`),
    onSuccess: () => { toast.success("Link removed"); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  const groups = useMemo(() => {
    const g: Record<string, DocLinkRow[]> = {}
    for (const l of links) (g[l.target_type] ??= []).push(l)
    return Object.entries(g).sort(([a], [b]) => Object.keys(LINK_TYPE_LABEL).indexOf(a) - Object.keys(LINK_TYPE_LABEL).indexOf(b))
  }, [links])

  return (
    <Section title={<span>Linked objects <span className="tabular font-normal text-ink-3">{links.length}</span></span>}>
      {links.length === 0 && (
        <p className="text-[13px] text-ink-3">This document is not linked to anything yet. Link it to the requirements it provides evidence for; answers, tasks and work packages link it from their own pages.</p>
      )}
      <div className="space-y-4">
        {groups.map(([type, rows]) => (
          <div key={type}>
            <h3 className="mb-1 text-[12.5px] font-medium text-ink-3">{LINK_TYPE_LABEL[type] ?? type}</h3>
            <ul className="divide-y rounded-md border">
              {rows.map((l) => {
                const noAccess = l.label === "(no access)"
                return (
                  <li key={l.id} className="group flex items-center gap-2 px-3 py-1.5 text-[13px]">
                    <Link2 className="size-3.5 shrink-0 text-ink-3" />
                    {noAccess ? (
                      <span className="flex-1 text-ink-3 italic">No access to this {type.replace("_", " ")}</span>
                    ) : l.url ? (
                      <Link to={l.url} className="min-w-0 flex-1 truncate text-ink hover:text-petrol">{l.label}</Link>
                    ) : (
                      <span className={cn("min-w-0 flex-1 truncate", l.label === "(deleted)" ? "text-ink-3 italic" : "text-ink")}>{l.label === "(deleted)" ? "Deleted object" : l.label}</span>
                    )}
                    {l.note && <span className="max-w-[40%] truncate text-[12px] text-ink-3" title={l.note}>{l.note}</span>}
                    {canEdit && !noAccess && (
                      <button type="button" className="rounded p-0.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-alarm focus-visible:opacity-100"
                        aria-label={`Remove link to ${l.label}`} onClick={() => unlink.mutate(l.id)}>
                        <X className="size-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {canLinkReq && (
        <div className="mt-4 flex items-center gap-2 border-t pt-3">
          <div className="min-w-0 flex-1">
            <Combo value={reqId} onChange={setReqId} placeholder="Link to requirement…" searchPlaceholder="Search number or title"
              items={(reqs.data ?? []).filter((r) => !linkedReqIds.has(r.id)).map((r) => ({ value: r.id, label: `${r.number} ${r.section.replace(/^[\d.]+\s*/, "")}`, hint: r.is_core ? "core" : undefined }))} />
          </div>
          <Button variant="outline" disabled={reqId == null || add.isPending} onClick={() => reqId != null && add.mutate(reqId)}>Link requirement</Button>
        </div>
      )}
    </Section>
  )
}

function Acknowledgements({ acks, versions, current, meName }: {
  acks: DocDetail["acknowledgements"]
  versions: DocVersion[]
  current: DocVersion | null
  meName?: string
}) {
  const currentAcks = acks.filter((a) => a.version_id === (current?.id ?? null)).sort((a, b) => b.acknowledged_at.localeCompare(a.acknowledged_at))
  const older = acks.filter((a) => a.version_id !== (current?.id ?? null))
  const versionNo = (vid: number | null) => versions.find((v) => v.id === vid)?.version_no
  return (
    <Section title={<span>Read confirmations <span className="tabular font-normal text-ink-3">{currentAcks.length}</span></span>}>
      {currentAcks.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nobody has confirmed reading the current version yet. Use “I have read this” to record that you know its content.</p>
      ) : (
        <ul className="space-y-2">
          {currentAcks.map((a) => (
            <li key={`${a.user_id}-${a.version_id}`} className="flex items-center gap-2 text-[13px]">
              <UserAvatar name={a.user} />
              <span className="flex-1 truncate">{a.user}{a.user === meName ? <span className="text-ink-3"> (you)</span> : null}</span>
              <span className="text-[12px] text-ink-3" title={fmtDateTime(a.acknowledged_at)}>{fmtDate(a.acknowledged_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {older.length > 0 && (
        <details className="mt-3 border-t pt-2 text-[12.5px]">
          <summary className="cursor-pointer text-ink-3 hover:text-ink">{older.length} confirmation{older.length === 1 ? "" : "s"} of earlier versions</summary>
          <ul className="mt-2 space-y-1">
            {older.map((a) => (
              <li key={`${a.user_id}-${a.version_id}`} className="flex gap-2 text-ink-2">
                <span className="flex-1 truncate">{a.user}</span>
                <span className="tabular text-ink-3">{versionNo(a.version_id) ? `v${versionNo(a.version_id)}` : ""}</span>
                <span className="text-ink-3">{fmtDate(a.acknowledged_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  )
}

function AiSummarySection({ summary, error, pending, hasText, onRun, onClear, canEdit, doc }: {
  summary: AiSummary | null
  error: string | null
  pending: boolean
  hasText: boolean
  onRun: () => void
  onClear: () => void
  canEdit: boolean
  doc: DocumentItem
}) {
  const qc = useQueryClient()
  const newTags = (summary?.suggested_tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t && !doc.tags.includes(t))
  const addTags = useMutation({
    mutationFn: () => api.put(`/documents/${doc.id}`, { ...metaOf(doc), tags: [...doc.tags, ...newTags] }),
    onSuccess: () => { toast.success("Tags added"); qc.invalidateQueries({ queryKey: ["documents"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (!summary && !error && !pending) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-card px-4 py-3">
        <div className="text-[13px] text-ink-2">Get a short summary, the key obligations and the NIS-2 topics this document covers.</div>
        <Button variant="outline" onClick={onRun} disabled={!hasText}><Sparkles /> Summarise with AI</Button>
      </div>
    )
  }
  return (
    <Section title="AI summary" actions={
      <>
        <Button size="xs" variant="ghost" onClick={onRun} disabled={pending}>Run again</Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close summary" onClick={onClear}><X /></Button>
      </>
    }>
      {pending ? <Loading label="Reading the document" className="p-0" /> : error ? <ErrorState error={error} /> : summary && (
        <div className="space-y-3 text-[13px]">
          {summary.summary && <Markdown className="prose-md text-[13.5px]">{summary.summary}</Markdown>}
          {!!summary.key_obligations?.length && (
            <div>
              <h3 className="mb-1 text-[12.5px] font-medium text-ink-3">Key obligations</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-ink">{summary.key_obligations.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}
          {!!summary.nis2_topics?.length && (
            <div>
              <h3 className="mb-1 text-[12.5px] font-medium text-ink-3">NIS-2 topics (Art. 21(2))</h3>
              <div className="flex flex-wrap gap-1">{summary.nis2_topics.map((t) => <Pill key={t} tone="petrol">{t}</Pill>)}</div>
            </div>
          )}
          {!!summary.suggested_tags?.length && (
            <div className="flex flex-wrap items-center gap-1">
              <h3 className="mr-1 text-[12.5px] font-medium text-ink-3">Suggested tags</h3>
              {summary.suggested_tags.map((t) => <Pill key={t} tone="outline">{t}</Pill>)}
              {canEdit && newTags.length > 0 && (
                <Button size="xs" variant="outline" className="ml-1" disabled={addTags.isPending} onClick={() => addTags.mutate()}>Add {newTags.length === 1 ? "tag" : `${newTags.length} tags`}</Button>
              )}
            </div>
          )}
          <p className="text-[12px] text-ink-3">Generated by the AI assistant from the extracted text of the current version. Check it against the document before relying on it.</p>
        </div>
      )}
    </Section>
  )
}

