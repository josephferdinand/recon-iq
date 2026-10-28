import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("notification center layout", () => {
  it("keeps long notification content readable inside the viewport-bounded popover", async () => {
    const source = await readFile("src/components/notification-center.tsx", "utf8");

    expect(source).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(source).toContain("w-[min(28rem,calc(100dvw-1rem))]");
    expect(source).toContain("max-w-[calc(100dvw-1rem)]");
    expect(source).toContain("sideOffset={8}");
    expect(source).toContain("collisionPadding={8}");
    expect(source).toContain(
      "max-h-[min(24rem,calc(var(--radix-popover-content-available-height)_-_3.25rem))]",
    );
    expect(source).toContain('aria-label="Notifications"');
    expect(source).toContain('aria-label="Notification history"');
    expect(source).toContain('role="region"');
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain("overflow-x-hidden overflow-y-auto overscroll-contain");
    expect(source).not.toContain("import { ScrollArea }");
    expect(source).toContain("whitespace-normal break-words");
    expect(source).toContain("whitespace-pre-wrap break-words");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).not.toContain('className="truncate font-medium"');
    expect(source).not.toContain("line-clamp-2");
  });
});
