import { useState, type ReactNode } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEntities, useStakeholders, useUsers } from "@/hooks/useRefData"
import { cn } from "@/lib/utils"

const NONE = "__none__"

/** Simple select over string options; value null = none. */
export function OptionSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowNone = false,
  noneLabel = "None",
  disabled,
  className,
  size = "default",
  id,
  invalid,
  describedBy,
}: {
  id?: string
  invalid?: boolean
  describedBy?: string
  value: string | null | undefined
  onChange: (v: string | null) => void
  options: readonly (string | { value: string; label: ReactNode })[]
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
  disabled?: boolean
  className?: string
  size?: "sm" | "default"
}) {
  return (
    // "" keeps the select controlled while there is no value and shows the placeholder; undefined would make it
    // uncontrolled until the first value arrives. "" is never an option, so it is not reported as a choice.
    <Select value={value ?? (allowNone ? NONE : "")} disabled={disabled}
      onValueChange={(v) => { if (v !== "") onChange(v === NONE ? null : v) }}>
      <SelectTrigger id={id} size={size} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}><span className="text-ink-3">{noneLabel}</span></SelectItem>}
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value
          const l = typeof o === "string" ? o : o.label
          return <SelectItem key={v} value={v}>{l}</SelectItem>
        })}
      </SelectContent>
    </Select>
  )
}

/** Searchable single-select combobox. */
export function Combo<T extends string | number>({
  value,
  onChange,
  items,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  allowNone = true,
  disabled,
  className,
}: {
  value: T | null | undefined
  onChange: (v: T | null) => void
  items: { value: T; label: string; hint?: string }[]
  placeholder?: string
  searchPlaceholder?: string
  allowNone?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = items.find((i) => i.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" disabled={disabled}
          className={cn("h-9 w-full justify-between px-3 font-normal", !current && "text-ink-3", className)}>
          <span className="truncate">{current ? current.label : placeholder}</span>
          <span className="flex items-center gap-1">
            {allowNone && current && !disabled && (
              <X className="size-3.5 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); onChange(null) }} />
            )}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem key={String(i.value)} value={`${i.label} ${i.hint ?? ""}`} onSelect={() => { onChange(i.value); setOpen(false) }}>
                  <Check className={cn("size-3.5", i.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{i.label}</span>
                  {i.hint && <span className="ml-auto truncate text-[11.5px] text-ink-3">{i.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function StakeholderSelect(props: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  const { data = [] } = useStakeholders()
  return (
    <Combo {...props} placeholder={props.placeholder ?? "Responsible…"}
      items={data.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name, hint: s.kind === "role" ? "role" : s.kind }))} />
  )
}

export function UserSelect(props: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  const { data = [] } = useUsers()
  return (
    <Combo {...props} placeholder={props.placeholder ?? "Assign to…"}
      items={data.map((u) => ({ value: u.id, label: u.display_name, hint: u.job_title ?? u.email }))} />
  )
}

export function EntitySelect({ value, onChange, allowGroup = true, groupLabel = "Group / all entities", disabled, className }: {
  value: number | null | undefined
  onChange: (v: number | null) => void
  allowGroup?: boolean
  groupLabel?: string
  disabled?: boolean
  className?: string
}) {
  const { data = [] } = useEntities()
  return (
    <OptionSelect value={value != null ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)}
      allowNone={allowGroup} noneLabel={groupLabel} disabled={disabled} className={className} placeholder="Entity…"
      options={data.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
  )
}

/** Segmented choice used for the assessment answers (Yes / Partial / No / N/A). */
export function Segmented({
  value,
  onChange,
  options,
  disabled,
  toneOf,
  size = "md",
}: {
  value: string | null | undefined
  onChange: (v: string | null) => void
  options: readonly string[]
  disabled?: boolean
  toneOf?: (v: string) => string
  size?: "sm" | "md"
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-md border bg-surface p-0.5", disabled && "opacity-60")}>
      {options.map((o) => {
        const active = value === o
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(active ? null : o)}
            className={cn(
              "rounded-[4px] px-2.5 font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-6 text-[12px]" : "h-7 text-[12.5px]",
              active ? "text-white shadow-xs" : "text-ink-2 hover:bg-muted",
            )}
            style={active ? { background: toneOf?.(o) ?? "var(--petrol)" } : undefined}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function answerTone(v: string): string {
  switch (v) {
    case "Yes":
    case "Effective":
      return "var(--score-5)"
    case "Partial":
      return "var(--score-2)"
    case "Not Tested":
      return "var(--brass)"
    case "No":
    case "Ineffective":
      return "var(--score-0)"
    default:
      return "var(--ink-3)"
  }
}

export function Field({ label, children, hint, className, htmlFor }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  )
}
