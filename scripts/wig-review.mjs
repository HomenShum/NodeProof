#!/usr/bin/env node
/**
 * Condition 7 — the Web Interface Guidelines review.
 *
 * This is NOT an audit tool and does not substitute for one. Lighthouse scores a
 * page against its own heuristics; the Web Interface Guidelines are a set of
 * MUST/SHOULD/NEVER rules a human reads and judges a page against. A Lighthouse
 * score can be 100 while half of these rules are broken — a status region with
 * no `aria-live`, a 38px tap target, an error that prints a machine enum — so
 * passing one off as the other would be laundering, not evidence.
 *
 * What this script is: the measurement half of that review. Each entry below
 * quotes the rule verbatim from the guidelines and records the DOM/CSS value
 * that decides it, in the rendered page, at desktop and mobile. The judgement
 * half — severity, who it hurts, what to do — is written by hand in
 * promotion/evidence/wig/REVIEW.md and cites these fields by id.
 *
 * Source of the rules, fetched 2026-08-13:
 *   https://vercel.com/design/guidelines
 *   raw: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/AGENTS.md
 *
 *   npm run build && npm run proofloop:wig-review
 *
 * Flags: --port <n> (default 4910)  --out <dir>  --headed
 *
 * Exits 1 while any finding marked major is unresolved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT, startPublicServer } from "./serve-public.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const PORT = Number(flag("port", 4910));
const OUT = resolve(ROOT, flag("out", "promotion/evidence/wig"));
const HEADED = argv.includes("--headed");

const GUIDELINES_URL = "https://vercel.com/design/guidelines";
const GUIDELINES_RAW = "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/AGENTS.md";

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright not found: run `npm install` then `npx playwright install chromium`.");
  process.exit(2);
});

mkdirSync(OUT, { recursive: true });
const site = await startPublicServer(PORT).catch((error) => {
  console.error(error.message);
  process.exit(2);
});

const findings = [];
/**
 * @param severity major | moderate | minor — a MUST that silently removes a
 *   user class (screen reader, touch, keyboard) from the primary journey is
 *   major; a MUST with a cosmetic blast radius is moderate; a SHOULD is minor.
 */
const record = (id, section, guideline, severity, ok, measurement) => {
  findings.push({ id, section, guideline, severity, status: ok ? "pass" : "fail", measurement });
};

const browser = await chromium.launch({ headless: !HEADED });

// ---------------------------------------------------------------- desktop pass
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await desktop.newPage();
const OUT_REL = relative(ROOT, OUT).replace(/\\/g, "/");
const shot = async (ctx, name) => {
  await ctx.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  return `${OUT_REL}/${name}.png`;
};

await page.goto(`${site.base}/`, { waitUntil: "load" });

// Interactions > Feedback — "MUST: Use polite `aria-live` for toasts/inline validation"
const statusAria = await page.$eval("[data-intake-status]", (el) => ({
  role: el.getAttribute("role"),
  ariaLive: el.getAttribute("aria-live"),
  outerHTML: el.outerHTML.slice(0, 200),
}));
record(
  "W1",
  "Interactions > Feedback",
  "MUST: Use polite `aria-live` for toasts/inline validation",
  "major",
  statusAria.ariaLive === "polite" || statusAria.role === "status",
  statusAria,
);

// Content & Accessibility — "MUST: `<title>` matches current context"
const title = await page.title();
record("W2", "Content & Accessibility", "MUST: `<title>` matches current context", "minor", /proofloop/i.test(title.replace(/\s+/g, "")), { title });

// Targets & Input — "MUST: `touch-action: manipulation` to prevent double-tap zoom"
const touchAction = await page.$$eval("[data-testid=\"target-submit\"], [data-testid=\"github-sso\"], [data-testid=\"target-input\"]", (els) =>
  els.map((el) => ({ el: el.getAttribute("data-testid"), touchAction: getComputedStyle(el).touchAction })),
);
record(
  "W3",
  "Interactions > Targets & Input",
  "MUST: `touch-action: manipulation` to prevent double-tap zoom",
  "moderate",
  touchAction.every((t) => t.touchAction === "manipulation"),
  touchAction,
);

