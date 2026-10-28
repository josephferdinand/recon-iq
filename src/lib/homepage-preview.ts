/**
 * Live homepage preview channel.
 *
 * The Site admin editor broadcasts unsaved draft edits over a same-origin
 * BroadcastChannel. The public homepage, when opened in preview mode
 * (`?preview=fvi`), listens and overlays those drafts on top of the server
 * bundle in real time — no save, no publish, no reload required.
 */
import { useEffect, useState } from "react";
import type {
  HomepageBundle,
  HomepageSectionKey,
  SectionContent,
} from "@/lib/mkt-homepage.functions";

export const HOMEPAGE_PREVIEW_CHANNEL = "fvi-homepage-preview";
export const HOMEPAGE_PREVIEW_PARAM = "preview";
export const HOMEPAGE_PREVIEW_TOKEN = "fvi";

export type HomepagePreviewDraft = Partial<
  Record<HomepageSectionKey, { content: SectionContent; enabled: boolean }>
>;

export type HomepagePreviewMessage =
  | { kind: "draft"; draft: HomepagePreviewDraft; ts: number }
  | { kind: "clear"; ts: number }
  | { kind: "ping"; ts: number };

/** True when the current URL asks for live preview overlay. */
export function isHomepagePreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(HOMEPAGE_PREVIEW_PARAM) === HOMEPAGE_PREVIEW_TOKEN;
  } catch {
    return false;
  }
}

function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  return new BroadcastChannel(HOMEPAGE_PREVIEW_CHANNEL);
}

/**
 * Publisher hook — used by the Site admin editor to push draft edits.
 * Call `publish(draft)` any time the editor state changes; `clear()` on unmount.
 */
export function useHomepagePreviewPublisher() {
  const [channel] = useState<BroadcastChannel | null>(() => openChannel());

  useEffect(() => {
    if (!channel) return;
    // Announce presence so any already-open preview can request the latest draft.
    channel.postMessage({ kind: "ping", ts: Date.now() } satisfies HomepagePreviewMessage);
    return () => {
      try {
        channel.postMessage({ kind: "clear", ts: Date.now() } satisfies HomepagePreviewMessage);
      } catch {
        /* ignore */
      }
      channel.close();
    };
  }, [channel]);

  return {
    publish(draft: HomepagePreviewDraft) {
      if (!channel) return;
      channel.postMessage({ kind: "draft", draft, ts: Date.now() } satisfies HomepagePreviewMessage);
    },
    clear() {
      if (!channel) return;
      channel.postMessage({ kind: "clear", ts: Date.now() } satisfies HomepagePreviewMessage);
    },
  };
}

/**
 * Subscriber hook — used by the public homepage.
 * Returns the current draft overlay, or `null` when not in preview mode.
 */
export function useHomepagePreviewDraft(): HomepagePreviewDraft | null {
  const [active, setActive] = useState<boolean>(() => isHomepagePreviewMode());
  const [draft, setDraft] = useState<HomepagePreviewDraft | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setActive(isHomepagePreviewMode());
    window.addEventListener("popstate", check);
    return () => window.removeEventListener("popstate", check);
  }, []);

  useEffect(() => {
    if (!active) return;
    const ch = openChannel();
    if (!ch) return;
    const onMsg = (ev: MessageEvent<HomepagePreviewMessage>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "draft") setDraft(msg.draft);
      else if (msg.kind === "clear") setDraft(null);
    };
    ch.addEventListener("message", onMsg);
    return () => {
      ch.removeEventListener("message", onMsg);
      ch.close();
    };
  }, [active]);

  return active ? draft : null;
}

/**
 * Merge a preview draft onto a resolved bundle. Section content is shallow-merged
 * so a partially-edited section still shows unedited fields from the saved bundle.
 */
export function applyHomepagePreview(
  bundle: HomepageBundle,
  draft: HomepagePreviewDraft | null,
): HomepageBundle {
  if (!draft) return bundle;
  const out = { ...bundle } as HomepageBundle;
  for (const key of Object.keys(draft) as HomepageSectionKey[]) {
    const patch = draft[key];
    if (!patch) continue;
    out[key] = { ...out[key], ...patch.content };
  }
  return out;
}
