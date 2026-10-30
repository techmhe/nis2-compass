import { CHAPTER_GATES } from "../recommend"
import type { TourChapter } from "../types"

export const inventory: TourChapter = {
  id: "inventory",
  title: "Services and continuity",
  gate: CHAPTER_GATES.inventory,
  steps: [
    { name: "overview", route: "/inventory", title: "Overview of services",
      body: "Overview summarises your services, assets and continuity status. Use it to spot what lacks an owner, an analysis or a plan." },
    { name: "services", route: "/inventory/services", title: "Your services",
      body: "Services lists the services and processes your organisation depends on, with their criticality. Everything else in this area hangs off them." },
    { name: "assets", route: "/inventory/assets", title: "Assets behind the services",
      body: "Assets are the systems, data and facilities that run the services. Each has a type and a lifecycle." },
    { name: "dependencies", route: "/inventory/dependencies", title: "Dependencies",
      body: "Dependencies shows which services rely on which assets and suppliers. Check it to see what a failure would hit." },
    { name: "bia", route: "/inventory/bia", title: "Business impact analysis",
      body: "BIA sets how long a service may be down (RTO) and how much data you can lose (RPO). Approving it makes these the recovery targets of the services." },
    { name: "plans", route: "/inventory/plans", title: "Plans and exercises",
      body: "Plans and exercises holds the continuity plans and the log of exercises and restore tests. A plan that was never exercised is only a promise." },
  ],
}
