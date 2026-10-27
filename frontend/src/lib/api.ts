/** Thin fetch wrapper: JSON by default, CSRF double-submit header, uniform errors. */

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function csrfToken(): string | null {
  const names = ["__Host-nis2_csrf", "nis2_csrf"]
  for (const part of document.cookie.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (names.includes(k)) return decodeURIComponent(v.join("="))
  }
  return null
}

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>

export function qs(params?: Query): string {
  if (!params) return ""
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json"
  if (!["GET", "HEAD"].includes(method)) {
    const t = csrfToken()
    if (t) headers["X-CSRF-Token"] = t
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    ...init,
  })
  if (res.status === 401 && !path.startsWith("/auth/")) {
    onUnauthorized?.()
  }
  if (!res.ok) {
    let detail: unknown = null
    let message = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      detail = data
      if (typeof data?.detail === "string") message = data.detail
      if (Array.isArray(data?.errors) && data.errors.length) {
        message = data.errors.map((e: { loc?: string[]; msg: string }) => `${(e.loc ?? []).slice(-1)[0] ?? ""}: ${e.msg}`).join("; ")
      }
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message, detail)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get("content-type") ?? ""
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>("GET", path + qs(params)),
  post: <T>(path: string, body?: unknown, params?: Query) => request<T>("POST", path + qs(params), body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, params?: Query) => request<T>("DELETE", path + qs(params)),
  upload: <T>(path: string, form: FormData, params?: Query) => request<T>("POST", path + qs(params), form),
}

/** Download a file from the API (keeps cookies, respects Content-Disposition filename). */
export async function download(path: string, fallbackName = "download") {
  const res = await fetch(`/api${path}`, { credentials: "same-origin" })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  const blob = await res.blob()
  const cd = res.headers.get("content-disposition") ?? ""
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd)
  const name = m ? decodeURIComponent(m[1] ?? m[2]) : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Stream server-sent events from a POST endpoint (used by the AI chat). */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-CSRF-Token": csrfToken() ?? "" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `${res.status}`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = "message"
      const dataLines: string[] = []
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length) {
        try {
          onEvent(event, JSON.parse(dataLines.join("\n")))
        } catch {
          onEvent(event, dataLines.join("\n"))
        }
      }
    }
  }
}
