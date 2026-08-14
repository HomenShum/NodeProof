#!/usr/bin/env node
/**
 * The committed browser probe for proofloop.live — the thing `npm run demo`
 * reports this repo as missing ("Playwright/browser proof dependency or config").
 *
 * Why it exists: `public/` is a static Vercel deploy with `api/**` as functions,
 * so there was no committed way to *start* the landing page locally. Every
 * browser measurement in the Wave 1 baseline was therefore taken through a
 * throwaway harness and a browser session that died with it, which is why five
 * scorecard rows were downgraded from PASS to UNVERIFIED. This script is the
 * missing half: it serves `public/` with the repo's own `api/**` handlers
 * mounted unchanged, drives journeys J4 and J5 in a real Chromium, and writes
 * both the screenshots and a machine-readable receipt into promotion/evidence/.
 *
 * Exits 0 only when every journey completed, no width overflowed, no page-origin
 * console error or failed request occurred, and load stayed inside the budget.
 *
 *   npm run build && npm run proofloop:browser-proof
 *   (browsers: npx playwright install chromium)
 *
 * Flags: --port <n> (default 4310)  --headed  --out <dir>
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, startPublicServer } from "./serve-public.mjs";

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
// 4310 on purpose: 3000/4173/5173/8787 collide with the dev servers people already run.
const PORT = Number(flag("port", 4310));
const OUT = resolve(ROOT, flag("out", "promotion/evidence/browser-proof"));
const HEADED = argv.includes("--headed");

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright not found: run `npm install` then `npx playwright install chromium`.");
  process.exit(2);
});

// ---------------------------------------------------------------- local server
// scripts/serve-public.mjs — the same surface the Lighthouse/axe audit measures.
const site = await startPublicServer(PORT).catch((error) => {
  console.error(error.message);
  process.exit(2);
});
const { base: BASE, responses } = site;

// ------------------------------------------------------------------- the probe
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
  return condition;
};

const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ text: m.text().slice(0, 400), url: m.location()?.url || "" });
});
page.on("pageerror", (e) => pageErrors.push(String(e.message || e).slice(0, 400)));
page.on("requestfailed", (r) => requestFailures.push(`${r.method()} ${r.url()} ${r.failure()?.errorText || ""}`.slice(0, 400)));

const shot = async (name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return `promotion/evidence/browser-proof/${name}.png`;
};
const statusText = () => page.$eval("[data-intake-status]", (el) => el.textContent.trim());
const detailText = () => page.$eval("[data-intake-detail]", (el) => el.textContent.trim());

// --- first load: empty state + timings (conditions 5 "empty", 10)
await page.goto(BASE, { waitUntil: "load" });
const timings = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const bytes = performance.getEntriesByType("resource").reduce((sum, r) => sum + (r.transferSize || 0), 0);
  return {
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadMs: Math.round(nav.loadEventEnd),
    sameOriginTransferBytes: Math.round(bytes),
  };
});
// Was: check("empty state", el.hidden, "status line should start hidden on first
// load"). The `hidden` attribute is gone on purpose — a live region has to be in
// the accessibility tree before its text changes or the change is never
// announced (WCAG 4.1.3 / the WIG rule "MUST: Use polite `aria-live`"), which
// was defect D2. The user-facing property the old assertion was reaching for is
// "nothing is said before you ask", so that is what is asserted now, plus the
// live region being present and empty.
const emptyState = await page.$eval("[data-intake-status]", (el) => ({
  text: el.textContent.trim(),
  role: el.getAttribute("role"),
  ariaLive: el.getAttribute("aria-live"),
  detailHidden: document.querySelector("[data-intake-detail]").hidden,
}));
check("empty state", emptyState.text === "" && emptyState.detailHidden, `status/detail not empty on first load: ${JSON.stringify(emptyState)}`);
check("status is a live region before it changes", emptyState.role === "status" && emptyState.ariaLive === "polite", `got role=${emptyState.role} aria-live=${emptyState.ariaLive}`);
check("condition 10 load budget", timings.domContentLoadedMs < 3000, `domContentLoaded ${timings.domContentLoadedMs}ms >= 3000ms`);
const emptyShot = await shot("j4-01-empty-1280");

// --- J4: GitHub repo intake -> the four commands
await page.fill("[data-testid=\"target-input\"]", "HomenShum/NodeProof");
await page.click("[data-testid=\"target-submit\"]");
await page.waitForSelector("[data-intake-detail]:not([hidden])");
const j4 = { status: await statusText(), detail: await detailText() };
const J4_COMMANDS = ["git clone", "npx proofloop init --agent auto --live", "npx proofloop maturity --target-level 5 --write", "npx proofloop gate"];
check("J4 status", j4.status === "GitHub repo target ready.", `got ${JSON.stringify(j4.status)}`);
for (const command of J4_COMMANDS) check("J4 command block", j4.detail.includes(command), `missing ${JSON.stringify(command)}`);
check("J4 does not queue github.com", !responses.some((r) => r.path === "/api/hosted/submit"), "github.com target must not reach the hosted submit endpoint");
const j4Shot = await shot("j4-02-repo-ready-1280");

// --- J4b: Enter-to-submit (public/app.js:139) — the baseline could not confirm this
await page.goto(BASE, { waitUntil: "load" });
await page.click("[data-testid=\"target-input\"]");
await page.keyboard.type("HomenShum/NodeProof");
await page.keyboard.press("Enter");
await page.waitForSelector("[data-intake-detail]:not([hidden])");
const enterKeySubmits = (await statusText()) === "GitHub repo target ready.";
check("J4 Enter-to-submit", enterKeySubmits, "Enter key did not submit");

// --- J5: unverified live URL -> refusal receipt
await page.goto(BASE, { waitUntil: "load" });
await page.fill("[data-testid=\"target-input\"]", "https://example.com");
const clickedAt = Date.now();
await page.click("[data-testid=\"target-submit\"]");
await page.waitForSelector("[data-intake-detail]:not([hidden])", { timeout: 30000 });
const j5 = { status: await statusText(), detail: await detailText(), latencyMs: Date.now() - clickedAt };
for (const fragment of ["\"host\": \"example.com\"", "well-known-token", "proofloop-domain-example-com-verify", "blockers"]) {
  check("J5 refusal receipt", j5.detail.includes(fragment), `missing ${JSON.stringify(fragment)}`);
}
const submitResponse = responses.filter((r) => r.path === "/api/hosted/submit").pop();
check("J5 refusal is a stated refusal", submitResponse?.status === 400, `POST /api/hosted/submit -> ${submitResponse?.status}`);
const j5Shot = await shot("j5-01-refused-1280");

// --- condition 5, the pending state. The scorecard said it "was never observed
// — the response returned faster than a capture", which is an honest reason and
// also a solvable one: hold the response open and the real page renders its real
// pending state. Nothing is faked; only the network is slowed.
await page.goto(BASE, { waitUntil: "load" });
await page.route("**/api/hosted/submit", async (route) => {
  await new Promise((ok) => setTimeout(ok, 900));
  await route.continue();
});
await page.fill("[data-testid=\"target-input\"]", "https://example.com");
await page.click("[data-testid=\"target-submit\"]");
await page.waitForFunction(() => document.querySelector("[data-intake-status]").getAttribute("data-kind") === "pending", null, { timeout: 5000 });
const pending = await page.evaluate(() => ({
  statusText: document.querySelector("[data-intake-status]").textContent.trim(),
  submitDisabled: document.querySelector("[data-testid=\"target-submit\"]").disabled,
  submitLabel: document.querySelector("[data-testid=\"target-submit\"]").textContent.trim(),
}));
const pendingShot = await shot("j5-02-pending-1280");
check("condition 5 pending state", pending.statusText === "Submitting…" && pending.submitDisabled, `pending state was ${JSON.stringify(pending)}`);
// WIG Forms: "MUST: Loading buttons ... keep original label".
check("pending keeps the button label", pending.submitLabel === "ProofLoop", `label became ${JSON.stringify(pending.submitLabel)}`);
await page.waitForSelector("[data-intake-detail]:not([hidden])", { timeout: 30000 });
await page.unroute("**/api/hosted/submit");

