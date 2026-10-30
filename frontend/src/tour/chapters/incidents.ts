import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const incident = (ctx: TourContext) => (ctx.firstIncidentId ? `/incidents/${ctx.firstIncidentId}` : null)

export const incidents: TourChapter = {
  id: "incidents",
  title: "Handle incidents",
  gate: CHAPTER_GATES.incidents,
  steps: [
    { name: "list", route: "/incidents", title: "The incident list",
      body: "The list shows each incident with its severity, status and next reporting deadline. Filter to Significant only to focus on those with a reporting duty." },
    { name: "record", route: "/incidents", perm: "incidents.manage", title: "Record an incident",
      body: "Record incidents as soon as you know of them, including near misses. The time you became aware starts the reporting clock." },
    { name: "significance", route: incident, title: "Decide if it is significant",
      body: "Significance assessment helps you decide whether the incident must be reported. Only significant incidents trigger the reporting duty." },
    { name: "deadlines", route: incident, title: "The three reporting deadlines",
      body: "Reporting to authorities counts down the early warning (24 hours), the notification (72 hours) and the final report (one month). Mark each as submitted once you have sent it." },
    { name: "draft", route: incident, title: "Draft the report text",
      body: "Draft report prepares the texts for a stage from the incident record. Copy them into the authority's portal; nothing is sent from here." },
    { name: "timeline", route: incident, title: "Keep the timeline",
      body: "Timeline is the log of what happened and what was decided. Add entries as you go, so the final report writes itself." },
  ],
}
