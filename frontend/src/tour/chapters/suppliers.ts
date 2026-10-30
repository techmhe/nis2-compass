import { CHAPTER_GATES } from "../recommend"
import type { TourChapter, TourContext } from "../types"

const supplier = (ctx: TourContext) => (ctx.firstSupplierId ? `/suppliers/${ctx.firstSupplierId}` : null)

export const suppliers: TourChapter = {
  id: "suppliers",
  title: "Supplier management",
  gate: CHAPTER_GATES.suppliers,
  steps: [
    { name: "register", route: "/suppliers", title: "The supplier register",
      body: "The register lists your direct suppliers and service providers with their tier. Filter by tier, access type, status or entity." },
    { name: "views", route: "/suppliers", title: "Contract clauses at a glance",
      body: "Switch between Register and Contract clauses to see which security clauses are missing per supplier. Fix those first." },
    { name: "add", route: "/suppliers", perm: "suppliers.manage", title: "Add a supplier",
      body: "Add supplier records a new provider. Its tier follows the access it has and the services that depend on it." },
    { name: "certificates", route: supplier, title: "Certificates and their expiry",
      body: "Certificates keeps the supplier's attestations, such as ISO/IEC 27001, with their validity. Expiring ones are flagged in the register." },
    { name: "assessments", route: supplier, title: "Assess the supplier",
      body: "Assessments records periodic reviews with a score and a rating. Critical suppliers are reviewed every year." },
  ],
}
