import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react";
import cinematicVid from "@/assets/video/fvi-demo-90s.mp4.asset.json";
import cinematicPoster from "@/assets/video/fvi-demo-poster.jpg.asset.json";
import onyxVid from "@/assets/video/fvi-product-onyx-90s.mp4.asset.json";
import onyxPoster from "@/assets/video/fvi-product-onyx-poster.jpg.asset.json";
import auroraVid from "@/assets/video/fvi-product-aurora-90s.mp4.asset.json";
import auroraPoster from "@/assets/video/fvi-product-aurora-poster.jpg.asset.json";

type Variant = "onyx" | "aurora" | "cinematic";

const VARIANTS: Record<Variant, { label: string; video: string; poster: string; usesNarrationOverlay: boolean }> = {
  onyx:      { label: "V1 · Onyx Cinematic", video: onyxVid.url,      poster: onyxPoster.url,      usesNarrationOverlay: false },
  aurora:    { label: "V2 · Onyx Kinetic",   video: auroraVid.url,    poster: auroraPoster.url,    usesNarrationOverlay: false },
  cinematic: { label: "Original",            video: cinematicVid.url, poster: cinematicPoster.url, usesNarrationOverlay: true  },
};

/** Homepage product-video player with variant switcher (V1 Onyx / V2 Aurora / Original). */
export function FviDemoPlayer({ onClose: _onClose }: { onClose?: () => void }) {
  const [variant, setVariant] = useState<Variant>("aurora");
  const cfg = VARIANTS[variant];
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(92);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    const sync = () => {
      if (!a || !cfg.usesNarrationOverlay) return;
      if (Math.abs(a.currentTime - v.currentTime) > 0.25) a.currentTime = v.currentTime;
    };
    const onTime = () => { setProgress(v.currentTime); sync(); };
    const onLoaded = () => setDuration(v.duration || 92);
    const onPlay = () => { setPlaying(true); if (a && cfg.usesNarrationOverlay && !v.muted) a.play().catch(() => {}); };
    const onPause = () => { setPlaying(false); a?.pause(); };
    const onSeek = () => sync();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeek);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onSeek);
    };
  }, [cfg.usesNarrationOverlay, variant]);

  // On variant change: reset playback state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    v.muted = muted;
    v.play().catch(() => {});
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
  }, [variant]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) v.play(); else v.pause(); };
  const toggleMute = () => {
    const v = videoRef.current; const a = audioRef.current;
    if (!v) return;
    const nextMuted = !v.muted;
    v.muted = nextMuted;
    if (!nextMuted) v.volume = cfg.usesNarrationOverlay ? 0.35 : 0.95;
    if (a && cfg.usesNarrationOverlay) {
      a.muted = nextMuted;
      if (!nextMuted) { a.volume = 0.95; a.currentTime = v.currentTime; if (!v.paused) a.play().catch(() => {}); }
      else a.pause();
    }
    setMuted(nextMuted);
  };
  const toggleFullscreen = async () => {
    const el = wrapRef.current; if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen();
  };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current; const a = audioRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
    if (a) a.currentTime = v.currentTime;
    setProgress(v.currentTime);
  };
  const fmt = (s: number) => { const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

  const scrubStyle = useMemo(() => ({
    background: `linear-gradient(to right, #93c5fd 0%, #93c5fd ${(progress / (duration || 92)) * 100}%, rgba(255,255,255,0.25) ${(progress / (duration || 92)) * 100}%, rgba(255,255,255,0.25) 100%)`,
  }), [progress, duration]);

  return (
    <div ref={wrapRef} className="group relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "16 / 9" }}>
      <video
        ref={videoRef}
        key={variant}
        className="absolute inset-0 h-full w-full object-cover"
        src={cfg.video}
        poster={cfg.poster}
        autoPlay
        muted
        playsInline
        preload="metadata"
        onClick={togglePlay}
        aria-label={`ReconIQ — 90 second product demo (${cfg.label})`}
      />

      {cfg.usesNarrationOverlay && (
        <audio ref={audioRef} src="/audio/fvi-narration-90s.mp3" preload="auto" muted aria-hidden="true" />
      )}

      {/* Variant switcher */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur-md">
        {(Object.keys(VARIANTS) as Variant[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setVariant(k)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition ${
              variant === k ? "bg-white text-slate-900" : "text-white/85 hover:bg-white/10"
            }`}
          >
            {VARIANTS[k].label}
          </button>
        ))}
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 100%)" }} />

      {!playing && (
        <button type="button" onClick={togglePlay} aria-label="Play demo" className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-20 w-20 place-items-center rounded-full backdrop-blur-md transition hover:scale-105" style={{ background: "color-mix(in oklab, white 92%, transparent)", boxShadow: "0 20px 60px -10px rgba(0,0,0,0.6)" }}>
            <Play className="h-8 w-8 translate-x-0.5" style={{ color: "#0b1e3f" }} />
          </span>
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="grid h-9 w-9 place-items-center rounded-full text-white transition hover:bg-white/10">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
          </button>
          <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="grid h-9 w-9 place-items-center rounded-full text-white transition hover:bg-white/10">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <div className="flex flex-1 items-center gap-2 text-[11px] tabular-nums text-white/90">
            <span className="min-w-[36px]">{fmt(progress)}</span>
            <input type="range" min={0} max={duration || 92} step={0.1} value={progress} onChange={seek} aria-label="Seek" className="fvi-video-scrub flex-1" style={scrubStyle} />
            <span className="min-w-[36px] text-right">{fmt(duration || 92)}</span>
          </div>
          <button type="button" onClick={toggleFullscreen} aria-label={isFs ? "Exit full screen" : "Enter full screen"} className="grid h-9 w-9 place-items-center rounded-full text-white transition hover:bg-white/10">
            {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <style>{`
        .fvi-video-scrub { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; outline: none; cursor: pointer; }
        .fvi-video-scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; height: 14px; width: 14px; border-radius: 999px; background: #ffffff; border: 2px solid #60a5fa; box-shadow: 0 2px 6px rgba(0,0,0,0.35); }
        .fvi-video-scrub::-moz-range-thumb { height: 14px; width: 14px; border-radius: 999px; background: #ffffff; border: 2px solid #60a5fa; }
      `}</style>
    </div>
  );
}
