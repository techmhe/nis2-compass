import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Field, OptionSelect } from "@/components/common/fields"

const OTHER = "__other__"
const MAX_LENGTH = 60

/** Legal form of a company: the country's forms from the API plus "Other…" with a free text input below.
 *  Place it inside a `Field` whose `htmlFor` is `id`. `value` null/"" = none; `allowNone` offers "Not set". */
export function LegalFormSelect({ id, country, forms, value, onChange, error, allowNone = false }: {
  id: string
  country: string | null | undefined
  forms: readonly string[]
  value: string | null | undefined
  onChange: (v: string | null) => void
  error?: string
  allowNone?: boolean
}) {
  const [otherChosen, setOtherChosen] = useState(false)
  const text = value ?? ""
  const other = otherChosen || (text !== "" && !forms.includes(text))

  // A form of the old country that the new one does not offer is cleared; a free "Other" value stays.
  const before = useRef({ country, forms })
  useEffect(() => {
    const prev = before.current
    before.current = { country, forms }
    if (prev.country !== country && text !== "" && !otherChosen && prev.forms.includes(text) && !forms.includes(text)) onChange(null)
  })

  const errorId = error ? `${id}-error` : undefined
  const otherId = `${id}-other`
  return (
    <>
      <OptionSelect id={id} value={other ? OTHER : text || null} allowNone={allowNone} noneLabel="Not set"
        invalid={!!error && !other} describedBy={other ? undefined : errorId}
        onChange={(v) => {
          if (v === OTHER) { setOtherChosen(true); if (!other) onChange(null) }
          else { setOtherChosen(false); onChange(v) }
        }}
        options={[...forms, { value: OTHER, label: "Other…" }]} />
      {other && (
        <Field label="Other legal form" htmlFor={otherId}>
          <Input id={otherId} value={text} maxLength={MAX_LENGTH} aria-invalid={!!error} aria-describedby={errorId}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
        </Field>
      )}
      {error && <p id={`${id}-error`} role="alert" className="text-[12px] text-alarm">{error}</p>}
    </>
  )
}
