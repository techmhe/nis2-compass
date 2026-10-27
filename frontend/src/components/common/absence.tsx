import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"

interface Absence { start: string; until: string; deputy_id: number; deputy_name?: string }

/** Absence with a deputy (Profile): the deputy receives a copy of the user's notifications while they are away. */
export function AbsenceSettings() {
  const { me, refresh } = useAuth()
  const current = me?.preferences?.absence as Absence | undefined
  const [start, setStart] = useState(current?.start ?? isoDate(new Date()))
  const [until, setUntil] = useState(current?.until ?? "")
  const [deputy, setDeputy] = useState<number | null>(current?.deputy_id ?? null)
  const save = useMutation({
    mutationFn: () => api.put("/auth/me/absence", { start, until, deputy_id: deputy }),
    onSuccess: () => { toast.success("Absence saved"); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const clear = useMutation({
    mutationFn: () => api.del("/auth/me/absence"),
    onSuccess: () => { toast.success("Absence removed"); setUntil(""); setDeputy(null); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const invalid = !until || until < start || !deputy || deputy === me?.id
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-3">
        While you are away, your deputy receives a copy of your reminders for items they may see themselves, and a
        short notice without details for everything else.
      </p>
      {current && (
        <p className="rounded-md bg-petrol-50 px-3 py-2 text-[13px] text-petrol">
          Away {fmtDate(current.start)} to {fmtDate(current.until)}, deputy {current.deputy_name ?? `user ${current.deputy_id}`}.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Until"><Input type="date" value={until} min={start} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label="Deputy"><UserSelect value={deputy} onChange={setDeputy} placeholder="Select deputy…" /></Field>
      </div>
      <div className="flex gap-2">
        <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>Save absence</Button>
        {current && <Button variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()}>Remove absence</Button>}
      </div>
    </div>
  )
}
