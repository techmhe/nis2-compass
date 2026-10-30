import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const project = (suffix: string) => (ctx: TourContext) => (ctx.firstProjectId ? `/projects/${ctx.firstProjectId}${suffix}` : null)

export const projectChapter: TourChapter = {
  id: "project",
  title: "Run the project",
  gate: CHAPTER_GATES.project,
  steps: [
    { name: "tabs", route: project(""), title: "One project, several views",
      body: "The project has an Overview, the Master plan, a Gantt chart, Gates, RACI and RAID. Switch between them with these tabs." },
    { name: "plan", route: project("/plan"), title: "The master plan",
      body: "Master plan groups the activities by phase, with owner, dates and status. Open an activity to edit it." },
    { name: "gates", route: project("/gates"), title: "Gates are decision points",
      body: "A gate is ready when all activities assigned to it are completed. Management decides at each gate." },
    { name: "raci", route: project("/raci"), title: "Who does what",
      body: "RACI shows for each activity who is responsible, accountable, consulted and informed. Every activity needs exactly one accountable role." },
    { name: "work-packages", route: "/work-packages", perm: "workpackages.read", title: "Work packages",
      body: "Work packages bundle findings into measures. Switch between Table and Board to see them by status." },
    { name: "tasks", route: "/tasks", title: "The tasks board",
      body: "Tasks breaks the work down for individual people. Switch between Board and List, or limit it to Assigned to me." },
  ],
}
