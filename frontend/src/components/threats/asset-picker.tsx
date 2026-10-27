import { Code } from "@/components/common/basics"
import { ChipPicker } from "@/components/ui/chip-picker"
import { useAssets } from "@/components/inventory/shared"

/** Multi-select of inventory assets shown as removable chips. */
export function AssetPicker({ value, onChange, disabled }: { value: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const assets = useAssets()
  return (
    <ChipPicker value={value} onChange={onChange} disabled={disabled} items={assets.data} loading={assets.isLoading}
      noun="asset" searchPlaceholder="Search asset name or code…"
      itemLabel={(a) => a.code}
      searchText={(a) => `${a.code} ${a.name}`}
      chip={(a, id) => (
        <>
          <Code className="text-[11.5px]">{a?.code ?? id}</Code>
          {a && <span className="max-w-[160px] truncate text-ink-2">{a.name}</span>}
        </>
      )}
      row={(a) => (
        <>
          <Code className="w-16 shrink-0">{a.code}</Code>
          <span className="truncate text-[12.5px]">{a.name}</span>
          {a.entity && <span className="ml-auto shrink-0 text-[11px] text-ink-3">{a.entity.code}</span>}
        </>
      )} />
  )
}
