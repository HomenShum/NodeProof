#!/usr/bin/env node
/**
 * Condition 8 — the web-quality audit (accessibility, performance, Core Web
 * Vitals) — run by two external tools against the same local surface
 * scripts/browser-proof.mjs drives, so the two receipts describe one page.
 *
 * Why it exists: rows 7 and 8 sat UNVERIFIED with the reason "no audit tool was
 * installed in the time box". That is an honest UNVERIFIED and also a to-do
 * list. This is the tool, committed, with its output committed next to it.
 *
 * It shells out to the published CLIs on purpose rather than importing
 * Lighthouse programmatically: the command in the receipt is then the literal
 * command a reader can paste, and the audit result cannot be shaped by
 * configuration this repo wrote.
 *
 *   npm run build && npm run proofloop:web-audit
 *   (requires network for `npx --yes`, and a local Chrome for both tools)
 *
 * Flags: --port <n> (default 4909)  --out <dir>
 *
 * Exits 1 when a major finding is present. "Major" is defined once, here, from
 * the tools' own vocabulary — axe impact serious/critical, and Google's own
 * "good" Core Web Vitals thresholds — never from what this page happens to score.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT, startPublicServer } from "./serve-public.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const PORT = Number(flag("port", 4909));
const OUT = resolve(ROOT, flag("out", "promotion/evidence/web-audit"));

// Pinned versions: an audit whose tool version drifts is not re-runnable.
const LIGHTHOUSE = "lighthouse@13.4.1";
const AXE = "@axe-core/cli@4.13.0";

// Thresholds are the tools'/Google's, not this page's. Written down before the
// run so a bad score cannot quietly become the new bar.
const THRESHOLDS = {
  lighthouseAccessibility: 0.9,
  lighthousePerformance: 0.9,
  lighthouseBestPractices: 0.9,
  lcpMs: 2500, // Google "good" LCP
  clsScore: 0.1, // Google "good" CLS
  axeMajorImpacts: ["serious", "critical"],
};

mkdirSync(OUT, { recursive: true });
// Forward slashes because these paths are handed to a shell. (They were the
// first suspect when the early runs produced no report; they were innocent —
// see the `spawn` note below for what it actually was.)
const posix = (p) => p.replace(/\\/g, "/");
const OUT_REL = posix(relative(ROOT, OUT));
const lighthouseJson = join(OUT, "lighthouse.json");
const axeJson = join(OUT, "axe.json");

const site = await startPublicServer(PORT).catch((error) => {
  console.error(error.message);
  process.exit(2);
});
const url = `${site.base}/`;

/**
 * `spawn`, never `spawnSync`. The server being audited lives in THIS process, and
 * spawnSync blocks the event loop — so the page under test cannot answer a single
 * request while the auditor is running. Two runs died that way: Lighthouse sat
 * through six minutes of PROTOCOL_TIMEOUT and gave up with
 * "The page did not paint any content (NO_FCP)", which reads like a page defect
 * and is actually the probe holding the door shut. The whole tool log is kept
 * next to the report so the next such failure is diagnosable from the artifact.
 */
const run = (label, command) =>
  new Promise((resolve) => {
    console.log(`> ${command}`);
    const started = Date.now();
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      // The whole log, not a tail: the first failure of this script was
      // undiagnosable because only the last 2 KB was kept and the cause was
      // in the first 2 KB.
      writeFileSync(join(OUT, `${label}.log`), `$ ${command}\n\n${output}`);
      console.log(`  exit ${code} in ${Date.now() - started}ms -> ${OUT_REL}/${label}.log`);
      resolve({ label, command, exitCode: code, elapsedMs: Date.now() - started, log: `${OUT_REL}/${label}.log` });
    });
  });

// Sequential, not Promise.all: two headless Chromes fighting for the same
// machine is how the axe run failed with "Timed out receiving message from
// renderer" the one time they overlapped.
// --chrome-flags is unquoted so the value survives both cmd.exe and a POSIX
// shell without a layer of quotes reaching Chrome as part of the flag.
const commands = [];
// Both paths are relative to the working directory, so the command this receipt
// records is one a reader can paste. An absolute path would bake this machine's
// home directory into a committed artifact — and axe's --save *joins* its
// argument onto the current directory anyway, so an absolute one becomes
// `<cwd>\C:\...` and the run ends "Unable to save file!" after a clean audit.
const out = (file) => posix(relative(process.cwd(), file));
commands.push(await run("lighthouse", `npx --yes ${LIGHTHOUSE} ${url} --output=json --output-path="${out(lighthouseJson)}" --chrome-flags=--headless`));
commands.push(await run("axe", `npx --yes ${AXE} ${url} --save "${out(axeJson)}"`));

