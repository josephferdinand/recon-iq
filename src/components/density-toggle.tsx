import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Rows3, Rows4, Rows2, Moon, Sun, Monitor, Eye, ZapOff, Sparkles } from "lucide-react";
import { useUiPreferences } from "@/hooks/use-ui-preferences";

const DENSITY_OPTIONS = [
  { id: "compact", label: "Compact", icon: Rows2, hint: "Maximum information density" },
  { id: "cozy", label: "Cozy", icon: Rows3, hint: "Balanced spacing" },
  { id: "comfortable", label: "Comfortable", icon: Rows4, hint: "Generous breathing room" },
] as const;

const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

export function DensityToggle() {
  const { prefs, update } = useUiPreferences();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-density", prefs.density);
    const resolved =
      prefs.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
        : prefs.theme;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.toggleAttribute("data-reduce-motion", prefs.reduce_motion);
    document.documentElement.toggleAttribute("data-high-contrast", prefs.high_contrast);
  }, [prefs.density, prefs.theme, prefs.reduce_motion, prefs.high_contrast]);

  const ActiveDensity = DENSITY_OPTIONS.find((d) => d.id === prefs.density)?.icon ?? Rows3;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Display preferences">
          <ActiveDensity className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-semibold">Density</DropdownMenuLabel>
        {DENSITY_OPTIONS.map((d) => (
          <DropdownMenuItem key={d.id} onClick={() => update({ density: d.id })} className="flex items-start gap-3">
            <d.icon className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {d.label}
                {prefs.density === d.id && <span className="text-primary text-[10px]">●</span>}
              </div>
              <div className="text-xs text-muted-foreground">{d.hint}</div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-semibold">Theme</DropdownMenuLabel>
        {THEME_OPTIONS.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => update({ theme: t.id })} className="flex items-center gap-3">
            <t.icon className="h-4 w-4 shrink-0" />
            <span className="text-sm">{t.label}</span>
            {prefs.theme === t.id && <span className="ml-auto text-primary text-[10px]">●</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-semibold">Accessibility</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => update({ reduce_motion: !prefs.reduce_motion })} className="flex items-center gap-3">
          <ZapOff className="h-4 w-4 shrink-0" />
          <span className="text-sm">Reduce motion</span>
          {prefs.reduce_motion && <span className="ml-auto text-primary text-[10px]">●</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => update({ high_contrast: !prefs.high_contrast })} className="flex items-center gap-3">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="text-sm">High contrast</span>
          {prefs.high_contrast && <span className="ml-auto text-primary text-[10px]">●</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => update({ keyboard_hints: !prefs.keyboard_hints })} className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="text-sm">Keyboard hints</span>
          {prefs.keyboard_hints && <span className="ml-auto text-primary text-[10px]">●</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
