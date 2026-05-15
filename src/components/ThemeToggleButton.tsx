import { MoonStar, SunMedium } from "lucide-react"

import { Button } from "@/components/ui/button"
import { type ThemeMode } from "@/lib/theme"

export function ThemeToggleButton({
  theme,
  onToggle,
}: {
  theme: ThemeMode
  onToggle: () => void
}) {
  const nextTheme = theme === "dark" ? "light" : "dark"

  return (
    <div className="fixed top-4 right-4 z-50">
      <Button
        variant="outline"
        size="sm"
        onClick={onToggle}
        aria-label={`Switch to ${nextTheme} mode`}
        className="h-10 rounded-full border-border bg-background px-3 shadow-sm"
      >
        {theme === "dark" ? (
          <SunMedium className="size-4" />
        ) : (
          <MoonStar className="size-4" />
        )}
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </Button>
    </div>
  )
}
