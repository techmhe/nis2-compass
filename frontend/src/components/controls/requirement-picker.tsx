import { useQuery } from "@tanstack/react-query"
import { Code } from "@/components/common/basics"
import { ChipPicker } from "@/components/ui/chip-picker"
import { api } from "@/lib/api"
import type { Requirement } from "@/lib/types"

export function useRequirements() {
  return useQuery({ queryKey: ["controls", "requirements"], queryFn: () => api.get<Requirement[]>("/requirements"), staleTime: 10 * 60_000 })
}

/** Multi-select of catalogue requirements shown as removable chips. */
export function RequirementPicker({ value, onChange, disabled, single }: {
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  single?: boolean
}) {
  const reqs = useRequirements()
  return (
    <ChipPicker value={value} onChange={onChange} disabled={disabled} single={single} items={reqs.data} loading={reqs.isLoading}
      noun="requirement" searchPlaceholder="Search number or title…"
      itemLabel={(r) => r.number}
      searchText={(r) => `${r.number} ${r.section} ${r.text.slice(0, 80)}`}
      chipTitle={(r) => r?.section}
      chip={(r, id) => <Code className="text-[11.5px]">{r?.number ?? id}</Code>}
      row={(r) => (
        <>
          <Code className="w-12 shrink-0">{r.number}</Code>
          <span className="truncate text-[12.5px]">{r.section.replace(/^[\d.]+\s*/, "")}</span>
        </>
      )} />
  )
}
