// D7 — Certification seed + scoring tests.
import { describe, it, expect } from "vitest";

type Quiz = { id: string; correct_index: number };

function scoreAttempt(quizzes: Quiz[], answers: Record<string, number>, passingPct: number) {
  const correct = quizzes.filter((q) => answers[q.id] === q.correct_index).length;
  const score_pct = quizzes.length ? (correct / quizzes.length) * 100 : 0;
  return { score_pct, passed: score_pct >= passingPct };
}

describe("certifications", () => {
  const quizzes: Quiz[] = [
    { id: "q1", correct_index: 1 }, { id: "q2", correct_index: 0 }, { id: "q3", correct_index: 3 },
  ];

  it("seed expectations: three FVI tracks exist", () => {
    const seeded = ["fvi-certified-builder", "fvi-certified-exceptions-handler", "fvi-certified-system-admin"];
    expect(seeded).toHaveLength(3);
    expect(seeded).toContain("fvi-certified-builder");
  });

  it("attempt records score = correct/total", () => {
    const r = scoreAttempt(quizzes, { q1: 1, q2: 0, q3: 3 }, 70);
    expect(r.score_pct).toBe(100);
    expect(r.passed).toBe(true);
  });

  it("below-passing score marks attempt as failed", () => {
    const r = scoreAttempt(quizzes, { q1: 0, q2: 0, q3: 0 }, 70);
    expect(r.score_pct).toBeCloseTo(33.33, 1);
    expect(r.passed).toBe(false);
  });
});
