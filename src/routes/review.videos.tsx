import { createFileRoute } from "@tanstack/react-router";
import onyxVid from "@/assets/video/fvi-product-onyx-90s.mp4.asset.json";
import onyxPoster from "@/assets/video/fvi-product-onyx-poster.jpg.asset.json";
import auroraVid from "@/assets/video/fvi-product-aurora-90s.mp4.asset.json";
import auroraPoster from "@/assets/video/fvi-product-aurora-poster.jpg.asset.json";
import cinematicVid from "@/assets/video/fvi-demo-90s.mp4.asset.json";
import cinematicPoster from "@/assets/video/fvi-demo-poster.jpg.asset.json";

export const Route = createFileRoute("/review/videos")({
  head: () => ({
    meta: [
      { title: "ReconIQ · Video Review" },
      { name: "description", content: "Side-by-side review of the 90-second ReconIQ product videos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewVideos,
});

const VIDEOS = [
  { label: "V1 · Onyx Cinematic", sub: "Deep navy · gold · Playfair — accelerated clause-by-clause sync to Adam narration", src: onyxVid.url,      poster: onyxPoster.url },
  { label: "V2 · Onyx Kinetic",   sub: "Same Apple-onyx theme — faster kinetic motion locked to the same voice beats",       src: auroraVid.url,    poster: auroraPoster.url },
  { label: "Original",            sub: "Cinematic cut + Adam narration overlay",                                          src: cinematicVid.url, poster: cinematicPoster.url },
];

function ReviewVideos() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">ReconIQ — Product video review</h1>
          <p className="mt-2 text-muted-foreground">Three 90-second cuts. Play, compare, pick one to lock as default on the homepage.</p>
        </header>

        <div className="grid gap-8">
          {VIDEOS.map((v) => (
            <section key={v.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium">{v.label}</h2>
                  <p className="text-sm text-muted-foreground">{v.sub}</p>
                </div>
                <a href={v.src} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-4">
                  Open MP4
                </a>
              </div>
              <video
                controls
                preload="metadata"
                poster={v.poster}
                src={v.src}
                className="w-full rounded-xl bg-black"
                style={{ aspectRatio: "16 / 9" }}
              />
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
