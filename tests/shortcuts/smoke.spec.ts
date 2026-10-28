// C4 — Keyboard shortcuts hook smoke tests.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

function fireKey(opts: { key: string; shift?: boolean; target?: EventTarget }) {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) Object.defineProperty(ev, "target", { value: opts.target });
  window.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardShortcuts", () => {
  it("registers and unregisters", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ combo: "j", description: "next", handler }]),
    );
    fireKey({ key: "j" });
    expect(handler).toHaveBeenCalledTimes(1);
    unmount();
    fireKey({ key: "j" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when focus is in an input", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ combo: "a", description: "accept", handler }]),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "a", target: input });
    expect(handler).not.toHaveBeenCalled();
  });

  it("respects allowInInput override", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { combo: "esc", description: "close", allowInInput: true, handler },
      ]),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "Escape", target: input });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
