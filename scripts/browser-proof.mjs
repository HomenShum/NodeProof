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
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
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

if (!existsSync(join(ROOT, "dist", "hosted.js"))) {
  console.error("dist/ is missing: run `npm run build` first (api/** handlers require dist/hosted.js).");
  process.exit(2);
}

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright not found: run `npm install` then `npx playwright install chromium`.");
  process.exit(2);
});

// ---------------------------------------------------------------- local server
// Serves public/ and mounts api/**/*.js exactly as Vercel routes them
// (cleanUrls: true -> /api/hosted/submit resolves api/hosted/submit.js).
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function apiHandlerPath(pathname) {
  if (!pathname.startsWith("/api/")) return null;
  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (rel.includes("..") || rel.split("/").some((part) => part.startsWith("_"))) return null;
  const file = join(ROOT, `${rel}.js`);
  return existsSync(file) ? file : null;
}

const responses = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.on("finish", () => responses.push({ method: req.method, path: url.pathname, status: res.statusCode }));
  const handlerPath = apiHandlerPath(url.pathname);
  if (handlerPath) {
    req.query = Object.fromEntries(url.searchParams);
    try {
      await require(handlerPath)(req, res);
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
    }
    return;
  }
  const file = join(ROOT, "public", url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
  if (!file.startsWith(join(ROOT, "public")) || !existsSync(file)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", MIME[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
});
// Bind explicitly on 127.0.0.1 and refuse to continue if the port is taken: a
// probe that silently measures somebody else's dev server proves nothing.
await new Promise((ok, fail) => {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      fail(new Error(`port ${PORT} is already in use — another server would be measured instead of this one. Re-run with --port <free port>.`));
      return;
    }
    fail(error);
  });
  server.listen(PORT, "127.0.0.1", ok);
}).catch((error) => {
  console.error(error.message);
  process.exit(2);
});
const BASE = `http://127.0.0.1:${PORT}`;

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
const emptyStateHidden = await page.$eval("[data-intake-status]", (el) => el.hidden);
check("empty state", emptyStateHidden, "status line should start hidden on first load");
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

// --- open defects the probe can see but does not fix, so a future fix flips a recorded field
const openDefects = [];
if (j5.status === "blocked") openDefects.push("D1 public/app.js:127 renders the machine enum \"blocked\" as the user-facing headline");
const statusAria = await page.$eval("[data-intake-status]", (el) => ({ role: el.getAttribute("role"), ariaLive: el.getAttribute("aria-live") }));
if (!statusAria.role && !statusAria.ariaLive) openDefects.push("D2 [data-intake-status] has no role=\"status\"/aria-live, so the only dynamic output is announced to nobody");

await browser.close();
await new Promise((ok) => server.close(ok));

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
    J5: { status: j5.status, httpStatus: submitResponse?.status, latencyMs: j5.latencyMs, screenshot: j5Shot, detail: j5.detail },
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