// Forms — "MUST: `autocomplete` + meaningful `name`; correct `type` and `inputmode`"
const inputAttrs = await page.$eval("[data-testid=\"target-input\"]", (el) => ({
  name: el.getAttribute("name"),
  autocomplete: el.getAttribute("autocomplete"),
  type: el.getAttribute("type"),
  inputmode: el.getAttribute("inputmode"),
  fontSizePx: Math.round(parseFloat(getComputedStyle(el).fontSize)),
  placeholder: el.getAttribute("placeholder"),
}));
record("W4", "Interactions > Forms", "MUST: `autocomplete` + meaningful `name`; correct `type` and `inputmode`", "moderate", Boolean(inputAttrs.name) && Boolean(inputAttrs.autocomplete) && Boolean(inputAttrs.inputmode), inputAttrs);

// Targets & Input — "MUST: Mobile `<input>` font-size ≥16px to prevent iOS zoom"
record("W5", "Interactions > Targets & Input", "MUST: Mobile `<input>` font-size ≥16px to prevent iOS zoom", "moderate", inputAttrs.fontSizePx >= 16, { fontSizePx: inputAttrs.fontSizePx });

// Content & Accessibility — "MUST: Use `…` character (not `...`)" (checked on the
// literal strings the page can render, not only the ones on screen right now)
const ellipsisOffenders = await page.evaluate(async () => {
  const source = await fetch("/app.js").then((r) => r.text());
  const literals = source.match(/"[^"\n]*\.\.\.[^"\n]*"|`[^`\n]*\.\.\.[^`\n]*`/g) || [];
  const placeholder = document.querySelector("[data-intake-input]").getAttribute("placeholder");
  return { literals, placeholder, placeholderHasEllipsis: /…$/.test(placeholder || "") };
});
record("W6", "Content & Accessibility", "MUST: Use `…` character (not `...`)", "minor", ellipsisOffenders.literals.length === 0, ellipsisOffenders);

// Dark Mode & Theming — color-scheme (MUST) and theme-color (SHOULD)
const theming = await page.evaluate(() => ({
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || null,
  bodyBackground: getComputedStyle(document.body).backgroundColor,
}));
record("W7", "Dark Mode & Theming", "MUST: `color-scheme: dark` on `<html>` for dark themes", "minor", theming.colorScheme.includes("dark"), theming);
record("W8", "Dark Mode & Theming", "SHOULD: `<meta name=\"theme-color\">` matches page background", "minor", Boolean(theming.themeColor), theming);

// Interactions > Keyboard — "MUST: Visible focus rings (`:focus-visible`)".
// Driven with real Tab presses, not `el.focus()`: `:focus-visible` is a
// heuristic on how focus arrived, so a programmatic focus can style differently
// from a keyboard one and would measure a page nobody is using.
const focusRing = [];
// Click the heading first, not `blur()`: the input carries `autofocus`, and
// blurring leaves Chromium's sequential-navigation start point on it, so the
// first Tab would skip the input and the third would leave the page entirely.
await page.click("h1");
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press("Tab");
  focusRing.push(
    await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return {
        testid: el.getAttribute("data-testid"),
        outlineWidth: s.outlineWidth,
        outlineStyle: s.outlineStyle,
        borderColor: s.borderColor,
      };
    }),
  );
}
record(
  "W9",
  "Interactions > Keyboard",
  "MUST: Visible focus rings (`:focus-visible`; group with `:focus-within`) — NEVER: `outline: none` without visible focus replacement",
  "moderate",
  focusRing.length === 3 &&
    focusRing.every((f) => f.testid && f.outlineStyle !== "none" && parseFloat(f.outlineWidth) >= 1),
  { tabOrder: focusRing.map((f) => f.testid), rings: focusRing },
);

