import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const assessment = (ctx: TourContext) => (ctx.firstAssessmentId ? `/assessments/${ctx.firstAssessmentId}` : null)

export const answer: TourChapter = {
  id: "answer",
  title: "Answer your questions",
  gate: CHAPTER_GATES.answer,
  steps: [
    { name: "my-work", route: "/my-work", title: "Find your questions",
      body: "Under Assessment questions in My work you find every requirement waiting for your answer. A row opens the requirement inside its assessment." },
    { name: "list", route: assessment, title: "Pick a requirement",
      body: "The assessment lists its requirements by chapter. Select one to answer it on the right." },
    { name: "scope", route: assessment, title: "Check the scope first",
      body: "Scope says whether the requirement applies to your entity. Choose Central at HQ when headquarters covers it for you." },
    { name: "ratings", route: assessment, title: "Rate the requirement",
      body: "Set Implemented, Documented and Effectiveness; the score follows from your choices. The keys 1 to 4 set Implemented quickly." },
    { name: "evidence", route: assessment, title: "Upload your evidence",
      body: "Open Evidence to upload a document or link one that already exists. Evidence is what makes your answer provable." },
    { name: "comments", route: assessment, title: "Discuss in comments",
      body: "Use Comments to ask a question or explain your answer. Colleagues and reviewers see them next to the requirement." },
    { name: "review", route: assessment, title: "Draft or reviewed",
      body: "An answer stays a draft until a second person checks it. Switch on Reviewed once that check is done." },
  ],
}
