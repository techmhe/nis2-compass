import { useEffect, useRef } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useAssistant, type AssistantContext } from "@/components/assistant/provider"

/** Old links and bookmarks: open the assistant window (expanded) and continue on the Dashboard. */
export default function AssistantRedirect() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { openAssistant } = useAssistant()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const conversationId = id && Number.isInteger(Number(id)) ? Number(id) : undefined
    const context = (location.state as { context?: AssistantContext } | null)?.context
    openAssistant({ question: params.get("q") || undefined, conversationId, context, expanded: true })
    navigate("/", { replace: true })
  }, [id, params, location.state, openAssistant, navigate])
  return null
}