await site.close();

const failures = [];
const majorFindings = [];

// ------------------------------------------------------------------ lighthouse
let lighthouse = null;
if (existsSync(lighthouseJson)) {
  const report = JSON.parse(readFileSync(lighthouseJson, "utf8"));
  const score = (id) => (report.categories?.[id]?.score ?? null);
  const numeric = (id) => (report.audits?.[id]?.numericValue ?? null);
  lighthouse = {
    lighthouseVersion: report.lighthouseVersion,
    userAgent: report.environment?.hostUserAgent,
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      "best-practices": score("best-practices"),
      seo: score("seo"),
    },
    coreWebVitals: {
      largestContentfulPaintMs: numeric("largest-contentful-paint"),
      cumulativeLayoutShift: numeric("cumulative-layout-shift"),
      totalBlockingTimeMs: numeric("total-blocking-time"),
      firstContentfulPaintMs: numeric("first-contentful-paint"),
      speedIndexMs: numeric("speed-index"),
    },
    // Every audit the tool itself scored as failing, in its own words.
    failingAudits: Object.values(report.audits ?? {})
      .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable")
      .map((a) => ({ id: a.id, title: a.title, score: a.score })),
  };
  const check = (name, value, min) => {
    if (value === null) {
      failures.push(`lighthouse ${name}: category missing from report`);
      return;
    }
    if (value < min) majorFindings.push(`lighthouse ${name} ${value} < ${min}`);
  };
  check("accessibility", lighthouse.scores.accessibility, THRESHOLDS.lighthouseAccessibility);
  check("performance", lighthouse.scores.performance, THRESHOLDS.lighthousePerformance);
  check("best-practices", lighthouse.scores["best-practices"], THRESHOLDS.lighthouseBestPractices);
  if (lighthouse.coreWebVitals.largestContentfulPaintMs > THRESHOLDS.lcpMs) {
    majorFindings.push(`LCP ${Math.round(lighthouse.coreWebVitals.largestContentfulPaintMs)}ms > ${THRESHOLDS.lcpMs}ms`);
  }
  if (lighthouse.coreWebVitals.cumulativeLayoutShift > THRESHOLDS.clsScore) {
    majorFindings.push(`CLS ${lighthouse.coreWebVitals.cumulativeLayoutShift} > ${THRESHOLDS.clsScore}`);
  }
} else {
  failures.push(`lighthouse produced no report at ${lighthouseJson}`);
}

// ------------------------------------------------------------------------ axe
let axe = null;
if (existsSync(axeJson)) {
  const report = JSON.parse(readFileSync(axeJson, "utf8"));
  const page = Array.isArray(report) ? report[0] : report;
  const violations = page?.violations ?? [];
  axe = {
    axeVersion: page?.testEngine?.version ?? null,
    url: page?.url ?? null,
    counts: {
      violations: violations.length,
      passes: (page?.passes ?? []).length,
      incomplete: (page?.incomplete ?? []).length,
    },
    violations: violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: (v.nodes ?? []).map((n) => n.target?.join(" ")).slice(0, 5),
    })),
  };
  for (const v of axe.violations) {
    if (THRESHOLDS.axeMajorImpacts.includes(v.impact)) majorFindings.push(`axe ${v.impact}: ${v.id} — ${v.help}`);
  }
} else {
  failures.push(`axe produced no report at ${axeJson}`);
}

const receipt = {
  schema: "proofloop-web-audit-v1",
  producer: "scripts/web-audit.mjs (npm run proofloop:web-audit)",
  condition: "PROMOTION gate condition 8 — web-quality audit (accessibility, performance, Core Web Vitals)",
  capturedAt: new Date().toISOString(),
  base: url,
  node: process.version,
  tools: { lighthouse: LIGHTHOUSE, axe: AXE },
  thresholds: THRESHOLDS,
  commands,
  lighthouse,
  axe,
  majorFindings,
  failures,
  pass: failures.length === 0 && majorFindings.length === 0,
};
writeFileSync(join(OUT, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

console.log(`${receipt.pass ? "PASS" : "FAIL"} web audit -> ${join(OUT, "receipt.json")}`);
for (const failure of failures) console.error(`  x ${failure}`);
for (const finding of majorFindings) console.error(`  ! major: ${finding}`);
process.exit(receipt.pass ? 0 : 1);
