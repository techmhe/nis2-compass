import { useState, type ReactNode } from "react"
import { Check, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Multi-select (or single-select) of objects shown as removable chips with a searchable popover list. */
export function ChipPicker<T extends { id: number }>({ value, onChange, items, loading, noun, searchPlaceholder, searchText,
  itemLabel, chip, row, chipTitle, disabled, single }: {
  value: number[]
  onChange: (ids: number[]) => void
  items: T[] | undefined
  loading?: boolean
  noun: string // "requirement", "asset": used in button, empty and aria texts
  searchPlaceholder: string
  searchText: (item: T) => string
  itemLabel: (item: T) => string // short name for screen readers, e.g. the requirement number
  chip: (item: T | undefined, id: number) => ReactNode
  row: (item: T) => ReactNode
  chipTitle?: (item: T | undefined) => string | undefined
  disabled?: boolean
  single?: boolean
}) {
  const [open, setOpen] = useState(false)
  const byId = new Map((items ?? []).map((i) => [i.id, i]))
  const toggle = (id: number) => {
    if (single) {
      onChange(value.includes(id) ? [] : [id])
      setOpen(false)
      return
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const item = byId.get(id)
        return (
          <span key={id} className="inline-flex h-6 items-center gap-1 rounded-[4px] border bg-surface pr-1 pl-1.5 text-[12px]" title={chipTitle?.(item)}>
            {chip(item, id)}
            {!disabled && (
              <button type="button" className="text-ink-3 hover:text-alarm" aria-label={`Remove ${noun} ${item ? itemLabel(item) : id}`} onClick={() => toggle(id)}>
                <X className="size-3" />
              </button>
            )}
          </span>
        )
      })}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="xs" variant="outline"><Plus /> {single ? `${value.length ? "Change" : "Choose"} ${noun}` : `Add ${noun}`}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="start">
            <Command>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList>
                <CommandEmpty>{loading ? "Loading…" : `No ${noun} found.`}</CommandEmpty>
                <CommandGroup>
                  {(items ?? []).map((item) => (
                    <CommandItem key={item.id} value={searchText(item)} onSelect={() => toggle(item.id)}>
                      <Check className={cn("size-3.5", value.includes(item.id) ? "opacity-100" : "opacity-0")} />
                      {row(item)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
