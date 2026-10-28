// D7 — Certification Training UI.
// Lists tracks, runs a quiz, records score, and surfaces pass/fail.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

type Track = { id: string; slug: string; name: string; description: string | null; level: string; passing_score_pct: number; duration_minutes: number };
type Quiz = { id: string; ordering: number; question: string; options: string[]; explanation: string | null };

const listTracksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("certification_tracks")
      .select("id, slug, name, description, level, passing_score_pct, duration_minutes")
      .eq("active", true)
      .order("level");
    if (error) throw new Error(error.message);
    return (data ?? []) as Track[];
  });

const loadQuizFn = createServerFn({ method: "GET" })
  .validator(z.object({ track_slug: z.string() }))
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    const { data: track, error: tErr } = await context.supabase
      .from("certification_tracks").select("id, slug, name, passing_score_pct").eq("slug", data.track_slug).single();
    if (tErr || !track) throw new Error(tErr?.message ?? "track not found");
    // NOTE: correct_index is intentionally excluded — answer keys must never
    // reach the browser. Scoring happens server-side in submitAttemptFn.
    const { data: qs, error: qErr } = await context.supabase
      .from("certification_quizzes")
      .select("id, ordering, question, options, explanation")
      .eq("track_id", (track as any).id)
      .order("ordering");
    if (qErr) throw new Error(qErr.message);
    return { track, quizzes: (qs ?? []) as Quiz[] };
  });

const submitAttemptFn = createServerFn({ method: "POST" })
  .validator(z.object({
    track_id: z.string().uuid(),
    tenant_id: z.string().uuid().nullable(),
    answers: z.record(z.string(), z.number()),
  }))
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    // Load track + answer keys with service role so correct_index stays server-side.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: track, error: tErr } = await supabaseAdmin
      .from("certification_tracks")
      .select("id, passing_score_pct")
      .eq("id", data.track_id).single();
    if (tErr || !track) throw new Error("track not found");
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("certification_quizzes")
      .select("id, correct_index")
      .eq("track_id", data.track_id);
    if (qErr) throw new Error(qErr.message);
    const quizzes = (qs ?? []) as Array<{ id: string; correct_index: number }>;
    if (!quizzes.length) throw new Error("no quiz questions");
    const correct = quizzes.filter((q) => data.answers[q.id] === q.correct_index).length;
    const scoreRaw = (correct / quizzes.length) * 100;
    const score_pct = Math.round(scoreRaw * 100) / 100;
    const passed = score_pct >= (track as any).passing_score_pct;
    const certNumber = passed
      ? `FVI-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      : null;
    const { data: row, error } = await context.supabase
      .from("certification_attempts")
      .insert({
        track_id: data.track_id, user_id: context.userId, tenant_id: data.tenant_id,
        started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        answers: data.answers as any, score_pct, passed,
        certificate_number: certNumber,
      } as any).select("id, certificate_number").single();
    if (error) throw new Error(error.message);
    return { score_pct, passed, attempt: row };
  });

export const Route = createFileRoute("/_authenticated/$slug/workspace/training")({
  component: TrainingPage,
});

function TrainingPage() {
  const { slug } = Route.useParams();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [active, setActive] = useState<{ track: any; quizzes: Quiz[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score_pct: number; passed: boolean; cert?: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { listTracksFn().then(setTracks).catch(() => setTracks([])); }, []);

  async function start(trackSlug: string) {
    setLoading(true);
    setResult(null); setAnswers({});
    try {
      const r = await loadQuizFn({ data: { track_slug: trackSlug } });
      setActive(r);
    } finally { setLoading(false); }
  }

  async function submit() {
    if (!active) return;
    const res = await submitAttemptFn({
      data: { track_id: active.track.id, tenant_id: null, answers },
    });
    setResult({ score_pct: res.score_pct, passed: res.passed, cert: (res.attempt as any)?.certificate_number ?? null });
  }

  if (active && !result) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <button onClick={() => setActive(null)} className="text-sm underline">← Back to tracks</button>
        <h1 className="text-2xl font-semibold">{active.track.name}</h1>
        <p className="text-sm opacity-70">Passing score: {active.track.passing_score_pct}%</p>
        {active.quizzes.map((q, i) => (
          <div key={q.id} className="rounded-lg border p-4">
            <div className="mb-3 font-medium">{i + 1}. {q.question}</div>
            <div className="space-y-2">
              {q.options.map((opt, idx) => (
                <label key={idx} className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name={q.id} checked={answers[q.id] === idx}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: idx }))} />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <button onClick={submit} className="rounded bg-primary px-4 py-2 text-primary-foreground"
          disabled={Object.keys(answers).length < active.quizzes.length}>Submit attempt</button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">{result.passed ? "🎉 Passed" : "Not yet"}</h1>
        <p className="text-4xl font-bold">{result.score_pct.toFixed(1)}%</p>
        {result.cert && <p className="text-sm">Certificate #: <code>{result.cert}</code></p>}
        <button onClick={() => { setActive(null); setResult(null); }} className="rounded border px-4 py-2">Back to tracks</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">ReconIQ Certifications</h1>
        <p className="text-sm opacity-70">Earn role-based credentials for builders, analysts, and admins.</p>
      </header>
      {loading && <p className="text-sm">Loading…</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {tracks.map((t) => (
          <div key={t.id} className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">{t.name}</h2>
            <div className="my-1 text-xs uppercase text-foreground/80">{t.level}</div>
            <p className="text-sm opacity-80">{t.description}</p>
            <div className="mt-3 text-xs opacity-70">Pass ≥ {t.passing_score_pct}% · {t.duration_minutes} min</div>
            <button onClick={() => start(t.slug)} className="mt-4 w-full rounded bg-primary px-4 py-2 text-primary-foreground">Start</button>
          </div>
        ))}
        {!tracks.length && !loading && <p className="text-sm opacity-70">No active certification tracks.</p>}
      </div>
      <Link to="/$slug/workspace" params={{ slug }} className="text-sm underline">← Back to workspace</Link>
    </div>
  );
}
