#!/usr/bin/env node
/**
 * OFFLINE FIXTURES — intro panels + workspace states.
 *
 * Renders static HTML for visual inspection only. No live API calls, no
 * fixture data claiming real performance. Product cards in these fixtures are
 * explicitly labelled "SAMPLE" and contain no invented metrics.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "snapshots");
mkdirSync(OUT, { recursive: true });

const workspaceCss = readFileSync(path.join(HERE, "..", "app", "globals.css"), "utf8");

function doc(body, extraCss = "") {
  // Fixtures disable the infinite cue animation so headless capture can
  // detect "load complete" — the animation is cosmetic only.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NicheScout — offline fixture</title>
<style>${workspaceCss}
.introScrollCueArrow { animation: none !important; }
.introTrack { position: relative !important; }
${extraCss}</style></head><body>${body}</body></html>`;
}

const PANELS = [
  {
    eyebrow: "01 — The problem",
    headline: "Picking the wrong product gets expensive.",
    body: "Supplier tabs. Unclear shipping costs. Prices that leave little room for profit. Finding what to sell shouldn't mean guessing.",
    tone: "orange",
    cue: true,
  },
  {
    eyebrow: "02 — The consequence",
    headline: "A trend isn't a business plan.",
    body: "A popular product can still have weak margins, slow delivery, or too little evidence to justify selling it.",
    tone: "amber",
    scatter: true,
  },
  {
    eyebrow: "03 — The solution",
    headline: "Less guesswork. More evidence.",
    body: "NicheScout researches suppliers and market signals, checks costs and shipping, and explains which products meet your criteria—and where evidence is missing.",
    tone: "cream",
    tags: ["Describe your niche", "Review the evidence", "Approve a listing"],
  },
  {
    eyebrow: "04 — The invitation",
    headline: "Your next product starts here.",
    body: "Bring an idea. See what the evidence supports.",
    tone: "ink",
    cta: true,
  },
];

const SCATTER = [
  { top: "18%", left: "58%", label: "Supplier tab", rot: -4, lines: ["mid", "short"] },
  { top: "44%", left: "74%", label: "Shipping estimate", rot: 3, lines: ["short", "mid"] },
  { top: "68%", left: "60%", label: "Margin check", rot: -2, lines: ["mid", "short"] },
  { top: "30%", left: "88%", label: "Evidence gap", rot: 5, lines: ["short"] },
];

function panelHtml(p, i, total) {
  const scatter = p.scatter
    ? `<div class="introScatter" aria-hidden="true">${SCATTER.map((s) =>
        `<div class="scatterCard" style="top:${s.top};left:${s.left};transform:rotate(${s.rot}deg)">
           <div class="scatterLabel">${s.label}</div>
           ${s.lines.map((l) => `<div class="scatterLine ${l === "short" ? "scatterLineShort" : "scatterLineMid"}"></div>`).join("")}
         </div>`).join("")}</div>`
    : "";
  const tags = p.tags
    ? `<div class="introTags">${p.tags.map((t) => `<span class="introTag">${t}</span>`).join("")}</div>`
    : "";
  const cta = p.cta ? `<button class="introCta">Use NicheScout →</button>` : "";
  const cue = p.cue
    ? `<div class="introScrollCue">Scroll to explore <span class="introScrollCueArrow">→</span></div>`
    : "";
  return `<section class="introPanel" data-tone="${p.tone}" aria-label="${p.eyebrow}">
    ${scatter}
    <div class="introInner">
      <div class="introEyebrow">${p.eyebrow}</div>
      <h1 class="introHeadline introHeadlineTight">${p.headline}</h1>
      <p class="introBody">${p.body}</p>
      ${tags}${cta}${cue}
    </div>
  </section>`;
}

function introDoc({ width, singleIndex = null, label }) {
  const panels = singleIndex === null ? PANELS : [PANELS[singleIndex]];
  const widthVw = singleIndex === null ? panels.length * 100 : 100;
  const trackStyle = singleIndex === null ? `width:${widthVw}vw` : `width:100vw`;
  const progress = singleIndex === null ? 1 : singleIndex + 1;
  return doc(`
<div class="intro" style="width:${width}px">
  <header class="introChrome">
    <div class="introBrand"><span class="introBrandDot">N</span> NicheScout</div>
    <button class="introSkip">Skip intro / Open workspace</button>
  </header>
  <div class="introTrack" style="${trackStyle};position:relative">
    ${panels.map((p, i) => panelHtml(p, i, panels.length)).join("")}
  </div>
  <div class="introProgress">
    <span class="introCount">${String(progress).padStart(2, "0")} / 04</span>
    <div class="introDots">
      ${PANELS.map((_, i) => `<button class="introDot ${i === progress - 1 ? "introDotActive" : ""}"></button>`).join("")}
    </div>
  </div>
  <div class="introNav">
    <button class="introNavBtn" ${progress === 1 ? "disabled" : ""}>←</button>
    <button class="introNavBtn" ${progress === 4 ? "disabled" : ""}>→</button>
  </div>
</div>
<div style="font:12px system-ui;padding:12px;background:#111;color:#9ae6b4">OFFLINE FIXTURE — ${label}</div>`);
}

function workspaceDoc() {
  return doc(`
<div class="shell workspaceReveal">
  <header class="header">
    <div class="brand"><div class="brandMark">N</div><div><div class="brandName">NicheScout</div><div class="brandTag">Find products worth selling</div></div></div>
    <button class="wsReplay">↻ Replay intro</button>
  </header>
  <nav class="flow">
    <div class="flowStep flowActive"><div class="flowNum">1</div><div><div class="flowTitle">Describe your niche</div><div class="flowDesc">Share what you want to sell</div></div></div>
    <div class="flowStep"><div class="flowNum">2</div><div><div class="flowTitle">Review opportunities</div><div class="flowDesc">Approve the criteria and review matches</div></div></div>
    <div class="flowStep"><div class="flowNum">3</div><div><div class="flowTitle">Create a listing</div><div class="flowDesc">Generate a launch-ready product draft</div></div></div>
  </nav>
  <div class="card" style="max-width:720px;margin:0 auto">
    <h2 class="cardTitle">What would you like to sell?</h2>
    <p class="cardSub">Explore supplier costs, market signals, and shipping before you commit.</p>
    <label class="field"><span class="fieldLabel">Describe your niche</span>
      <textarea class="textarea" rows="3">Lightweight desk accessories under $12, ship to US in 10 days, leave 35% margin</textarea>
      <div class="help">Or pick one to start:</div></label>
    <div class="examples">
      <button class="exampleChip">Lightweight desk accessories under $12, ship to US in 10 days, leave 35% margin</button>
      <button class="exampleChip">Self-care products under $8 that can ship to the US within 7 days</button>
    </div>
    <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btnPrimary">Review my criteria</button></div>
  </div>
</div>
<div style="font:12px system-ui;padding:12px;background:#111;color:#9ae6b4">OFFLINE FIXTURE — workspace (no live data)</div>`);
}

// Write fixtures
const files = {
  "intro-01-problem.html": introDoc({ width: 1440, singleIndex: 0, label: "Intro panel 01 — desktop 1440" }),
  "intro-02-consequence.html": introDoc({ width: 1440, singleIndex: 1, label: "Intro panel 02 — desktop 1440" }),
  "intro-03-solution.html": introDoc({ width: 1440, singleIndex: 2, label: "Intro panel 03 — desktop 1440" }),
  "intro-04-invitation.html": introDoc({ width: 1440, singleIndex: 3, label: "Intro panel 04 — desktop 1440" }),
  "intro-strip-desktop.html": introDoc({ width: 1440, label: "All four panels in sequence — desktop" }),
  "intro-mobile-390.html": introDoc({ width: 390, singleIndex: 0, label: "Intro panel 01 — mobile 390" }),
  "workspace.html": workspaceDoc(),
};
for (const [name, html] of Object.entries(files)) writeFileSync(path.join(OUT, name), html);
console.log(`Wrote ${Object.keys(files).length} offline fixtures to ${OUT}`);
