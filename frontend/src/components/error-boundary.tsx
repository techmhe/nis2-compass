import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Catches rendering errors of one page so the rest of the app keeps working. Reset by changing `resetKey`. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page error", error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-md border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto size-6 text-alarm" />
        <h1 className="mt-2 text-[16px] font-semibold text-ink">This page could not be displayed</h1>
        <p className="mt-1 text-[13px] text-ink-3">An unexpected error occurred while showing this page. Other pages are not affected.</p>
        <pre className="mt-3 max-h-32 overflow-auto rounded bg-muted p-2 text-left font-mono text-[11.5px] text-ink-2">{this.state.error.message}</pre>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button onClick={() => window.location.reload()}>Reload the app</Button>
        </div>
      </div>
    )
  }
}
