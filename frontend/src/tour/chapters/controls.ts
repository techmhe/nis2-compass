import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const controls: TourChapter = {
  id: "controls",
  title: "Run controls and KPIs",
  gate: CHAPTER_GATES.controls,
  steps: [
    { name: "calendar", route: "/controls/calendar", title: "The controls calendar",
      body: "Calendar shows the recurring control activities per entity and when each is due. Open an occurrence to record its result." },
    { name: "evidence", route: "/controls/evidence", title: "Evidence for your controls",
      body: "Evidence lists the proof attached to your control activities. Use it when an auditor asks how you know a control ran." },
    { name: "advisories", route: "/controls/advisories", title: "Advisories from the outside",
      body: "Advisories lists security advisories that you assess for relevance. Record whether each one affects you and why." },
    { name: "vulnerabilities", route: "/controls/vulnerabilities", title: "Track vulnerabilities",
      body: "Vulnerabilities tracks known weaknesses, with their CVE IDs, until they are fixed. One you cannot fix needs an accepted exception or a justification." },
    { name: "kpis", route: "/controls/kpis", title: "Measure effectiveness with KPIs",
      body: "KPIs are the indicators used to evaluate whether your measures work. Enter values per period and watch the trend." },
  ],
}
