#!/usr/bin/env node
/**
 * Record the gate demo honestly: a scripted terminal session, not a staged one.
 *
 * The script builds a throwaway node project whose "done" is a lie (add()
 * subtracts), then actually runs THIS WORKING TREE's build:
 *
 *     node <repo>/dist/cli.js init
 *     node <repo>/dist/cli.js gate   -> must FAIL (exit 1) or this script aborts
 *     (one-line fix to app.js)
 *     node <repo>/dist/cli.js gate   -> must PASS (exit 0) or this script aborts
 *
 * Not `npx proofloop`: npx resolves the PUBLISHED package, so a clip recorded
 * that way would prove someone else's build, not the commit it ships beside.
 *
 * Every output line in the clip is verbatim captured stdout/stderr from those
 * real runs; the only edit is shortening the throwaway project's absolute
 * temp path to ~/tiny-app for readability. The transcript is replayed
 * frame-by-frame through a terminal-styled HTML page (Playwright screenshots,
 * 8 fps) and assembled into a GIF with ffmpeg. An animated clip, not a still,
 * on purpose: refuse-then-pass is a sequence — a single frame could not show
 * the gate first refusing and later accepting.
 *
 * Needs: `npm i --no-save playwright` (browsers via `npx playwright install
 * chromium`) and ffmpeg on PATH. package.json stays untouched.
 *
 * Run: node scripts/record-gate-demo.mjs
 * Output: docs/media/gate-demo.gif (+ docs/media/gate-demo-transcript.txt)
 */
import { spawnSync, execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright not found: run `npm i --no-save playwright` first");
  process.exit(1);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_GIF = path.join(ROOT, "docs/media/gate-demo.gif");
const OUT_TXT = path.join(ROOT, "docs/media/gate-demo-transcript.txt");

// --- 1. Throwaway fixture: a tiny app whose test is honest and whose code is wrong.
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "proofloop-demo-"));
await fs.writeFile(
  path.join(fixture, "package.json"),
  JSON.stringify({ name: "tiny-app", version: "1.0.0", scripts: { test: "node test.js" } }, null, 2) + "\n",
);
await fs.writeFile(
  path.join(fixture, "test.js"),
  'const assert = require("assert");\nconst { add } = require("./app.js");\nassert.strictEqual(add(2, 3), 5);\nconsole.log("test ok: add(2,3)=5");\n',
);
const BUGGY = "module.exports = { add: (a, b) => a - b };\n"; // the agent's "done"
const FIXED = "module.exports = { add: (a, b) => a + b };\n";
await fs.writeFile(path.join(fixture, "app.js"), BUGGY);

// --- 2. Real runs, verbatim capture.
function run(cmd) {
  const r = spawnSync(cmd, { cwd: fixture, shell: true, encoding: "utf8" });
  return { cmd, out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status };
}
const CLI = `node "${path.join(ROOT, "dist/cli.js")}"`;
const init = run(`${CLI} init`);
const gateFail = run(`${CLI} gate`);
if (gateFail.code !== 1) {
  console.error(`expected the gate to REFUSE (exit 1), got exit ${gateFail.code}:\n${gateFail.out}`);
  process.exit(1);
}
await fs.writeFile(path.join(fixture, "app.js"), FIXED);
const gatePass = run(`${CLI} gate`);
if (gatePass.code !== 0) {
  console.error(`expected the gate to PASS (exit 0), got exit ${gatePass.code}:\n${gatePass.out}`);
  process.exit(1);
}