// --- conditions 3 and 4: layout measured, not read off the CSS
const widths = [316, 386, 620, 768, 1280, 2560];
const layout = [];
for (const width of widths) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(120); // let the media query settle before measuring
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    intakeColumns: getComputedStyle(document.querySelector(".intake")).gridTemplateColumns.split(" ").length,
    buttonWidth: Math.round(document.querySelector("[data-testid=\"target-submit\"]").getBoundingClientRect().width),
    h1FontSizePx: Math.round(parseFloat(getComputedStyle(document.querySelector("h1")).fontSize)),
  }));
  const overflow = measured.scrollWidth - measured.clientWidth;
  layout.push({ width, ...measured, overflowPx: overflow, stacked: measured.intakeColumns === 1 });
  check("condition 4 no horizontal overflow", overflow <= 0, `${width}px overflowed by ${overflow}px (with the J5 refusal JSON rendered)`);
  await shot(`layout-${String(width).padStart(4, "0")}px`);
}
// condition 3: the two ends of the range must not be the same layout, or nothing was intentional
const narrow = layout.find((l) => l.width === 386);
const wide = layout.find((l) => l.width === 1280);
check("condition 3 mobile is intentional", narrow.stacked && narrow.buttonWidth > narrow.width * 0.8, `386px: columns=${narrow.intakeColumns} button=${narrow.buttonWidth}px`);
check("condition 3 desktop is intentional", !wide.stacked, `1280px: columns=${wide.intakeColumns}`);
check("condition 3 type scales", wide.h1FontSizePx > narrow.h1FontSizePx, `h1 ${narrow.h1FontSizePx}px at 386 vs ${wide.h1FontSizePx}px at 1280`);

