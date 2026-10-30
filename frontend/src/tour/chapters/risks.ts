import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const risk = (ctx: TourContext) => (ctx.firstRiskId ? `/risks/${ctx.firstRiskId}` : null)

export const risks: TourChapter = {
  id: "risks",
  title: "Manage risks",
  gate: CHAPTER_GATES.risks,
  steps: [
    { name: "register", route: "/risks", title: "The risk register",
      body: "The register lists every risk with its owner, ratings, treatment and next review. Filter by entity, status or treatment, or switch on My risks." },
    { name: "heat-map", route: "/risks", title: "See risks on the heat map",
      body: "The Heat map places risks by likelihood and impact, as Inherent or Residual rating. Click a cell to filter the register to it." },
    { name: "method", route: "/risks", title: "Rate with the risk method",
      body: "Risk method defines the scales, the levels and the appetite that ratings are measured against. Each entity can use its own method." },
    { name: "new", route: "/risks", perm: "risks.manage", title: "Record a new risk",
      body: "New risk opens the form for the scenario, owner and entity. Risks can also be created from gaps found in an assessment." },
    { name: "assessment", route: risk, title: "Rate inherent and residual risk",
      body: "Inherent risk ignores your controls, residual risk includes them. A residual risk above the appetite needs a decision of the management body." },
    { name: "treatment", route: risk, title: "Plan the treatment",
      body: "Treatment plan records whether you reduce, avoid, transfer or accept the risk. Link the measures that carry it out." },
    { name: "links", route: risk, title: "Link gaps and affected objects",
      body: "Gaps and affected objects connect the risk to requirements that are not met and to the services or assets it touches. This keeps the risk and the assessment in step." },
  ],
}
