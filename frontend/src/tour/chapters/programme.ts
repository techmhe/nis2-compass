import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const programme: TourChapter = {
  id: "programme",
  title: "Steer the programme",
  gate: CHAPTER_GATES.programme,
  steps: [
    { name: "matrix", route: "/", perm: "assessments.read", title: "The compliance matrix",
      body: "The Compliance matrix scores every entity per chapter against its target. Use it to see where the group stands." },
    { name: "gaps", route: "/", perm: "assessments.read", title: "Where the largest gaps are",
      body: "Largest gaps to target ranks the chapters furthest below their target. Start your remediation there." },
    { name: "reports", route: "/reports", perm: "assessments.read", title: "Reports for management",
      body: "Reports offers the Management report, the ISO 27001 applicability and the Evidence pack. Saved snapshots keep a report as it was." },
    { name: "legal", route: "/governance/legal", title: "Legal basis per jurisdiction",
      body: "Legal basis shows which law applies to each requirement in Germany, the Netherlands and the EU. Check it before you tell an authority what is binding." },
    { name: "registrations", route: "/governance/registrations", title: "Registrations with authorities",
      body: "Registrations keeps the data you reported to each authority. A change must be reported within two weeks." },
    { name: "management", route: "/governance/management", title: "The management body",
      body: "Management body lists the members and their decisions. Record decisions of the management body here too." },
    { name: "obligations", route: "/governance/obligations", title: "Obligations calendar",
      body: "Obligations lists the recurring duties with due dates. Overdue ones are highlighted above the tabs." },
    { name: "trainings", route: "/governance/trainings", title: "Trainings",
      body: "Trainings tracks who needs which training and whether it is current. The strip above the tabs shows how many members meet the training rule." },
  ],
}
