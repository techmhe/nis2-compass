import { Compass } from "lucide-react"
import { Link } from "react-router"
import { Section } from "@/components/common/basics"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { useMainProject } from "@/hooks/useRefData"
import { CHAPTERS } from "@/tour/chapters"
import { CHAPTER_GATES } from "@/tour/recommend"
import { PROJECT_PATH, ROLE_GUIDES, guideChapters, type RoleGuide } from "@/tour/guides"
import { TOUR_VERSION, readTourState } from "@/tour/state"
import { useTour } from "@/tour/TourProvider"
import { CHAPTER_ORDER } from "@/tour/types"

function RoleTab({ guide }: { guide: RoleGuide }) {
  const { canAny } = useAuth()
  const { start } = useTour()
  const { project } = useMainProject()
  const projectPath = `/projects/${project?.id ?? 1}`
  const chapters = guideChapters(guide.key).filter((c) => CHAPTERS[c])
  return (
    <div className="space-y-4 text-[13.5px]">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">What you do</h3>
        <p className="mt-1 text-ink-2">{guide.whatYouDo}</p>
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Your typical work</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
          {guide.typicalWork.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Pages you will use</h3>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {guide.pages.map((p) => (
            <li key={p.label}>
              {!p.perm || canAny(p.perm)
                ? <Link to={p.to === PROJECT_PATH ? projectPath : p.to} className="text-petrol underline-offset-2 hover:underline">{p.label}</Link>
                : <span className="text-ink-3">{p.label}</span>}
            </li>
          ))}
        </ul>
      </div>
      <ul className="divide-y rounded-md border">
        {chapters.map((c) => {
          const usable = c === "welcome" || CHAPTER_GATES[c].some(canAny)
          return (
            <li key={c} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-ink">{CHAPTERS[c]!.title}</span>
              <span className="flex items-center gap-2">
                {!usable && <span className="text-[12px] text-ink-3">Needs the {guide.name} role</span>}
                {/* An aria-label, not a hidden span: the span's absolute position puts a space before the colon. */}
                <Button variant="outline" size="sm" disabled={!usable} aria-label={`Show me: ${CHAPTERS[c]!.title}`}
                  onClick={() => start([c], { intro: false })}>
                  Show me
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function GettingStarted() {
  const { me } = useAuth()
  const { start, recommended } = useTour()
  const held = new Set((me?.roles ?? []).map((r) => r.key))
  const own = ROLE_GUIDES.find((g) => held.has(g.key)) ?? ROLE_GUIDES[0]
  const state = readTourState(me?.preferences ?? {})
  const done = state?.version === TOUR_VERSION ? state.chapters_done : []
  const seen = CHAPTER_ORDER.filter((c) => done.includes(c) && CHAPTERS[c])
  return (
    <Section
      title="Getting started"
      actions={<Button size="sm" onClick={() => start(recommended, { intro: false })}><Compass /> Take the tour</Button>}
    >
      <p className="mb-3 text-[13.5px] text-ink-2">
        Pick the role that fits your work. Show me runs one part of the tour on the real pages.
      </p>
      <Tabs defaultValue={own.key}>
        <TabsList variant="line" className="mb-3 flex-wrap">
          {ROLE_GUIDES.map((g) => <TabsTrigger key={g.key} value={g.key}>{g.name}</TabsTrigger>)}
        </TabsList>
        {ROLE_GUIDES.map((g) => (
          <TabsContent key={g.key} value={g.key}><RoleTab guide={g} /></TabsContent>
        ))}
      </Tabs>
      <div className="mt-4 border-t pt-3">
        <h3 className="text-[13px] font-semibold text-ink">Chapters you have seen</h3>
        {seen.length > 0
          ? <ul className="mt-1 list-disc pl-5 text-[13.5px] text-ink-2">{seen.map((c) => <li key={c}>{CHAPTERS[c]!.title}</li>)}</ul>
          : <p className="mt-1 text-[13px] text-ink-3">None yet.</p>}
      </div>
    </Section>
  )
}
