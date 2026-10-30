import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const documents: TourChapter = {
  id: "documents",
  title: "Documents and regulations",
  gate: CHAPTER_GATES.documents,
  steps: [
    { name: "search", route: "/documents", title: "Find a document",
      body: "Search looks through titles and the text inside documents. Narrow the list with the type, status, entity and tag filters." },
    { name: "review", route: "/documents", title: "Keep documents reviewed",
      body: "Each document has a review cycle. Switch on Review overdue to list the documents whose review date has passed." },
    { name: "upload", route: "/documents", perm: "documents.upload", title: "Upload a document",
      body: "Upload document adds a policy, procedure or piece of evidence. You can link it to requirements, answers and tasks afterwards." },
    { name: "regulations", route: "/regulations", perm: "regulations.read", title: "The regulations library",
      body: "Regulations holds the legal texts behind the requirements: NIS-2, the German and Dutch laws and related standards. Open one to see which requirements it is linked to." },
  ],
}
