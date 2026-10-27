import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type { AnswerRow, AssessmentDetail, Stakeholder } from "@/lib/types"
import { applyLocal } from "./shared"

export type SaveState = "idle" | "saving" | "saved" | "error"

/** Body accepted by PATCH /api/answers/{id}. */
export interface AnswerChanges {
  scope?: string
  implemented?: string | null
  documented?: string | null
  effectiveness?: string | null
  evidence?: string | null
  gap_description?: string | null
  recommended_action?: string | null
  responsible_id?: number | null
  target_date?: string | null
  effort?: string | null
  notes?: string | null
  review_status?: "draft" | "reviewed"
}

export const answersKey = (assessmentId: number) => ["answers", assessmentId] as const

/**
 * Saves answer changes with an optimistic cache update. Requests for the same answer are chained so the
 * last response always reflects every change; intermediate responses are ignored.
 */
export function useAnswerPatcher(assessmentId: number, prefix: string | undefined) {
  const qc = useQueryClient()
  const [state, setState] = useState<SaveState>("idle")
  const chains = useRef(new Map<number, Promise<unknown>>())
  const pending = useRef(new Map<number, number>())
  const inflight = useRef(0)
  const lastError = useRef<{ answerId: number; changes: AnswerChanges } | null>(null)

  const patch = useCallback(
    (answerId: number, changes: AnswerChanges): Promise<AnswerRow | null> => {
      const key = answersKey(assessmentId)
      const stakeholders = qc.getQueryData<Stakeholder[]>(["stakeholders"]) ?? []
      const rowChanges: Partial<AnswerRow> = { ...(changes as Partial<AnswerRow>) }
      if ("responsible_id" in changes) {
        const s = stakeholders.find((x) => x.id === changes.responsible_id)
        rowChanges.responsible = s ? { id: s.id, name: s.name, kind: s.kind, user_id: s.user_id } : null
        delete (rowChanges as Record<string, unknown>).responsible_id
      }
      if (changes.review_status) rowChanges.review_status = changes.review_status
      qc.setQueryData<AnswerRow[]>(key, (rows) => rows?.map((r) => (r.id === answerId ? applyLocal(r, rowChanges, prefix) : r)))

      pending.current.set(answerId, (pending.current.get(answerId) ?? 0) + 1)
      inflight.current++
      setState("saving")
      const prev = chains.current.get(answerId) ?? Promise.resolve()
      const run = prev.catch(() => undefined).then(() => api.patch<AnswerRow>(`/answers/${answerId}`, changes))
      chains.current.set(answerId, run)
      return run
        .then((res) => {
          const left = (pending.current.get(answerId) ?? 1) - 1
          pending.current.set(answerId, left)
          if (left === 0) {
            qc.setQueryData<AnswerRow[]>(key, (rows) =>
              rows?.map((r) => (r.id === answerId ? { ...res, doc_count: r.doc_count, comment_count: r.comment_count } : r)))
          }
          qc.invalidateQueries({ queryKey: ["answer", answerId] })
          qc.invalidateQueries({ queryKey: ["action-items", "unplanned"] })
          const asm = qc.getQueryData<AssessmentDetail>(["assessment", assessmentId])
          if (asm?.status === "not_started") qc.invalidateQueries({ queryKey: ["assessment", assessmentId] })
          lastError.current = null
          return res
        })
        .catch((e: Error) => {
          const left = (pending.current.get(answerId) ?? 1) - 1
          pending.current.set(answerId, left)
          lastError.current = { answerId, changes }
          toast.error(`Answer not saved: ${e.message}`)
          qc.invalidateQueries({ queryKey: key })
          setState("error")
          return null
        })
        .finally(() => {
          inflight.current--
          if (inflight.current === 0) setState((s) => (s === "error" ? s : "saved"))
          if (chains.current.get(answerId) === run) chains.current.delete(answerId)
        })
    },
    [qc, assessmentId, prefix],
  )

  const retry = useCallback(() => {
    const e = lastError.current
    if (e) patch(e.answerId, e.changes)
  }, [patch])

  return { patch, state, retry }
}

export const TEXT_FIELDS = ["evidence", "gap_description", "recommended_action", "notes"] as const
export type TextField = (typeof TEXT_FIELDS)[number]
type Drafts = Record<TextField, string>

const pick = (row: AnswerRow): Drafts => ({
  evidence: row.evidence ?? "", gap_description: row.gap_description ?? "", recommended_action: row.recommended_action ?? "", notes: row.notes ?? "",
})

/**
 * Local drafts for the free-text fields of one answer. Typing is debounced (600 ms) and flushed on blur and
 * when the panel unmounts; external changes (copy, revert, bulk edits) flow in for fields that are not being edited.
 */
export function useTextDrafts(row: AnswerRow, patch: (id: number, c: AnswerChanges) => Promise<unknown>, delay = 600) {
  const [drafts, setDrafts] = useState<Drafts>(() => pick(row))
  const dirty = useRef<Partial<Drafts>>({})
  const sending = useRef<Partial<Drafts>>({})
  const timer = useRef<number | null>(null)
  const answerId = row.id

  useEffect(() => {
    setDrafts((d) => {
      const server = pick(row)
      let changed = false
      const next = { ...d }
      for (const f of TEXT_FIELDS) {
        if (f in dirty.current || f in sending.current) continue
        if (next[f] !== server[f]) { next[f] = server[f]; changed = true }
      }
      return changed ? next : d
    })
  }, [row.evidence, row.gap_description, row.recommended_action, row.notes])

  const flush = useCallback(() => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    const changes = dirty.current
    const keys = Object.keys(changes) as TextField[]
    if (!keys.length) return
    dirty.current = {}
    Object.assign(sending.current, changes)
    const body: AnswerChanges = {}
    for (const k of keys) body[k] = changes[k]!.trim() === "" ? null : changes[k]!
    patch(answerId, body).finally(() => {
      for (const k of keys) if (sending.current[k] === changes[k]) delete sending.current[k]
    })
  }, [patch, answerId])

  const setField = useCallback((f: TextField, v: string) => {
    setDrafts((d) => ({ ...d, [f]: v }))
    dirty.current[f] = v
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, delay)
  }, [flush, delay])

  useEffect(() => () => flush(), [flush])

  return { drafts, setField, flush }
}
