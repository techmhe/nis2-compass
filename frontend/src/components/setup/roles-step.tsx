import { Plus, Trash2 } from "lucide-react"
import { Pill, Section } from "@/components/common/basics"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OfferedRole } from "@/hooks/useSetupStatus"

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface RoleRow {
  key: number
  /** The stakeholder's name on the server; empty for a custom role. */
  name: string
  /** What the input shows: the name, possibly edited. */
  label: string
  description: string | null
  kind: string
  mandatory: boolean
  country: string | null
  /** null = untouched: advisers follow the external-support answer, everything else takes part. */
  selected: boolean | null
  email: string
  custom: boolean
}

export type RoleErrors = Record<string, string>

export function rowsFromOffered(offered: OfferedRole[]): RoleRow[] {
  return offered.map((r, i) => ({
    key: i + 1, name: r.name, label: r.name, description: r.description, kind: r.kind, mandatory: r.mandatory,
    country: r.country, selected: r.mandatory ? true : null, email: "", custom: false,
  }))
}

export function blankRole(key: number): RoleRow {
  return { key, name: "", label: "", description: null, kind: "role", mandatory: false, country: null, selected: true, email: "", custom: true }
}

export const takesPart = (r: RoleRow, externalSupport: boolean) =>
  r.mandatory || (r.selected ?? (r.country ? externalSupport : true))

/** The rows the page shows: advisers only for the countries of the companies entered. */
export const shownRoles = (rows: RoleRow[], countries: string[]) => rows.filter((r) => !r.country || countries.includes(r.country))

export function validateRoles(rows: RoleRow[], externalSupport: boolean, oidc: boolean): RoleErrors {
  const e: RoleErrors = {}
  const names = new Set<string>()
  const emails = new Set<string>()
  rows.forEach((r, i) => {
    const label = r.label.trim()
    if (!label) e[`roles.${i}.name`] = "Role name is required"
    else if (label.length > 100) e[`roles.${i}.name`] = "At most 100 characters"
    else if (names.has(label.toLowerCase())) e[`roles.${i}.name`] = "Role name is used twice"
    names.add(label.toLowerCase())
    const mail = r.email.trim().toLowerCase()
    if (oidc && mail && takesPart(r, externalSupport)) {
      if (!EMAIL_RE.test(mail)) e[`roles.${i}.email`] = "Invalid e-mail address"
      else if (emails.has(mail)) e[`roles.${i}.email`] = "E-mail address is used twice"
      emails.add(mail)
    }
  })
  return e
}

/** The `roles` list of the setup request, in the order of `rows`. */
export function rolesPayload(rows: RoleRow[], externalSupport: boolean, oidc: boolean) {
  return rows.map((r) => {
    const selected = takesPart(r, externalSupport)
    const label = r.label.trim()
    return {
      name: r.custom ? label : r.name,
      rename_to: !r.custom && !r.mandatory && label !== r.name ? label : null,
      selected,
      email: oidc && selected && r.email.trim() ? r.email.trim() : null,
      custom: r.custom,
    }
  })
}

export function RolesStep({ rows, externalSupport, oidc, errors, onChange, onAdd, onRemove }: {
  /** The shown rows (see `shownRoles`); error keys use the index in this list. */
  rows: RoleRow[]
  externalSupport: boolean
  oidc: boolean
  errors: RoleErrors
  onChange: (key: number, patch: Partial<RoleRow>) => void
  onAdd: () => void
  onRemove: (key: number) => void
}) {
  let customNo = 0
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-3">
        The roles of the project plan. Rename a role to match your organisation, untick the ones you do not have and add your own.
        {oidc && " Enter the e-mail address of the person in a role to link them at their first sign-in."}
      </p>
      <Section bodyClassName="divide-y p-0">
        {rows.map((r, i) => {
          const err = (f: string) => errors[`roles.${i}.${f}`]
          const on = takesPart(r, externalSupport)
          const title = r.custom ? `Custom role ${++customNo}` : r.name
          return (
            <div key={r.key} role="group" aria-label={title} className="grid gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-3">
                <label className="inline-flex shrink-0 items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" className="size-4 accent-petrol" checked={on} disabled={r.mandatory} aria-label="Takes part"
                    onChange={(e) => onChange(r.key, { selected: e.target.checked })} />
                </label>
                <div className="min-w-0 flex-1">
                  <Input aria-label="Role name" value={r.label} maxLength={100} disabled={r.mandatory} aria-invalid={!!err("name")}
                    onChange={(e) => onChange(r.key, { label: e.target.value })} />
                </div>
                {r.mandatory && <Pill tone="neutral">Required</Pill>}
                {r.custom && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${title}`} onClick={() => onRemove(r.key)}><Trash2 /></Button>
                )}
              </div>
              {oidc && (
                <div className="min-w-0">
                  <Input type="email" aria-label="Person e-mail" placeholder="Person e-mail (optional)" value={r.email} maxLength={320} disabled={!on}
                    aria-invalid={!!err("email")} onChange={(e) => onChange(r.key, { email: e.target.value })} />
                </div>
              )}
              {err("name") && <p role="alert" className="text-[12px] text-alarm sm:col-span-2">{err("name")}</p>}
              {err("email") && <p role="alert" className="text-[12px] text-alarm sm:col-span-2">{err("email")}</p>}
              {r.description && <p className="break-words text-[12.5px] text-ink-3 sm:col-span-2">{r.description}</p>}
            </div>
          )
        })}
      </Section>
      <Button variant="outline" onClick={onAdd}><Plus /> Add role</Button>
    </div>
  )
}
