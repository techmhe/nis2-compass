import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nis2-compass/ui"
import { Info, RefreshCw, Trash2 } from "lucide-react"

export function IconButton() {
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Delete risk"><Trash2 /></Button>
      </TooltipTrigger>
      <TooltipContent>Delete risk</TooltipContent>
    </Tooltip>
  )
}

export function InfoHint() {
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <button className="inline-flex items-center text-ink-3" aria-label="About the score"><Info className="size-4" /></button>
      </TooltipTrigger>
      <TooltipContent>Score = weighted average of assessed requirements for this chapter.</TooltipContent>
    </Tooltip>
  )
}

export function OnAction() {
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm"><RefreshCw /> Refresh</Button>
      </TooltipTrigger>
      <TooltipContent>Recalculate scores for all entities</TooltipContent>
    </Tooltip>
  )
}
