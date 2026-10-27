import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Award, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Empty, ErrorState, Section } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Combo, Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { CertStatePill, type Certificate, DocumentPicker, type SupplierDetail, supplierKey, useSupplierMeta } from "./shared"

export function CertificatesTab({ supplier }: { supplier: SupplierDetail }) {
  const qc = useQueryClient()
  const refresh = () => { qc.invalidateQueries({ queryKey: supplierKey(supplier.id) }); qc.invalidateQueries({ queryKey: ["suppliers", "list"] }) }
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/suppliers/certificates/${id}`),
    onSuccess: () => { toast.success("Certificate removed"); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const certs = supplier.certificate_list
  return (
    <Section title="Certificates and attestations" bodyClassName="p-0"
      actions={supplier.can_edit && <CertificateDialog supplierId={supplier.id} onSaved={refresh} trigger={<Button size="sm" variant="outline"><Plus /> Add certificate</Button>} />}>
      {certs.length === 0 ? (
        <Empty title="No certificates recorded" icon={<Award className="size-6" />}>
          Record ISO/IEC 27001, TISAX, SOC 2 or IEC 62443 certificates with their scope and expiry date. Expiring certificates are highlighted 60 days in advance.
        </Empty>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-3">
                <th className="py-2 pr-2 pl-4 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Scope</th>
                <th className="px-2 py-2 font-medium">Issuer</th>
                <th className="px-2 py-2 font-medium">Valid until</th>
                <th className="px-2 py-2 font-medium">State</th>
                <th className="px-2 py-2 font-medium">Document</th>
                {supplier.can_edit && <th className="w-20 px-2 py-2 pr-4"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-2 pl-4 font-medium text-ink">{c.cert_type}</td>
                  <td className="px-2 py-2 text-ink-2">{c.scope ?? <span className="text-ink-3">–</span>}{c.notes && <div className="mt-0.5 text-[12px] text-ink-3">{c.notes}</div>}</td>
                  <td className="px-2 py-2 text-ink-2">{c.issuer ?? <span className="text-ink-3">–</span>}</td>
                  <td className="tabular px-2 py-2 whitespace-nowrap">{fmtDate(c.valid_until)}</td>
                  <td className="px-2 py-2"><CertStatePill state={c.state} /></td>
                  <td className="px-2 py-2">{c.document ? <Link to={`/documents/${c.document.id}`} className="text-petrol hover:underline">{c.document.title}</Link> : <span className="text-ink-3">–</span>}</td>
                  {supplier.can_edit && (
                    <td className="px-2 py-2 pr-4">
                      <div className="flex justify-end gap-1">
                        <CertificateDialog supplierId={supplier.id} cert={c} onSaved={refresh}
                          trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.cert_type}`}><Pencil /></Button>} />
                        <Confirm title={`Remove ${c.cert_type}?`} confirmLabel="Remove certificate" onConfirm={() => del.mutate(c.id)}
                          trigger={<Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.cert_type}`}><Trash2 /></Button>} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function CertificateDialog({ supplierId, cert, trigger, onSaved }: { supplierId: number; cert?: Certificate; trigger: ReactNode; onSaved: () => void }) {
  const meta = useSupplierMeta()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string | null>(null)
  const [custom, setCustom] = useState("")
  const [scope, setScope] = useState("")
  const [issuer, setIssuer] = useState("")
  const [valid, setValid] = useState("")
  const [docId, setDocId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const reset = () => {
    const known = cert && meta.cert_types.includes(cert.cert_type)
    setType(cert ? (known ? cert.cert_type : "Other") : null)
    setCustom(cert && !known ? cert.cert_type : "")
    setScope(cert?.scope ?? ""); setIssuer(cert?.issuer ?? ""); setValid(cert?.valid_until ?? "")
    setDocId(cert?.document?.id ?? null); setNotes(cert?.notes ?? ""); setError(null)
  }
  const certType = type === "Other" ? custom.trim() || "Other" : type
  const save = useMutation({
    mutationFn: () => {
      const body = { cert_type: certType, scope: scope.trim() || null, issuer: issuer.trim() || null, valid_until: valid || null, document_id: docId, notes: notes.trim() || null }
      return cert ? api.put(`/suppliers/certificates/${cert.id}`, body) : api.post(`/suppliers/${supplierId}/certificates`, body)
    },
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(cert ? "Certificate saved" : "Certificate added"); setOpen(false); onSaved() },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cert ? "Edit certificate" : "Add certificate"}</DialogTitle>
          <DialogDescription>Check that the scope covers the services supplied to you.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Combo value={type} onChange={setType} allowNone={false} placeholder="Choose type…" items={meta.cert_types.map((t) => ({ value: t, label: t }))} /></Field>
          {type === "Other" ? (
            <Field label="Name of the certificate" htmlFor="cert-custom"><Input id="cert-custom" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} placeholder="e.g. ISO 9001" /></Field>
          ) : (
            <Field label="Valid until" htmlFor="cert-valid"><Input id="cert-valid" type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
          )}
          {type === "Other" && <Field label="Valid until" htmlFor="cert-valid2"><Input id="cert-valid2" type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>}
          <Field label="Issuer" htmlFor="cert-issuer" className={type === "Other" ? "" : "col-span-2"}><Input id="cert-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} maxLength={200} /></Field>
          <Field label="Scope" htmlFor="cert-scope" className="col-span-2"><Textarea id="cert-scope" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
          <Field label="Certificate document" className="col-span-2"><DocumentPicker value={docId} onChange={setDocId} /></Field>
          <Field label="Notes" htmlFor="cert-notes" className="col-span-2"><Textarea id="cert-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {error && <ErrorState error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!certType || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : cert ? "Save changes" : "Add certificate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
