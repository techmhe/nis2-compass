import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

// The sidebar and header are on every page, so their steps stay on the page the previous step opened.
export const welcome: TourChapter = {
  id: "welcome",
  title: "Welcome",
  gate: CHAPTER_GATES.welcome,
  steps: [
    { name: "sidebar", route: "/", title: "Find your way around",
      body: "The sidebar groups the work into Overview, Assess, Govern, Implement, Knowledge and Operate. You only see the pages your roles can open." },
    { name: "dashboard", route: "/", title: "Your Dashboard",
      body: "Every login lands here, with the status of the programme at a glance. What you see depends on your roles." },
    { name: "my-work", route: "/my-work", title: "Everything assigned to you",
      body: "My work gathers your tasks, assessment questions, reviews and deadlines in one list. Start here when you wonder what to do next." },
    { name: "tasks", route: "/my-work", title: "Tasks",
      body: "Tasks is the board for the work behind findings, work packages and answers. Open it to plan, assign and track what has to be done." },
    { name: "approvals", route: "/my-work", title: "Approvals",
      body: "Approvals lists items that wait for someone to approve them. Items waiting for you also show up in My work." },
    { name: "assistant", route: "/my-work", perm: "ai.use", title: "Ask the Assistant",
      body: "The Assistant answers questions about your programme and the regulations, based on what you are allowed to see." },
    { name: "notifications", route: "/my-work", title: "Notifications",
      body: "The bell tells you about new assignments, due dates and approvals. Mark them as read when you are done." },
    { name: "account", route: "/my-work", title: "Your account",
      body: "The account menu opens Profile & security for your password and notification settings, and lets you switch the Theme between light and dark." },
    { name: "help", route: "/my-work", title: "Help and restarting the tour",
      body: "Help & scoring model in the account menu explains how answers are scored. Choose Take the tour there whenever you want to see this tour again." },
  ],
}
