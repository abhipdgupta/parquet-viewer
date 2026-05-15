import { Database, FileSpreadsheet, MoveRight } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, Navigate, Route, Routes } from "react-router-dom"

import { ThemeToggleButton } from "@/components/ThemeToggleButton"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getInitialTheme,
  type ThemeMode,
} from "@/lib/theme"
import { cn } from "@/lib/utils"
import { ParquetReaderPage } from "./pages/parquet-reader-page"

function HomePage() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-border/80 bg-card shadow-sm">
          <div className="grid gap-10 px-8 py-10 lg:grid-cols-[1.3fr_0.9fr] lg:px-12 lg:py-14">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                Browser-Only Data Viewer
              </div>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                  Inspect parquet files locally with DuckDB WASM and zero
                  backend.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  Upload a parquet file, validate its magic bytes, browse rows
                  with pagination, and run DuckDB SQL directly in the browser
                  memory space.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/parquet-reader"
                  className={cn(buttonVariants({ size: "lg" }), "gap-2 px-4")}
                >
                  Open Parquet Reader
                  <MoveRight className="size-4" />
                </Link>
                <p className="text-sm text-muted-foreground">
                  React, TypeScript, Tailwind, shadcn theming, DuckDB WASM
                </p>
              </div>
            </div>

            <div className="grid gap-4 rounded-[1.75rem] border border-border/70 bg-background/70 p-4 sm:grid-cols-2 lg:grid-cols-1">
              {[
                {
                  icon: FileSpreadsheet,
                  title: "Parquet-aware upload",
                  description:
                    "Surface file size, format notes, and byte-level parquet header checks before query execution.",
                },
                {
                  icon: Database,
                  title: "DuckDB SQL workspace",
                  description:
                    "Run browser-side DuckDB dialect SQL against the uploaded file without sending data anywhere.",
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className={cn(
                    "rounded-[1.25rem] border border-border/70 bg-card p-5 shadow-sm",
                    "transition-transform duration-200 hover:-translate-y-0.5",
                  )}
                >
                  <item.icon className="mb-4 size-5 text-primary" />
                  <h2 className="text-lg font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme())

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return (
    <>
      <ThemeToggleButton
        theme={theme}
        onToggle={() =>
          setTheme((currentTheme) =>
            currentTheme === "dark" ? "light" : "dark",
          )
        }
      />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/parquet-reader" element={<ParquetReaderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
