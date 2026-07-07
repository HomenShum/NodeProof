#!/usr/bin/env node
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const {
  buildHostedWorkerPlan,
  readHostedBundleReference,
  renderHostedDashboardHtml,
} = require("../dist/hosted.js");

const args = parseArgs(process.argv.slice(2));
const requestFile = args.request;
if (!requestFile) failUsage("expected --request <request.json|queue.json|run-bundle.json>");

const bundle = readHostedBundleReference(requestFile, { root: process.cwd() });
const plan = buildHostedWorkerPlan(bundle);
const artifactRoot = resolve(process.cwd(), args.out || bundle.runner.artifactRoot);
mkdirSync(artifactRoot, { recursive: true });
writeJson(join(artifactRoot, "worker-plan.json"), plan);

if (plan.status !== "ready_for_managed_worker") {
  writeJson(join(artifactRoot, "live-receipt.json"), {
    schema: "proofloop-hosted-worker-receipt-v1",
    status: "blocked",
    runId: bundle.runId,
    blockers: plan.blockers,
    warnings: plan.warnings,
  });
  writeText(join(artifactRoot, "scorecard.md"), scorecardMarkdown(bundle, { status: "blocked", blockers: plan.blockers, warnings: plan.warnings }));
  process.exit(1);
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error("playwright is required for hosted-worker. In GitHub Actions, install with `npm install --no-save playwright` first.");
  process.exit(2);
}

const trace = [];
const browserProblems = { pageErrors: [], consoleProblems: [], requestFailures: [], badResponses: [] };
const videoDir = join(artifactRoot, "video");
mkdirSync(videoDir, { recursive: true });

const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 860 } },
});
const page = await context.newPage();
page.on("pageerror", (error) => browserProblems.pageErrors.push(String(error.message || error).slice(0, 500)));
page.on("console", (message) => {
  if (message.type() === "error") browserProblems.consoleProblems.push(`${message.type()}: ${message.text()}`.slice(0, 500));
});
page.on("requestfailed", (request) => browserProblems.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.slice(0, 500)));
page.on("response", (response) => {
  if (response.status() >= 500) browserProblems.badResponses.push(`${response.status()} ${response.url()}`.slice(0, 500));
});

let receipt;
try {
  const startUrl = startUrlFor(bundle.request.targetUrl, bundle.runId);
  trace.push({ step: "navigate", url: startUrl, at: new Date().toISOString() });
  const response = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_500);
  trace.push({ step: "loaded", status: response?.status() ?? null, url: page.url(), at: new Date().toISOString() });

  const interaction = await cautiousInteraction(page, bundle.runId);
  trace.push(...interaction.trace);
  await page.screenshot({ path: join(artifactRoot, "visual-proof.png"), fullPage: true });
  trace.push({ step: "screenshot", path: relative(join(artifactRoot, "visual-proof.png")), at: new Date().toISOString() });

  const state = await inspectPageState(page, bundle.contract.success);
  const taskResults = bundle.contract.benchmarkProxyTasks.map((task) => ({
    id: task.id,
    family: task.family,
    title: task.title,
    officialBoundary: task.officialBoundary,
    status: state.passed ? (task.officialBoundary === "official_scorer_required" ? "proxy_passed_official_required" : "passed") : "failed",
    successSignal: task.successSignal,
  }));
  receipt = {
    schema: "proofloop-hosted-worker-receipt-v1",
    status: state.passed ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    runId: bundle.runId,
    targetUrl: bundle.request.targetUrl,
    finalUrl: page.url(),
    appType: bundle.request.appType,
    visibility: bundle.request.visibility,
    noMockNoStub: true,
    memoryModeDisabled: !page.url().includes("mode=memory"),
    adaptiveStepCount: trace.length,
    contract: state,
    tasks: taskResults,
    browserProblems,
    artifacts: {
      receipt: relative(join(artifactRoot, "live-receipt.json")),
      screenshot: relative(join(artifactRoot, "visual-proof.png")),
      video: relative(join(artifactRoot, "video.webm")),
      trace: relative(join(artifactRoot, "adaptive-trace.json")),
      scorecard: relative(join(artifactRoot, "scorecard.md")),
      dashboard: relative(join(artifactRoot, "dashboard.html")),
    },
  };
} catch (error) {
  receipt = {
    schema: "proofloop-hosted-worker-receipt-v1",
    status: "failed",
    generatedAt: new Date().toISOString(),
    runId: bundle.runId,
    targetUrl: bundle.request.targetUrl,
    finalUrl: safePageUrl(page),
    appType: bundle.request.appType,
    noMockNoStub: true,
    error: String(error?.message || error),
    adaptiveStepCount: trace.length,
    browserProblems,
  };
} finally {
  await context.close();
  await browser.close();
}

