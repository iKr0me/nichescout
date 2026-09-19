"use client";

/**
 * NicheScout intro — four horizontally-sequenced panels that transition into
 * the agent workspace.
 *
 * Desktop: ordinary vertical scrolling advances the horizontal track, driven
 * by a tall spacer section (no scroll trapping — you can always scroll past).
 * Mobile (≤860px): native horizontal scroll-snap.
 * Reduced motion: no transform animation; panels advance in discrete steps.
 * Keyboard: ← / → / PageUp / PageDown / Home / End move between panels.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const PANEL_COUNT = 4;

const PANELS = [
  {
    id: "problem",
    eyebrow: "01 — The problem",
    headline: "Picking the wrong product gets expensive.",
    body:
      "Supplier tabs. Unclear shipping costs. Prices that leave little room for profit. Finding what to sell shouldn't mean guessing.",
    tone: "orange" as const,
    cue: true,
  },
  {
    id: "consequence",
    eyebrow: "02 — The consequence",
    headline: "A trend isn't a business plan.",
    body:
      "A popular product can still have weak margins, slow delivery, or too little evidence to justify selling it.",
    tone: "amber" as const,
    cue: false,
  },
  {
    id: "solution",
    eyebrow: "03 — The solution",
    headline: "Less guesswork. More evidence.",
    body:
      "NicheScout researches suppliers and market signals, checks costs and shipping, and explains which products meet your criteria—and where evidence is missing.",
    tone: "cream" as const,
    cue: false,
    tags: ["Describe your niche", "Review the evidence", "Approve a listing"],
  },
  {
    id: "invitation",
    eyebrow: "04 — The invitation",
    headline: "Your next product starts here.",
    body: "Bring an idea. See what the evidence supports.",
    tone: "ink" as const,
    cue: false,
  },
];

// Clearly non-live decorative research fragments for panel 2.
const SCATTER = [
  { top: "18%", left: "58%", label: "Supplier tab", rot: -4, lines: ["mid", "short"] },
  { top: "44%", left: "74%", label: "Shipping estimate", rot: 3, lines: ["short", "mid"] },
  { top: "68%", left: "60%", label: "Margin check", rot: -2, lines: ["mid", "short"] },
  { top: "30%", left: "88%", label: "Evidence gap", rot: 5, lines: ["short"] },
];

export default function Intro({ onEnter }: { onEnter: () => void }) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotionRef = useRef(false);
  const isMobileRef = useRef(false);

  // Detect reduced-motion + viewport mode.
  useEffect(() => {
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqMobile = window.matchMedia("(max-width: 860px)");
    const sync = () => {
      reducedMotionRef.current = mqReduce.matches;
      isMobileRef.current = mqMobile.matches;
    };
    sync();
    mqReduce.addEventListener("change", sync);
    mqMobile.addEventListener("change", sync);
    return () => {
      mqReduce.removeEventListener("change", sync);
      mqMobile.removeEventListener("change", sync);
    };
  }, []);

  // Desktop: vertical scroll drives horizontal translation.
  useEffect(() => {
    function onScroll() {
      if (isMobileRef.current) return;         // mobile uses native snap
      const spacer = spacerRef.current;
      const track = trackRef.current;
      if (!spacer || !track) return;
      const total = spacer.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const progress = Math.min(1, Math.max(0, window.scrollY / total));
      const maxShift = (PANEL_COUNT - 1) * window.innerWidth;
      track.style.transform = `translate3d(${-progress * maxShift}px, 0, 0)`;
      const next = Math.min(PANEL_COUNT - 1, Math.round(progress * (PANEL_COUNT - 1)));
      setIndex((prev) => (prev === next ? prev : next));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Reset document scroll when the intro mounts.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Programmatic navigation (used by prev/next/dots/keyboard).
  const goTo = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(PANEL_COUNT - 1, target));
    setIndex(clamped);

    if (isMobileRef.current) {
      const track = trackRef.current;
      if (track) {
        const behavior: ScrollBehavior = reducedMotionRef.current ? "auto" : "smooth";
        track.scrollTo({ left: clamped * window.innerWidth, behavior });
      }
      return;
    }
    const spacer = spacerRef.current;
    if (!spacer) return;
    const total = spacer.offsetHeight - window.innerHeight;
    const y = (clamped / (PANEL_COUNT - 1)) * total;
    window.scrollTo({ top: y, behavior: reducedMotionRef.current ? "auto" : "smooth" });
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Let form controls keep their own key handling.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goTo(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goTo(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(PANEL_COUNT - 1);
      } else if (e.key === "Enter" && index === PANEL_COUNT - 1) {
        e.preventDefault();
        onEnter();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo, onEnter]);

  // Mobile: reflect native snap position back into the index.
  function onTrackScroll() {
    if (!isMobileRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const next = Math.round(track.scrollLeft / window.innerWidth);
    setIndex((prev) => (prev === next ? prev : Math.max(0, Math.min(PANEL_COUNT - 1, next))));
  }

  return (
    <div className="intro">
      <header className="introChrome">
        <div className="introBrand">
          <span className="introBrandDot" aria-hidden="true">N</span>
          NicheScout
        </div>
        <button className="introSkip" onClick={onEnter}>
          Skip intro / Open workspace
        </button>
      </header>

      {/* Desktop scroll driver: tall empty spacer behind the fixed track. */}
      <div
        ref={spacerRef}
        className="introSpacer"
        aria-hidden="true"
        style={{ height: `${PANEL_COUNT * 100}vh` }}
      />

      <div
        ref={trackRef}
        className="introTrack"
        onScroll={onTrackScroll}
      >
        {PANELS.map((p) => (
          <section
            key={p.id}
            className="introPanel"
            data-tone={p.tone}
            aria-label={p.eyebrow}
          >
            {p.id === "consequence" && (
              <div className="introScatter" aria-hidden="true">
                {SCATTER.map((s, i) => (
                  <div
                    key={i}
                    className="scatterCard"
                    style={{
                      top: s.top,
                      left: s.left,
                      ["--rot" as any]: `${s.rot}deg`,
                    }}
                  >
                    <div className="scatterLabel">{s.label}</div>
                    {s.lines.map((l, j) => (
                      <div
                        key={j}
                        className={
                          "scatterLine" + (l === "short" ? " scatterLineShort" : " scatterLineMid")
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="introInner">
              <div className="introEyebrow">{p.eyebrow}</div>
              <h1 className="introHeadline introHeadlineTight">{p.headline}</h1>
              <p className="introBody">{p.body}</p>

              {p.tags && (
                <div className="introTags">
                  {p.tags.map((t) => (
                    <span key={t} className="introTag">{t}</span>
                  ))}
                </div>
              )}

              {p.id === "invitation" && (
                <button className="introCta" onClick={onEnter}>
                  Use NicheScout →
                </button>
              )}

              {p.cue && (
                <div className="introScrollCue">
                  Scroll to explore
                  <span className="introScrollCueArrow" aria-hidden="true">→</span>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="introProgress">
        <span className="introCount" aria-hidden="true">
          {String(index + 1).padStart(2, "0")} / {String(PANEL_COUNT).padStart(2, "0")}
        </span>
        <div className="introDots" role="tablist" aria-label="Intro panels">
          {PANELS.map((p, i) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={i === index}
              aria-label={p.eyebrow}
              className={"introDot" + (i === index ? " introDotActive" : "")}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      </div>

      <div className="introNav">
        <button
          className="introNavBtn"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous panel"
        >
          ←
        </button>
        <button
          className="introNavBtn"
          onClick={() => goTo(index + 1)}
          disabled={index === PANEL_COUNT - 1}
          aria-label="Next panel"
        >
          →
        </button>
      </div>

      <p className="srOnly" aria-live="polite">
        Panel {index + 1} of {PANEL_COUNT}: {PANELS[index].headline}
      </p>
    </div>
  );
}