// --- condition 9: console, page errors, network.
// The condition is "no *unexplained* console errors and no failed requests".
// J5's done-when IS a refusal, so the 400 from /api/hosted/submit is the product
// working; Chromium additionally echoes every non-2xx fetch into the console as
// "Failed to load resource", so the one refusal must be explained in both places
// or the gate punishes the page for refusing correctly. Anything else — any
// other path, any other status — stays a failure. Both lists ship in the receipt.
const isExplainedRefusal = (r) => r.path === "/api/hosted/submit" && r.status === 400;
const isRefusalEcho = (e) => e.url.endsWith("/api/hosted/submit") && /status of 400/.test(e.text);
const explainedConsoleErrors = consoleErrors.filter(isRefusalEcho);
const unexplainedConsoleErrors = consoleErrors.filter((e) => !isRefusalEcho(e));
const unexplainedResponses = responses.filter((r) => r.status >= 400 && !isExplainedRefusal(r));
check("condition 9 no unexplained console errors", unexplainedConsoleErrors.length === 0, unexplainedConsoleErrors.map((e) => `${e.text} @ ${e.url}`).join(" | "));
check("condition 9 no page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("condition 9 no failed requests", requestFailures.length === 0, requestFailures.join(" | "));
check("condition 9 no unexplained non-2xx", unexplainedResponses.length === 0, unexplainedResponses.map((r) => `${r.status} ${r.method} ${r.path}`).join(" | "));

// --- the two defects this probe was written to record. They are now fixed, so
// the same fields that recorded them are the regression check: if either comes
// back, `openDefects` refills and the run fails instead of quietly re-shipping.
const MACHINE_ENUMS = ["blocked", "queued", "pending", "dispatch_failed", "ok", "error"];
const statusAria = await page.$eval("[data-intake-status]", (el) => ({ role: el.getAttribute("role"), ariaLive: el.getAttribute("aria-live") }));
const d1Open = MACHINE_ENUMS.includes(j5.status.toLowerCase());
const d2Open = !statusAria.role && !statusAria.ariaLive;
const openDefects = [];
if (d1Open) openDefects.push("D1 public/app.js renders a machine enum as the user-facing headline");
if (d2Open) openDefects.push("D2 [data-intake-status] has no role=\"status\"/aria-live, so the only dynamic output is announced to nobody");
check("D1 stays fixed: the refusal headline is a sentence, not an enum", !d1Open, `J5 headline is ${JSON.stringify(j5.status)}`);
check("D2 stays fixed: the status region is announced", !d2Open, "no role/aria-live on [data-intake-status]");

await browser.close();
await site.close();

const receipt = {
  schema: "proofloop-browser-proof-v1",
  producer: "scripts/browser-proof.mjs (npm run proofloop:browser-proof)",
  capturedAt: new Date().toISOString(),
  base: BASE,
  node: process.version,
  playwright: require("playwright/package.json").version,
  pass: failures.length === 0,
  failures,
  journeys: {
    J4: { status: j4.status, commands: J4_COMMANDS, screenshots: [emptyShot, j4Shot], enterKeySubmits },
    J5: { status: j5.status, httpStatus: submitResponse?.status, latencyMs: j5.latencyMs, screenshot: j5Shot, detail: j5.detail, pending: { ...pending, screenshot: pendingShot, note: "captured with the response held open 900ms by page.route; the page is unmodified" } },
  },
  layout,
  timings,
  console: {
    unexplainedErrors: unexplainedConsoleErrors,
    explainedErrors: explainedConsoleErrors.map((e) => ({ ...e, explanation: "J5 refusal: /api/hosted/submit answers an unverified host with 400 by design" })),
    pageErrors,
    requestFailures,
  },
  responses,
  openDefects,
};
writeFileSync(join(OUT, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

console.log(`${receipt.pass ? "PASS" : "FAIL"} browser proof -> ${join(OUT, "receipt.json")}`);
for (const failure of failures) console.error(`  x ${failure}`);
for (const defect of openDefects) console.log(`  ! open defect (recorded, not fixed): ${defect}`);
process.exit(receipt.pass ? 0 : 1);
