import type { Page, Route } from "@playwright/test"
import { expect, expectPageOk, test } from "./fixtures"
import { authFile } from "./users"

// The asking buttons (answer panel, requirement page, provision details, Cmd/Ctrl+K) open the floating assistant
// window instead of navigating. The AI is mocked like in assistant-window.spec.ts: /ai/status, /ai/chat as a
// server-sent event stream and the conversations in memory.
interface Conv { id: number; title: string; messages: { id?: number; role: "user" | "assistant"; content: string; sources?: unknown[] }[] }
interface ChatBody { content: string; conversation_id: number | null; context?: { type: string; id: number; label: string } }

const STATUS = { ready: true, enabled: true, chat_model: "e2e-model", embedding_model: null, semantic_search: false, index: { chunks: 0, embedded: 0 } }
const answerTo = (q: string) => `Answer to: ${q}`
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

async function mockAssistant(page: Page, opts: { hold?: Promise<void>; holdStatus?: Promise<void>; ready?: boolean } = {}) {
  const convs = new Map<number, Conv>()
  const chats: ChatBody[] = []
  let nextId = 9001
  await page.route("**/api/ai/status", async (route) => {
    await opts.holdStatus
    return json(route, { ...STATUS, ready: opts.ready ?? true })
  })
  await page.route(/\/api\/ai\/conversations(\/\d+)?$/, (route) => {
    const id = /\/(\d+)$/.exec(route.request().url())?.[1]
    if (route.request().method() !== "GET") return route.fallback()
    if (!id) return json(route, [...convs.values()].map((c) => ({ id: c.id, title: c.title, updated_at: new Date().toISOString(), context: null })))
    const c = convs.get(Number(id))
    return c ? json(route, c) : json(route, { detail: "Not found" }, 404)
  })
  await page.route("**/api/ai/chat", async (route) => {
    const body: ChatBody = route.request().postDataJSON()
    chats.push({ content: body.content, conversation_id: body.conversation_id, context: body.context })
    const id: number = body.conversation_id ?? nextId++
    const conv = convs.get(id) ?? { id, title: body.content, messages: [] }
    conv.messages.push({ role: "user", content: body.content }, { id: id * 10, role: "assistant", content: answerTo(body.content), sources: [] })
    convs.set(id, conv)
    await opts.hold
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse("meta", { conversation_id: id }) + sse("sources", { sources: [] }) + sse("delta", { text: answerTo(body.content) }) + sse("saved", { message_id: id * 10 }),
    })
  })
  return { chats }
}

const launcher = (page: Page) => page.getByRole("button", { name: "Open assistant" })
const win = (page: Page) => page.getByRole("dialog", { name: "Assistant", exact: true })
const box = (page: Page) => win(page).getByRole("textbox", { name: "Message to the assistant" })
// a CSS locator, so a modal dialog that hides the page from role queries cannot make a count pass by accident
const windowEl = (page: Page) => page.locator("[data-assistant-window]")
const widthOf = async (page: Page) => Math.round((await win(page).boundingBox())!.width)
const defer = () => {
  let release!: () => void
  const promise = new Promise<void>((r) => { release = r })
  return { promise, release }
}
const REQUIREMENT_QUESTION = /^Did we already answer requirement \S+ for other entities, and which documents cover it\?$/

async function openFirstRequirement(page: Page) {
  await page.goto("/assessments")
  await page.locator('a[href^="/assessments/"]').first().click()
  await expectPageOk(page)
  await page.getByRole("region", { name: "Requirements" }).getByRole("button").first().click()
  await expect(page.getByRole("button", { name: /^Legal references \(\d+\)/ })).toBeVisible()
}

// The window can cover the button once it is open, so a button that is clicked while the window is up is clicked
// by event, which is what the user's keyboard activation does as well.
const askButton = (page: Page) => page.getByRole("button", { name: "Ask assistant", exact: true })

