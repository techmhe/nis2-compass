import { Button, Icons } from "@nis2-compass/ui"

const COMMON = [
  "Plus", "Pencil", "Trash2", "Download", "Upload", "Search", "RefreshCw", "Check", "X", "ChevronRight",
  "AlertTriangle", "ShieldAlert", "CalendarCheck", "FileText", "Link2", "Sparkles", "Bug", "Gauge", "Layers", "Truck",
] as const

export function Gallery() {
  return (
    <div className="grid grid-cols-5 gap-3">
      {COMMON.map((name) => {
        const Icon = (Icons as Record<string, React.ComponentType<{ className?: string }>>)[name]
        return (
          <div key={name} className="flex flex-col items-center gap-1.5 rounded-md border bg-card p-3">
            {Icon ? <Icon className="size-5 text-ink-2" /> : null}
            <span className="font-mono text-[11px] text-ink-3">{name}</span>
          </div>
        )
      })}
    </div>
  )
}

export function InButtons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button><Icons.Plus /> New item</Button>
      <Button variant="outline"><Icons.Download /> Export workbook</Button>
      <Button variant="outline"><Icons.Sparkles /> Rewrite with AI</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Delete"><Icons.Trash2 /></Button>
    </div>
  )
}