// Interactions > Forms — "MUST: Errors inline next to fields; on submit, focus
// first error". One field, so the first error is always the input.
await page.fill("[data-testid=\"target-input\"]", "");
await page.click("[data-testid=\"target-submit\"]");
const afterInvalidSubmit = await page.evaluate(() => ({
  focused: document.activeElement?.getAttribute("data-testid"),
  message: document.querySelector("[data-intake-status]").textContent.trim(),
}));
record("W15", "Interactions > Forms", "MUST: Errors inline next to fields; on submit, focus first error", "moderate", afterInvalidSubmit.focused === "target-input" && afterInvalidSubmit.message.length > 0, afterInvalidSubmit);

// Interactions > Forms — "MUST: Loading buttons show spinner and keep original
// label". The label half is measured in the browser proof's pending capture;
// the spinner half is measured here, and stays open on purpose (see REVIEW.md).
const spinner = await page.evaluate(async () => {
  const css = await fetch("/styles.css").then((r) => r.text());
  return { definesKeyframes: /@keyframes/.test(css), definesSpinnerOnButton: /button(\[[^\]]*\])?::(after|before)/.test(css) };
});
record("W16", "Interactions > Forms", "MUST: Loading buttons show spinner and keep original label", "moderate", spinner.definesKeyframes && spinner.definesSpinnerOnButton, {
  ...spinner,
  labelHalf: "promotion/evidence/browser-proof/receipt.json -> journeys.J5.pending (submitDisabled true, label stays \"ProofLoop\", status reads \"Submitting…\")",
});

// --- drive the error state, which is where most of the remaining rules land ---
await page.fill("[data-testid=\"target-input\"]", "https://example.com");
await page.click("[data-testid=\"target-submit\"]");
await page.waitForSelector("[data-intake-detail]:not([hidden])", { timeout: 30000 });
const blocked = await page.evaluate(() => {
  const status = document.querySelector("[data-intake-status]");
  const detail = document.querySelector("[data-intake-detail]");
  return {
    statusText: status.textContent.trim(),
    statusColor: getComputedStyle(status).color,
    statusKind: status.getAttribute("data-kind"),
    detailFirst80: detail.textContent.trim().slice(0, 80),
  };
});
const blockedShot = await shot(page, "wig-blocked-state-1280");

// Interactions > Keyboard — "MUST: Full keyboard support per WAI-ARIA APG".
// The refusal receipt is a 220px-tall scrolling box. If it is not focusable,
// a keyboard-only user can see the top of the answer and never reach the rest.
// Note this is invisible to the axe run in promotion/evidence/web-audit/: that
// audits the page as loaded, where the detail panel is still `hidden`.
const scrollables = await page.evaluate(() =>
  [...document.querySelectorAll("body *")]
    .filter((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    })
    .map((el) => ({
      selector: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : ""),
      tabIndex: el.tabIndex,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      accessibleName: el.getAttribute("aria-label"),
    })),
);
record(
  "W17",
  "Interactions > Keyboard",
  "MUST: Full keyboard support per WAI-ARIA APG (a scrollable region must be reachable by keyboard)",
  "major",
  scrollables.every((s) => s.tabIndex >= 0 && s.accessibleName),
  { scrollablesInRefusedState: scrollables },
);

// Content & Accessibility — "MUST: Design empty/sparse/dense/error states" and
// "MUST: No dead ends; always offer next step/recovery". The measurable form:
// the error headline must be a sentence a person can read, not a machine enum,
// and it must not be the raw payload key.
const MACHINE_ENUMS = ["blocked", "queued", "pending", "dispatch_failed", "error", "ok"];
record(
  "W10",
  "Content & Accessibility",
  "MUST: Design empty/sparse/dense/error states — MUST: No dead ends; always offer next step/recovery",
  "major",
  !MACHINE_ENUMS.includes(blocked.statusText.toLowerCase()) && /\s/.test(blocked.statusText),
  { ...blocked, screenshot: blockedShot },
);

