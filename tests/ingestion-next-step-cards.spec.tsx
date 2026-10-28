// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Workflow } from "lucide-react";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to: _to, params, search, ...props }: any) => {
    const href = `/${params.slug}/workspace?page=${search.page}`;
    return <a {...props} href={href} onClick={(event) => { event.preventDefault(); navigate(href); }} />;
  },
}));

import { NextStepCard } from "@/components/ingestion-hub";

afterEach(() => { cleanup(); navigate.mockClear(); });

describe("ingestion next-step cards", () => {
  it.each([
    ["Shape with Data Prep", "prep"],
    ["Extract with AIDP", "aidp"],
    ["Run a rekon", "recons"],
  ])("makes the complete %s card an accessible link with visible hover/focus treatment", (title, page) => {
    render(<NextStepCard icon={Workflow} title={title} description="Next step details" page={page} slug="qa-tenant" />);
    const card = screen.getByRole("link", { name: `Open ${title}` });
    expect(card.getAttribute("href")).toBe(`/qa-tenant/workspace?page=${page}`);
    expect(card.className).toContain("hover:bg-primary/5");
    expect(card.className).toContain("focus-visible:ring-2");
    expect(card.contains(screen.getByText("Next step details"))).toBe(true);

    fireEvent.click(screen.getByText("Next step details"));
    expect(navigate).toHaveBeenCalledWith(`/qa-tenant/workspace?page=${page}`);
  });
});