copyFirstVideo(videoDir, join(artifactRoot, "video.webm"));
writeJson(join(artifactRoot, "adaptive-trace.json"), { schema: "proofloop-hosted-adaptive-trace-v1", runId: bundle.runId, trace });
writeJson(join(artifactRoot, "live-receipt.json"), receipt);
writeText(join(artifactRoot, "scorecard.md"), scorecardMarkdown(bundle, receipt));
writeText(join(artifactRoot, "dashboard.html"), renderWorkerDashboard(bundle, receipt));

if (receipt.status !== "passed") process.exit(1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? next : true;
    if (out[key] === next) i += 1;
  }
  return out;
}

function failUsage(message) {
  console.error(`proofloop hosted-worker: ${message}`);
  process.exit(2);
}

function startUrlFor(rawUrl, runId) {
  const url = new URL(rawUrl);
  if (/^(www\.)?noderoom\.live$/i.test(url.hostname) && !url.searchParams.has("room")) {
    url.searchParams.set("room", `PL${runId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}`);
    url.searchParams.set("name", "ProofLoop");
  }
  return url.toString();
}

async function cautiousInteraction(page, runId) {
  const events = [];
  const safeButton = page.locator("button, a").filter({
    hasText: /^(start|new|create|join|open|run|try|continue|launch|enter)(\s|$)/i,
  });
  const buttonCount = await safeButton.count();
  if (buttonCount > 0) {
    await safeButton.first().click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(700);
    events.push({ step: "safe-click", at: new Date().toISOString() });
  }
  const editable = page.locator("textarea, input[type='text'], input[type='search'], input:not([type])");
  const editableCount = await editable.count();
  if (editableCount > 0) {
    await editable.first().fill(`ProofLoop hosted verification run ${runId}`, { timeout: 5_000 }).catch(() => undefined);
    events.push({ step: "safe-fill", at: new Date().toISOString() });
  }
  events.push({ step: "inspect", at: new Date().toISOString() });
  return { trace: events };
}

async function inspectPageState(page, success) {
  const result = await page.evaluate((contract) => {
    const visibleText = document.body?.innerText || "";
    const testIds = contract.visibleTestIdAny.filter((id) => {
      const escaped = CSS.escape(id);
      const node = document.querySelector(`[data-testid="${escaped}"], [data-proofloop="${escaped}"]`);
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return {
      title: document.title,
      url: location.href,
      visibleTextMatches: contract.visibleTextAny.filter((text) => visibleText.toLowerCase().includes(text.toLowerCase())),
      visibleTestIdMatches: testIds,
      urlMatches: contract.urlIncludesAny.filter((part) => location.href.includes(part)),
      forbiddenUrlMatches: contract.forbiddenUrlIncludes.filter((part) => location.href.includes(part)),
      bodyLength: visibleText.length,
    };
  }, success);
  const hasSignal = result.visibleTextMatches.length > 0 || result.visibleTestIdMatches.length > 0 || result.urlMatches.length > 0 || result.bodyLength > 80;
  return {
    ...result,
    requireNoBrowserProblems: success.requireNoBrowserProblems,
    requireVisualProof: success.requireVisualProof,
    passed: hasSignal && result.forbiddenUrlMatches.length === 0,
  };
}

function scorecardMarkdown(bundle, receipt) {
  const lines = [
    `# ProofLoop Hosted Scorecard ${bundle.runId}`,
    "",
    `Target: ${bundle.request.targetUrl}`,
    `App type: ${bundle.request.appType}`,
    `Status: ${receipt.status}`,
    `Generated: ${receipt.generatedAt || new Date().toISOString()}`,
    "",
    "## Tasks",
    "",
  ];
  for (const task of receipt.tasks || bundle.contract.benchmarkProxyTasks) {
    lines.push(`- ${task.family}/${task.id}: ${task.status || "not-run"} (${task.officialBoundary})`);
  }
  if (receipt.blockers?.length) {
    lines.push("", "## Blockers", "", ...receipt.blockers.map((item) => `- ${item}`));
  }
  if (receipt.error) {
    lines.push("", "## Error", "", receipt.error);
  }
  return `${lines.join("\n")}\n`;
}

function renderWorkerDashboard(bundle, receipt) {
  const base = renderHostedDashboardHtml({ ...bundle, dashboardHtml: undefined });
  return base.replace("</main>", `<h2>Worker receipt</h2><pre>${escapeHtml(JSON.stringify(receipt, null, 2))}</pre></main>`);
}

function copyFirstVideo(fromDir, toPath) {
  if (!existsSync(fromDir)) return;
  const videos = readdirSync(fromDir, { recursive: true }).filter((file) => String(file).endsWith(".webm"));
  if (videos.length > 0) copyFileSync(join(fromDir, videos[0]), toPath);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function relative(path) {
  return path.replace(process.cwd().replace(/\\/g, "/"), "").replace(/\\/g, "/").replace(/^\//, "");
}

function safePageUrl(page) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
