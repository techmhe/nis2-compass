import { Field, Textarea } from "@nis2-compass/ui"

export function Basic() {
  return (
    <div className="max-w-md">
      <Field label="Notes" hint="Interview notes; not exported to the action plan" htmlFor="t-notes">
        <Textarea id="t-notes" rows={3} defaultValue="Control owner confirmed the procedure is followed for all new hires; evidence still to be attached." />
      </Field>
    </div>
  )
}

export function Empty() {
  return (
    <div className="max-w-md">
      <Textarea rows={3} placeholder="Describe the root cause and immediate containment steps…" />
    </div>
  )
}

export function InvalidAndDisabled() {
  return (
    <div className="grid max-w-md gap-3">
      <Field label="Address" htmlFor="t-addr-bad">
        <Textarea id="t-addr-bad" rows={2} aria-invalid placeholder="Required" />
      </Field>
      <Field label="Internal notes" htmlFor="t-notes-disabled">
        <Textarea id="t-notes-disabled" rows={2} defaultValue="Locked after approval." disabled />
      </Field>
    </div>
  )
}