// --- 3. Transcript: command lines + verbatim output (temp path shortened only).
const shorten = (s) => s.split(fixture.replace(/\//g, "\\")).join("~/tiny-app").split(fixture).join("~/tiny-app");
const lines = [];
const push = (seg, note) => {
  lines.push({ t: "cmd", s: `$ ${seg.cmd.split(CLI).join("node dist/cli.js")}${note ? "   # " + note : ""}` });
  for (const l of shorten(seg.out).replace(/\r/g, "").trimEnd().split("\n")) lines.push({ t: "out", s: l });
  lines.push({ t: "out", s: "" });
};
lines.push({ t: "cmd", s: "$ ls   # throwaway project; the agent just claimed \u201cdone\u201d" });
lines.push({ t: "out", s: "app.js  package.json  test.js" });
lines.push({ t: "out", s: "" });
push(init);
push(gateFail, "the gate decides whether \u201cdone\u201d is true");
lines.push({ t: "cmd", s: "$ # one-line fix in app.js:" });
lines.push({ t: "diff-", s: "-module.exports = { add: (a, b) => a - b };" });
lines.push({ t: "diff+", s: "+module.exports = { add: (a, b) => a + b };" });
lines.push({ t: "out", s: "" });
push(gatePass);
await fs.mkdir(path.dirname(OUT_TXT), { recursive: true });
await fs.writeFile(OUT_TXT, lines.map((l) => l.s).join("\n") + "\n");

// --- 4. Frame-by-frame replay: reveal one line per frame at 8 fps, with holds
// after the refusal and the pass so both verdicts are readable.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lineHtml = (l) => {
  let cls = l.t;
  let s = esc(l.s);
  if (/FAILED/.test(l.s)) cls += " fail";
  if (/PASSED/.test(l.s)) cls += " pass";
  return `<div class="ln ${cls}">${s || "&nbsp;"}</div>`;
};
const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #0d1117; }
  #term { box-sizing: border-box; width: 960px; height: 600px; overflow: hidden;
    padding: 18px 22px; font: 13px/1.5 Consolas, "Cascadia Code", monospace;
    color: #c9d1d9; white-space: pre; }
  .ln { display: none; }
  .cmd { color: #7ee787; font-weight: 600; }
  .fail { color: #ff7b72; font-weight: 600; }
  .pass { color: #58a6ff; font-weight: 600; }
  .diff- { color: #ff7b72; }
  .diff\\+ { color: #7ee787; }
</style>
<div id="term">${lines.map(lineHtml).join("")}</div>
<script>
  window.reveal = (n) => {
    const all = [...document.querySelectorAll(".ln")];
    all.forEach((el, i) => { el.style.display = i < n ? "block" : "none"; });
    const term = document.getElementById("term");
    term.scrollTop = term.scrollHeight;
  };
</script>`;

const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-frames-"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.setContent(html);

const holdAfter = new Map(); // line index -> extra frames
lines.forEach((l, i) => {
  if (/FAILED|PASSED/.test(l.s)) holdAfter.set(i + 1, 14); // ~1.75s pause on verdicts
});
let frame = 0;
const shoot = async () =>
  page.screenshot({ path: path.join(frameDir, `f${String(frame++).padStart(4, "0")}.png`) });
for (let n = 1; n <= lines.length; n++) {
  await page.evaluate((k) => window.reveal(k), n);
  await shoot();
  for (let h = 0; h < (holdAfter.get(n) ?? 0); h++) await shoot();
}
for (let h = 0; h < 16; h++) await shoot(); // final hold
await browser.close();

await fs.mkdir(path.dirname(OUT_GIF), { recursive: true });
execSync(
  `ffmpeg -y -framerate 8 -i f%04d.png -vf "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" "${OUT_GIF}"`,
  { cwd: frameDir, stdio: "pipe" },
);
await fs.rm(frameDir, { recursive: true, force: true });
await fs.rm(fixture, { recursive: true, force: true });

const size = (await fs.stat(OUT_GIF)).size;
console.log(`gate refused (exit 1) then passed (exit 0); ${frame} frames at 8 fps (~${(frame / 8).toFixed(1)}s)`);
console.log(`clip: ${path.relative(ROOT, OUT_GIF)} (${(size / 1e6).toFixed(2)} MB)`);
console.log(`transcript: ${path.relative(ROOT, OUT_TXT)}`);
if (size > 8_000_000) {
  console.error("FAILED: gif exceeds 8MB");
  process.exit(1);
}
