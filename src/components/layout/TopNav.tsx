import { SensitiveToggle } from "@/src/components/ui/SensitiveToggle";
import { ThemeToggle } from "@/src/components/ui/ThemeToggle";

export function TopNav() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Numo App";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">{appName}</span>
      </div>
      <div className="flex items-center gap-1">
        <SensitiveToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
