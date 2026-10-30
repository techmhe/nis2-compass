import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const quality: TourChapter = {
  id: "quality",
  title: "Keep the data clean",
  gate: CHAPTER_GATES.quality,
  steps: [
    { name: "run", route: "/checks", title: "Run the quality checks",
      body: "Data quality checks assessments, action plan, project and documents for gaps and contradictions. Choose Run again after you fix something." },
    { name: "filter", route: "/checks", title: "Narrow it to one entity",
      body: "Pick an entity to see only its findings, plus the group-wide ones. Leave it on All entities for the whole picture." },
    { name: "rules", route: "/checks", title: "Checks by area",
      body: "Each check shows how many items fail, coloured by severity. Open one to jump to the place where you can fix it." },
    { name: "approvals", route: "/approvals", title: "Approval lists",
      body: "Waiting for me holds what you must decide, Requested by me what you asked others to approve. Four-eyes approvals cover documents, answers and risk acceptances." },
    { name: "queue", route: "/approvals", title: "Decide an approval",
      body: "Select a request to see the version it covers and to approve or reject it. Later changes to the object are flagged." },
  ],
}