// Content & Accessibility — "MUST: Redundant status cues (not color-only)"
const statusKindsAreColorOnly = await page.evaluate(() => {
  // Render each kind the page can produce and compare what distinguishes them.
  const status = document.querySelector("[data-intake-status]");
  const seen = {};
  for (const kind of ["github", "queued", "blocked", "pending"]) {
    status.setAttribute("data-kind", kind);
    seen[kind] = {
      color: getComputedStyle(status).color,
      beforeContent: getComputedStyle(status, "::before").content,
    };
  }
  return seen;
});
const distinctPrefixes = new Set(Object.values(statusKindsAreColorOnly).map((s) => s.beforeContent));
record(
  "W11",
  "Content & Accessibility",
  "MUST: Redundant status cues (not color-only); icons have text labels",
  "major",
  distinctPrefixes.size > 1 && !distinctPrefixes.has("none"),
  { perKind: statusKindsAreColorOnly, distinctNonColorCues: distinctPrefixes.size },
);

// Layout — "MUST: Respect safe areas (`env(safe-area-inset-*)`)"
const safeArea = await page.evaluate(async () => {
  const css = await fetch("/styles.css").then((r) => r.text());
  return { usesEnvSafeArea: /env\(\s*safe-area-inset/.test(css) };
});
record("W12", "Layout", "MUST: Respect safe areas (`env(safe-area-inset-*)`)", "moderate", safeArea.usesEnvSafeArea, safeArea);

await desktop.close();

// ----------------------------------------------------------------- mobile pass
// "MUST: Hit target ≥24px (mobile ≥44px)" is a mobile measurement, so it is
// taken in a touch context at a real phone width, not inferred from the CSS.
const mobile = await browser.newContext({ viewport: { width: 386, height: 780 }, hasTouch: true, isMobile: true });
const mpage = await mobile.newPage();
await mpage.goto(`${site.base}/`, { waitUntil: "load" });
const targets = await mpage.$$eval("[data-testid]", (els) =>
  els
    .filter((el) => ["BUTTON", "A", "INPUT"].includes(el.tagName))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el: el.getAttribute("data-testid"), width: Math.round(r.width), height: Math.round(r.height) };
    }),
);
const mobileShot = await shot(mpage, "wig-mobile-targets-0386");
record(
  "W13",
  "Interactions > Targets & Input",
  "MUST: Hit target ≥24px (mobile ≥44px); if visual <24px, expand hit area",
  "major",
  targets.every((t) => t.height >= 44),
  { targets, viewportWidth: 386, screenshot: mobileShot },
);

// Interactions > Targets & Input — "NEVER: Disable browser zoom"
const viewportMeta = await mpage.$eval('meta[name="viewport"]', (el) => el.getAttribute("content"));
record("W14", "Interactions > Targets & Input", "NEVER: Disable browser zoom (`user-scalable=no`, `maximum-scale=1`)", "major", !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\d)/.test(viewportMeta), { viewportMeta });

await mobile.close();
await browser.close();
await site.close();

const unresolvedMajor = findings.filter((f) => f.severity === "major" && f.status === "fail");
const receipt = {
  schema: "proofloop-wig-review-v1",
  producer: "scripts/wig-review.mjs (npm run proofloop:wig-review)",
  condition: "PROMOTION gate condition 7 — Web Interface Guidelines review",
  notALighthouseScore: "Condition 8's Lighthouse/axe run is a separate artifact at promotion/evidence/web-audit/. These rules are not scored by Lighthouse and a score cannot stand in for this review.",
  guidelines: { url: GUIDELINES_URL, raw: GUIDELINES_RAW, fetched: "2026-08-13" },
  capturedAt: new Date().toISOString(),
  base: site.base,
  node: process.version,
  judgement: "promotion/evidence/wig/REVIEW.md",
  findings,
  counts: {
    total: findings.length,
    failed: findings.filter((f) => f.status === "fail").length,
    unresolvedMajor: unresolvedMajor.length,
  },
  pass: unresolvedMajor.length === 0,
};
writeFileSync(join(OUT, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

console.log(`${receipt.pass ? "PASS" : "FAIL"} WIG review -> ${join(OUT, "receipt.json")}`);
for (const f of findings.filter((x) => x.status === "fail")) console.log(`  ${f.severity === "major" ? "x" : "!"} ${f.id} [${f.severity}] ${f.section} — ${f.guideline}`);
process.exit(receipt.pass ? 0 : 1);
