import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@nis2-compass/ui"
import { ChevronDown } from "lucide-react"

export function Open() {
  return (
    <Collapsible defaultOpen className="w-[360px]">
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-petrol">
        <ChevronDown className="size-3.5 rotate-180 transition-transform" />
        Hide provision text
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1 max-w-[80ch] text-[12.5px] text-ink-2">(5.1.4) The entity shall maintain a supplier register that records each supplier's criticality classification and the date of the most recent security assessment.</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function Closed() {
  return (
    <Collapsible className="w-[360px]">
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-petrol">
        <ChevronDown className="size-3.5 transition-transform" />
        Show provision text
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1 max-w-[80ch] text-[12.5px] text-ink-2">(1.1.1) The entity shall document an information security policy, proportionate to its risk exposure, and have it approved by the Information Security Officer.</p>
      </CollapsibleContent>
    </Collapsible>
  )
}