test.describe("as security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("Ask assistant in the answer panel opens the expanded window with the context, sends once and keeps the URL", async ({ page }) => {
    const gate = defer()
    const { chats } = await mockAssistant(page, { holdStatus: gate.promise })
    await openFirstRequirement(page)
    const url = page.url()
    await askButton(page).click()
    await expect(win(page)).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
    // the AI status is still pending, so the window is empty and shows what the question is about
    await expect(win(page).getByText(/^Context: \S+ /)).toBeVisible()
    gate.release()
    await expect(win(page).getByText(REQUIREMENT_QUESTION)).toBeVisible()
    await expect(win(page).getByText(/^Answer to: Did we already answer requirement/)).toBeVisible()
    expect(page.url()).toBe(url)
    expect(chats).toHaveLength(1)
    expect(chats[0].conversation_id).toBeNull()
    expect(chats[0].context).toMatchObject({ type: "requirement", label: expect.stringMatching(/^\S+ \S/) })
    expect(typeof chats[0].context?.id).toBe("number")
  })

  test("a double click on Ask assistant makes one request", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await openFirstRequirement(page)
    const button = askButton(page)
    await button.dispatchEvent("click")
    await button.dispatchEvent("click")
    await expect(win(page).getByText(/^Answer to: Did we already answer requirement/)).toBeVisible()
    await expect(win(page).getByRole("button", { name: "Send" })).toBeVisible()
    expect(chats).toHaveLength(1)
    // the second click must not leave the streamed question behind in the input
    await expect(box(page)).toHaveValue("")
  })

  test("Ask assistant on the requirement page opens the window and sends once", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await page.goto("/catalog")
    await page.locator('a[href^="/catalog/"]').first().click()
    await expect(page).toHaveURL(/\/catalog\/\d+$/)
    const url = page.url()
    await askButton(page).click()
    await expect(win(page)).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
    await expect(win(page).getByText(/^Answer to: Did we already answer requirement/)).toBeVisible()
    expect(page.url()).toBe(url)
    expect(chats).toHaveLength(1)
    expect(chats[0].context?.type).toBe("requirement")
  })

  test("Ask the assistant in the provision details opens the window and sends once", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await page.goto("/regulations")
    await page.locator("article").filter({ hasText: /[1-9]\d* linked requirements/ }).first().getByRole("link", { name: "Open" }).click()
    await page.getByRole("button").filter({ hasText: /\d+ links/ }).first().click()
    await page.getByRole("button", { name: /^\d+ linked requirements? for / }).first().click()
    const url = page.url()
    await page.getByRole("button", { name: "Ask the assistant" }).click()
    await expect(win(page)).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
    await expect(win(page).getByText(/^Answer to: Explain .+ and what it requires from us\.$/)).toBeVisible()
    expect(page.url()).toBe(url)
    expect(chats).toHaveLength(1)
    expect(chats[0].context?.type).toBe("provision")
  })

  test("Cmd/Ctrl+K and Ask sends the typed question in the expanded window", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await page.goto("/")
    // the shortcut listener lives in the app shell, which mounts after the session check; a key pressed before is lost
    await expect(launcher(page)).toBeVisible()
    await page.keyboard.press("ControlOrMeta+K")
    await page.getByPlaceholder(/^Search documents/).fill("backup policy")
    await page.getByRole("option", { name: /Ask: .backup policy./ }).click()
    await expect(win(page)).toBeVisible()
    await expect(win(page).getByText(answerTo("backup policy"))).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
    await expect(page).toHaveURL(/\/$/)
    expect(chats).toEqual([{ content: "backup policy", conversation_id: null, context: undefined }])
  })

  test("while a reply streams, Ask assistant puts the question in the input unsent, without a new conversation or pill", async ({ page }) => {
    const gate = defer()
    const { chats } = await mockAssistant(page, { hold: gate.promise })
    await openFirstRequirement(page)
    await launcher(page).click()
    await box(page).fill("Slow question")
    await box(page).press("Enter")
    await expect(win(page).getByRole("button", { name: "Stop" })).toBeVisible()
    await askButton(page).dispatchEvent("click")
    await expect(box(page)).toHaveValue(REQUIREMENT_QUESTION)
    await expect(win(page).getByText(/^Context: /)).toHaveCount(0)
    await expect(win(page).getByText("Slow question", { exact: true })).toBeVisible()
    gate.release()
    await expect(win(page).getByText(answerTo("Slow question"))).toBeVisible()
    await expect(win(page).getByRole("button", { name: "Send" })).toBeVisible()
    expect(chats).toHaveLength(1)
    expect(chats[0].content).toBe("Slow question")
    await expect(box(page)).toHaveValue(REQUIREMENT_QUESTION)
  })

  test("when the assistant is not configured, the question waits in the input unsent", async ({ page }) => {
    const { chats } = await mockAssistant(page, { ready: false })
    await openFirstRequirement(page)
    await askButton(page).click()
    await expect(win(page)).toBeVisible()
    await expect(win(page).getByText("The assistant is not set up yet.")).toBeVisible()
    await expect(box(page)).toHaveValue(REQUIREMENT_QUESTION)
    expect(chats).toHaveLength(0)
  })

  test("AI suggestion does not open the assistant window", async ({ page }) => {
    await mockAssistant(page)
    await page.route("**/api/ai/assist/answer/*", (route) => json(route, { gap_description: "A gap.", recommended_action: "An action.", effort: null }))
    await openFirstRequirement(page)
    await page.getByRole("button", { name: /AI suggestion/ }).click()
    const dialog = page.getByRole("dialog", { name: /^AI suggestion for / })
    await expect(dialog).toBeVisible()
    // the modal dialog hides the rest of the page from role queries, so it is closed before the checks
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(launcher(page)).toBeVisible()
    await expect(windowEl(page)).toHaveCount(0)
  })

  test("writing help does not open the assistant window", async ({ page }) => {
    await mockAssistant(page)
    await page.route("**/api/ai/assist/text", (route) => json(route, { text: "Evidence: reviewed in March.", model: "e2e" }))
    await openFirstRequirement(page)
    await page.locator("#f-evidence").fill("some text")
    await page.locator("#f-evidence").locator("..").getByRole("button", { name: "Writing help" }).click()
    const response = page.waitForResponse("**/api/ai/assist/text")
    await page.getByRole("menuitem", { name: "Proofread" }).click()
    await response
    const dialog = page.getByRole("dialog", { name: "Proofread" })
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(launcher(page)).toBeVisible()
    await expect(windowEl(page)).toHaveCount(0)
  })
})

test.describe("as Dutch contributor", () => {
  test.use({ storageState: authFile("nl") })

  test("Ask assistant on their own answer opens the window with the context", async ({ page }) => {
    const gate = defer()
    const { chats } = await mockAssistant(page, { holdStatus: gate.promise })
    await openFirstRequirement(page)
    await askButton(page).click()
    await expect(win(page)).toBeVisible()
    await expect(win(page).getByText(/^Context: \S+ /)).toBeVisible()
    gate.release()
    await expect(win(page).getByText(/^Answer to: Did we already answer requirement/)).toBeVisible()
    expect(chats).toHaveLength(1)
    expect(chats[0].context?.type).toBe("requirement")
  })
})
