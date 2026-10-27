import type { ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Root wrapper for designs built with the NIS2 Compass components (Claude Design). Applies the design tokens, the
 * light or dark theme, IBM Plex Sans and the fog page background, and provides the tooltip and router context some
 * components need (Tooltip, Markdown links). Wrap the whole design once.
 */
export function DesignSystemProvider({ theme = "light", className, children }: {
  /** Colour theme; "dark" switches every token to its dark value. */
  theme?: "light" | "dark"
  className?: string
  children: ReactNode
}) {
  return (
    <MemoryRouter>
      <TooltipProvider delayDuration={300}>
        <div className={cn(theme === "dark" && "dark", "min-h-full bg-background font-sans text-[14px] text-foreground antialiased", className)}>
          {children}
        </div>
      </TooltipProvider>
    </MemoryRouter>
  )
}
