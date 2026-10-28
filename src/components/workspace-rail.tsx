import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { RailItem } from "@/components/left-rail";

export type WorkspaceRailPage = RailItem & {
  to?: string;
};

export type WorkspaceRailSection = {
  key: string;
  label: string;
  icon?: RailItem["icon"];
  pages: WorkspaceRailPage[];
};

export function WorkspaceRail({
  sections,
  activeKey,
  basePath,
}: {
  sections: WorkspaceRailSection[];
  activeKey: string;
  basePath: string;
}) {
  const idPrefix = useId().replace(/:/g, "");
  const visibleSections = useMemo(
    () => sections.filter((section) => section.pages.length > 0),
    [sections],
  );
  const activeSectionKey =
    visibleSections.find((section) => section.pages.some((page) => page.key === activeKey))?.key ??
    null;
  const activeSectionIsDirect = visibleSections.some(
    (section) => section.key === activeSectionKey && isDirectSection(section.key),
  );
  const [openSectionKey, setOpenSectionKey] = useState<string | null>(() =>
    activeSectionIsDirect ? null : activeSectionKey,
  );

  useEffect(() => {
    setOpenSectionKey(activeSectionIsDirect ? null : activeSectionKey);
  }, [activeKey, activeSectionIsDirect, activeSectionKey]);

  const pageSearch = (page: WorkspaceRailPage) => (previous: Record<string, unknown>) => {
    if (!page.to) return { ...previous, page: page.key };
    const next = { ...previous };
    delete next.page;
    return next;
  };

  return (
    <nav
      aria-label="Workspace navigation"
      className="min-w-0 space-y-1 overflow-x-hidden px-3 pb-4"
    >
      {visibleSections.map((section) => {
        const defaultPage = section.pages[0];
        const SectionIcon = section.icon ?? defaultPage.icon;
        const sectionIsActive = section.key === activeSectionKey;

        if (isDirectSection(section.key)) {
          const isDefaultPageActive = defaultPage.key === activeKey;
          return (
            <Link
              key={section.key}
              to={defaultPage.to ?? basePath}
              search={pageSearch(defaultPage)}
              aria-current={isDefaultPageActive ? "page" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]",
                sectionIsActive
                  ? "bg-[var(--brand-gold)] text-[#0e1a30]"
                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
              style={
                sectionIsActive
                  ? { backgroundColor: "var(--brand-gold)", color: "#0e1a30" }
                  : undefined
              }
            >
              {SectionIcon ? <SectionIcon className="h-4 w-4 shrink-0" /> : null}
              <span className="truncate">{section.label}</span>
            </Link>
          );
        }

        const isOpen = openSectionKey === section.key;
        const contentId = `workspace-rail-${idPrefix}-${section.key
          .replace(/[^a-z0-9_-]+/gi, "-")
          .toLowerCase()}`;

        return (
          <div
            key={section.key}
            className={cn(
              "min-w-0 rounded-md border-l-2 border-transparent",
              sectionIsActive && "bg-sidebar-accent",
            )}
            style={
              sectionIsActive
                ? {
                    borderLeftColor: "var(--brand-gold)",
                    color: "var(--brand-gold)",
                  }
                : undefined
            }
          >
            <div
              className={cn(
                "flex min-w-0 items-stretch rounded-r-md",
              )}
            >
              <Link
                to={defaultPage.to ?? basePath}
                search={pageSearch(defaultPage)}
                onClick={() => setOpenSectionKey(section.key)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-gold)]",
                  sectionIsActive
                    ? "text-[color:var(--brand-gold)]"
                    : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                {SectionIcon ? <SectionIcon className="h-4 w-4 shrink-0" /> : null}
                <span className="truncate">{section.label}</span>
              </Link>
              <button
                type="button"
                aria-label={`Toggle ${section.label}`}
                aria-expanded={isOpen}
                aria-controls={contentId}
                onClick={() =>
                  setOpenSectionKey((current) => (current === section.key ? null : section.key))
                }
                className={cn(
                  "grid w-9 shrink-0 place-items-center rounded-r-md transition-colors",
                  "hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-gold)]",
                )}
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-90")}
                />
              </button>
            </div>

            <div id={contentId} hidden={!isOpen} className="mt-1 space-y-0.5 pl-5 pb-1">
              {section.pages.map((page) => {
                const PageIcon = page.icon;
                const isActive = page.key === activeKey;
                return (
                  <Link
                    key={page.key}
                    to={page.to ?? basePath}
                    search={pageSearch(page)}
                    aria-current={isActive ? "page" : undefined}
                    tabIndex={isOpen ? undefined : -1}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]",
                      isActive
                        ? "bg-[var(--brand-gold)] font-medium text-[#0e1a30]"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                    style={
                      isActive
                        ? { backgroundColor: "var(--brand-gold)", color: "#0e1a30" }
                        : undefined
                    }
                  >
                    {PageIcon ? <PageIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                    <span className="truncate">{page.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function isDirectSection(key: string) {
  const normalized = key.toLowerCase();
  return normalized === "home" || normalized === "dashboard";
}
