"use client";
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [{ v: "light", Icon: Sun, label: "Light" }, { v: "system", Icon: Monitor, label: "System" }, { v: "dark", Icon: Moon, label: "Dark" }] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(() => () => {}, () => true, () => false); // false on the server, true in the browser
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex rounded-xl bg-muted p-1", className)}>
      {OPTIONS.map(({ v, Icon, label }) => (
        <button key={v} type="button" role="radio" aria-checked={mounted && theme === v} aria-label={label} onClick={() => setTheme(v)}
          className={cn("pressable flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring md:size-8", mounted && theme === v && "bg-card text-foreground shadow-sm")}>
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
