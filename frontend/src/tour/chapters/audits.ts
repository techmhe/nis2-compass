import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const audits: TourChapter = {
  id: "audits",
  title: "Audits and reviews",
  gate: CHAPTER_GATES.audits,
  steps: [
    { name: "programme", route: "/audits/programme", title: "The audit programme",
      body: "Programme & audits holds the audit programmes and the audits within them. Each audit keeps its summary, conclusion and findings." },
    { name: "findings", route: "/audits/findings", title: "Findings from audits",
      body: "Findings lists what the audits found. A finding can create an action plan item and is closed with a note." },
    { name: "effectiveness-reviews", route: "/audits/effectiveness-reviews", title: "Effectiveness reviews",
      body: "Effectiveness reviews evaluate whether your measures work, as the Dutch Cbb requires. They draw on assessment coverage and open actions." },
    { name: "management-reviews", route: "/audits/management-reviews", title: "Management reviews",
      body: "Management reviews record the inputs and decisions of the periodic review by top management. Keep every review here as proof." },
  ],
}
