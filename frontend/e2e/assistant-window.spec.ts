import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures"
import { signInFresh } from "./tour-users"
import { authFile } from "./users"

// The floating assistant window. The AI is mocked: /ai/status says ready, /ai/chat answers with a server-sent
// event stream in the format lib/api.ts parses, and the conversations live in memory so a reload can load them.
interface Conv { id: number; title: string; messages: { id?: number; role: "user" | "assistant"; content: string; sources?: unknown[] }[] }

const STATUS = { ready: true, enabled: true, chat_model: "e2e-model", embedding_model: null, semantic_search: false, index: { chunks: 0, embedded: 0 } }
const answerTo = (q: string) => `Answer to: ${q}`
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

async function mockAssistant(page: Page, opts: { hold?: Promise<void>; seed?: Conv[] } = {}) {
  const convs = new Map<number, Conv>((opts.seed ?? []).map((c) => [c.id, c]))
  const chats: { content: string; conversation_id: number | null }[] = []
  let nextId = 9001
  await page.route("**/api/ai/status", (route) => json(route, STATUS))
  await page.route(/\/api\/ai\/conversations(\/\d+)?$/, (route) => {
    const id = /\/(\d+)$/.exec(route.request().url())?.[1]
    if (route.request().method() !== "GET") return route.fallback()
    if (!id) return json(route, [...convs.values()].map((c) => ({ id: c.id, title: c.title, updated_at: new Date().toISOString(), context: null })))
    const c = convs.get(Number(id))
    return c ? json(route, c) : json(route, { detail: "Not found" }, 404)
  })
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON()
    chats.push({ content: body.content, conversation_id: body.conversation_id })
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
const widthOf = async (page: Page) => Math.round((await win(page).boundingBox())!.width)

async function ask(page: Page, question: string) {
  await box(page).fill(question)
  await box(page).press("Enter")
}

test.describe("as security officer", () => {
  test.use({ storageState: authFile("isb") })

  test("the launcher is there, and the sidebar and top bar have no Assistant entry", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await expect(launcher(page)).toBeVisible()
    await expect(launcher(page)).toHaveAttribute("data-tour", "welcome.assistant")
    await expect(page.getByRole("link", { name: "Assistant", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Assistant", exact: true })).toHaveCount(0)
  })

  test("the launcher opens the compact window with the input focused", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await launcher(page).click()
    await expect(win(page)).toBeVisible()
    await expect(launcher(page)).toHaveCount(0)
    await expect(box(page)).toBeFocused()
    const b = (await win(page).boundingBox())!
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([400, 560])
  })

  test("Expand and Shrink change the width", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await launcher(page).click()
    await page.getByRole("button", { name: "Expand assistant" }).click()
    await expect.poll(() => widthOf(page)).toBe(760)
    await page.getByRole("button", { name: "Shrink assistant" }).click()
    await expect.poll(() => widthOf(page)).toBe(400)
  })

  test("Esc closes the window and the launcher has the focus", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await launcher(page).click()
    await expect(box(page)).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(win(page)).toHaveCount(0)
    await expect(launcher(page)).toBeFocused()
  })

  test("a question and its answer survive a navigation and a reload", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await launcher(page).click()
    await ask(page, "What is NIS-2?")
    await expect(win(page).getByText(answerTo("What is NIS-2?"))).toBeVisible()
    await page.getByRole("link", { name: "My work" }).click()
    await expect(page).toHaveURL(/\/my-work$/)
    await expect(win(page).getByText(answerTo("What is NIS-2?"))).toBeVisible()
    await page.reload()
    await expect(win(page).getByText(answerTo("What is NIS-2?"))).toBeVisible()
    await expect(win(page).getByText("What is NIS-2?", { exact: true })).toBeVisible()
  })

  test("a slow reply keeps streaming while the user navigates", async ({ page }) => {
    let release!: () => void
    const hold = new Promise<void>((r) => { release = r })
    const { chats } = await mockAssistant(page, { hold })
    await page.goto("/")
    await launcher(page).click()
    await ask(page, "Slow question")
    await expect(win(page).getByRole("button", { name: "Stop" })).toBeVisible()
    await page.getByRole("link", { name: "My work" }).click()
    await expect(page).toHaveURL(/\/my-work$/)
    await expect(win(page).getByRole("button", { name: "Stop" })).toBeVisible()
    release()
    await expect(win(page).getByText(answerTo("Slow question"))).toBeVisible()
    await expect(win(page).getByRole("button", { name: "Send" })).toBeVisible()
    expect(chats).toHaveLength(1)
  })

  test("a stored conversation that no longer exists opens empty", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("nis2-assistant")) sessionStorage.setItem("nis2-assistant", JSON.stringify({ open: true, expanded: false, conversationId: 777 }))
    })
    await page.goto("/")
    await expect(win(page)).toBeVisible()
    await expect(win(page).getByRole("heading", { name: "Ask about your NIS-2 programme" })).toBeVisible()
    await expect(box(page)).toBeEnabled()
    await expect(page.getByText("This page could not be displayed")).toHaveCount(0)
    // the stale id is dropped from the stored state, and the next question starts a new conversation
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("nis2-assistant") ?? "{}").conversationId)).toBeNull()
    await ask(page, "Fresh question")
    await expect(win(page).getByText(answerTo("Fresh question"))).toBeVisible()
    expect(chats).toEqual([{ content: "Fresh question", conversation_id: null }])
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
  })

  test("New conversation keeps the typed draft", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/")
    await launcher(page).click()
    await ask(page, "First question")
    await expect(win(page).getByText(answerTo("First question"))).toBeVisible()
    await box(page).fill("My draft")
    await win(page).getByRole("button", { name: "New conversation" }).click()
    await expect(win(page).getByText(answerTo("First question"))).toHaveCount(0)
    await expect(box(page)).toHaveValue("My draft")
  })

  test("New conversation clears a failed first message", async ({ page }) => {
    await mockAssistant(page)
    await page.route("**/api/ai/chat", (route) => json(route, { detail: "Assistant e2e failure" }, 502))
    await page.goto("/")
    await launcher(page).click()
    await ask(page, "Failed question")
    await expect(win(page).getByText("Failed question", { exact: true })).toBeVisible()
    await expect(win(page).getByRole("button", { name: "Send" })).toBeVisible()
    await box(page).fill("My draft")
    await win(page).getByRole("button", { name: "New conversation" }).click()
    await expect(win(page).getByText("Failed question", { exact: true })).toHaveCount(0)
    await expect(box(page)).toHaveValue("My draft")
  })

  test("/assistant?q=hello ends on the Dashboard with the window expanded and one request", async ({ page }) => {
    const { chats } = await mockAssistant(page)
    await page.goto("/assistant?q=hello")
    await expect(page).toHaveURL(/\/$/)
    await expect(win(page).getByText(answerTo("hello"))).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
    expect(chats).toEqual([{ content: "hello", conversation_id: null }])
  })

  test("/assistant/<id> shows that conversation", async ({ page }) => {
    await mockAssistant(page, { seed: [{ id: 4242, title: "Old chat", messages: [{ role: "user", content: "Earlier question" }, { id: 1, role: "assistant", content: "Earlier answer", sources: [] }] }] })
    await page.goto("/assistant/4242")
    await expect(page).toHaveURL(/\/$/)
    await expect(win(page).getByText("Earlier answer")).toBeVisible()
    await expect(win(page).getByText("Earlier question", { exact: true })).toBeVisible()
  })

  test("/assistant opens the window expanded on the Dashboard", async ({ page }) => {
    await mockAssistant(page)
    await page.goto("/assistant")
    await expect(page).toHaveURL(/\/$/)
    await expect(win(page)).toBeVisible()
    await expect.poll(() => widthOf(page)).toBe(760)
  })
})

test.describe("without ai.use", () => {
  test("a user without the permission has no launcher", async ({ page }) => {
    await signInFresh(page, { permissions: ["entities.read", "assessments.read"] })
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible()
    await expect(launcher(page)).toHaveCount(0)
    await expect(win(page)).toHaveCount(0)
  })
})
