import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const assessment = (ctx: TourContext) => (ctx.firstAssessmentId ? `/assessments/${ctx.firstAssessmentId}` : null)

export const assess: TourChapter = {
  id: "assess",
  title: "Assess and record findings",
  gate: CHAPTER_GATES.assess,
  steps: [
    { name: "catalog", route: "/catalog", perm: "catalog.read", title: "The requirements catalogue",
      body: "Requirements lists every measure with its legal reference. Search by number or text and filter by chapter or binding country." },
    { name: "targets", route: "/catalog", perm: "catalog.read", title: "Chapters and their targets",
      body: "Chapters and targets shows the target score each chapter is measured against. The Dashboard compares your answers with it." },
    { name: "workspace", route: assessment, title: "The assessment workspace",
      body: "Work through an assessment chapter by chapter in this list. Filters and the search box narrow it to what is still open." },
    { name: "shortcuts", route: assessment, title: "Work faster with the keyboard",
      body: "J and K move between requirements and 1 to 4 set Implemented. Open Keyboard shortcuts for the full list." },
    { name: "finding", route: assessment, title: "Findings come from gaps",
      body: "When Work package required shows Yes, the requirement becomes a finding with its own ID. Choose Add to action plan to hand it on." },
    { name: "action-plan", route: "/action-plan", perm: "findings.read", title: "The action plan",
      body: "Action plan collects the remediation measures for all findings, with owner and target date. Unplanned findings waits for you to turn it into items." },
  ],
}
