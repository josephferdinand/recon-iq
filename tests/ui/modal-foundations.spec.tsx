// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

afterEach(cleanup);

describe("shared modal foundations", () => {
  it("keeps dialog styling token-based, bounded on small viewports, and overrideable", async () => {
    function DialogHarness() {
      const [open, setOpen] = React.useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><button>Open run details</button></DialogTrigger>
          <DialogContent className="max-w-4xl overflow-hidden p-0">
            <DialogHeader><DialogTitle>Run details</DialogTitle></DialogHeader>
            <div>Run content</div>
            <DialogFooter><button>Close workflow</button></DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    render(<DialogHarness />);

    const content = screen.getByRole("dialog", { name: "Run details" });
    expect(content.className).toContain("bg-popover");
    expect(content.className).toContain("text-popover-foreground");
    expect(content.className).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(content.className).toContain("max-w-4xl");
    expect(content.className).toContain("overflow-hidden");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open run details" })));
  });

  it("retains the alert dialog's explicit cancel semantics and theme surface", () => {
    function AlertHarness() {
      const [open, setOpen] = React.useState(true);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Archive this pipeline?</AlertDialogTitle></AlertDialogHeader>
            <AlertDialogCancel>Keep pipeline</AlertDialogCancel>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    render(<AlertHarness />);
    const content = screen.getByRole("alertdialog", { name: "Archive this pipeline?" });
    expect(content.className).toContain("bg-popover");
    expect(content.className).toContain("border-t-2");
    fireEvent.click(screen.getByRole("button", { name: "Keep pipeline" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("preserves the sheet's right-edge navigation model and caller sizing overrides", () => {
    render(
      <Sheet open>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
          <SheetHeader><SheetTitle>Primary navigation</SheetTitle></SheetHeader>
          <nav>Navigation items</nav>
        </SheetContent>
      </Sheet>,
    );

    const content = screen.getByRole("dialog", { name: "Primary navigation" });
    expect(content.className).toContain("max-h-dvh");
    expect(content.className).toContain("bg-popover");
    expect(content.className).toContain("sm:max-w-2xl");
    expect(content.className).toContain("overflow-hidden");
  });
});
