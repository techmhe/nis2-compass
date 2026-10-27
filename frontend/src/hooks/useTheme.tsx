import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type Theme = "light" | "dark" | "system"
const Ctx = createContext<{ theme: Theme; resolved: "light" | "dark"; setTheme: (t: Theme) => void } | null>(null)

function systemDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("nis2-theme") as Theme) || "system"
    } catch {
      return "system"
    }
  })
  const [resolved, setResolved] = useState<"light" | "dark">(theme === "system" ? (systemDark() ? "dark" : "light") : theme)

  useEffect(() => {
    const apply = () => {
      const r = theme === "system" ? (systemDark() ? "dark" : "light") : theme
      setResolved(r)
      document.documentElement.classList.toggle("dark", r === "dark")
    }
    apply()
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
    mq?.addEventListener("change", apply)
    return () => mq?.removeEventListener("change", apply)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem("nis2-theme", t)
    } catch {
      /* private mode */
    }
  }
  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useTheme outside ThemeProvider")
  return v
}
