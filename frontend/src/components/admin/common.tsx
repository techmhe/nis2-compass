import type { ReactNode } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export const TH = "px-3 py-2 text-left text-[12px] font-medium text-ink-3"
export const TD = "px-3 py-2 align-top"

export function DataTable({ children, className, minWidth = 760 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("overflow-x-auto rounded-md border bg-card scroll-thin", className)}>
      <table className="w-full text-[13px]" style={{ minWidth }}>{children}</table>
    </div>
  )
}

/** Shows a generated password once, with copy button. */
export function OneTimeSecretDialog({ secret, title, description, onClose }: {
  secret: string | null
  title: string
  description: ReactNode
  onClose: () => void
}) {
  return (
    <Dialog open={!!secret} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-petrol/40 bg-petrol-50 p-3">
          <code className="flex-1 font-mono text-[14px] break-all text-ink select-all">{secret}</code>
          <Button size="sm" variant="outline" onClick={() => { if (secret) navigator.clipboard.writeText(secret).then(() => toast.success("Copied")) }}>
            <Copy /> Copy
          </Button>
        </div>
        <p className="text-[12.5px] text-ink-3">This password is shown only once. The user must choose a new one at the next sign-in.</p>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SwitchRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <div className="text-[13.5px] text-ink">{title}</div>
        {description && <div className="text-[12px] text-ink-3">{description}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
