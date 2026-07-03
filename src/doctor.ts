/**
 * `proofloop doctor` -- environment + readiness report. Exit 0 ALWAYS (it's a
 * report, not a gate). Reports: node version (warn if <20), git present +
 * is-a-git-repo, which coding-agent workers are on PATH (claude, codex),
 * whether .claude/ exists, whether hooks are installed, whether a config exists.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { configExists } from "./config";
import { detectWorkers, isGitAvailable, isGitRepo } from "./detect";
import { proofloopHooksStatus } from "./proofloopHooks";
import { buildProofloopProjectManifest } from "./project";

export const MINIMUM_NODE_MAJOR = 20;

export type DoctorReport = {
  node: { version: string; major: number; ok: boolean };
  git: { available: boolean; isRepo: boolean };
  workers: { name: string; onPath: boolean; location?: string }[];
  claudeDirExists: boolean;
  hooksInstalled: boolean;
  configExists: boolean;
  manifestExists: boolean;
  agentDocs: { path: string; exists: boolean }[];
  packageScripts: { name: string; exists: boolean; command?: string }[];
  playwright: { declared: boolean; configExists: boolean };
  browserReady: boolean;
  githubWorkflowExists: boolean;
  uiContractsFound: number;
  ready: boolean;
  missing: string[];
  fixes: string[];
};

function nodeMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : 0;
}

export function buildDoctorReport(root: string): DoctorReport {
  const resolved = resolve(root);
  const version = process.version;
  const major = nodeMajor(version);
  const nodeOk = major >= MINIMUM_NODE_MAJOR;

  const gitAvailable = isGitAvailable();
  const gitRepo = gitAvailable && isGitRepo(resolved);
  const workers = detectWorkers();
  const claudeDirExists = existsSync(join(resolved, ".claude"));
  const hooksStatus = proofloopHooksStatus({ root: resolved });
  const hooksInstalled = hooksStatus.settings.some((file) => file.stopHookInstalled);
  const hasConfig = configExists(resolved);
  const manifest = buildProofloopProjectManifest(resolved);
  const manifestExists = existsSync(join(resolved, ".proofloop", "manifest.json"));
  const agentDocs = manifest.agentInstructions.map((entry) => ({ path: entry.path, exists: entry.exists }));
  const packageScripts = ["proofloop:init", "proofloop:live", "proofloop:gate", "proofloop:resume", "proofloop:doctor"].map((name) => ({
    name,
    exists: typeof manifest.packageScripts[name] === "string",
    ...(typeof manifest.packageScripts[name] === "string" ? { command: manifest.packageScripts[name] } : {}),
  }));
  const playwright = detectPlaywright(resolved);
  const browserReady = playwright.declared || manifest.uiContracts.length > 0;
  const githubWorkflowExists = hasProofloopGithubWorkflow(resolved);

  const missing: string[] = [];
  const fixes: string[] = [];
  if (!nodeOk) missing.push(`Node >= ${MINIMUM_NODE_MAJOR} (you have ${version})`);
  if (!gitAvailable) missing.push("git on PATH");
  if (!gitRepo) missing.push("this directory is not a git repo (run `git init`)");
  if (!workers.some((worker) => worker.onPath)) missing.push("a coding-agent CLI on PATH (claude or codex)");
  if (!hasConfig) missing.push("proofloop.config.json (run `proofloop init`)");
  if (!manifestExists) {
    missing.push(".proofloop/manifest.json");
    fixes.push("npx proofloop init --agent auto --live");
  }
  if (!agentDocs.some((entry) => entry.exists)) {
    missing.push("agent instructions (AGENTS.md, CLAUDE.md, Cursor, or Windsurf)");
    fixes.push("npx proofloop init --agent all --live");
  }
  if (!packageScripts.every((script) => script.exists)) {
    missing.push("Proof Loop package script aliases");
    fixes.push("npx proofloop init --agent auto --live");
  }
  if (!playwright.declared && !playwright.configExists) {
    missing.push("Playwright/browser proof dependency or config");
    fixes.push("npm i -D @playwright/test && npx playwright install");
  }
  if (!githubWorkflowExists) {
    missing.push("GitHub proof gate workflow");
    fixes.push("npx proofloop ci install github");
  }
  if (manifest.uiContracts.length === 0) {
    missing.push("stable UI contracts (`data-testid` or `data-proofloop`)");
    fixes.push("add data-testid/data-proofloop selectors to proof-critical controls");
  }

  return {
    node: { version, major, ok: nodeOk },
    git: { available: gitAvailable, isRepo: gitRepo },
    workers,
    claudeDirExists,
    hooksInstalled,
    configExists: hasConfig,
    manifestExists,
    agentDocs,
    packageScripts,
    playwright,
    browserReady,
    githubWorkflowExists,
    uiContractsFound: manifest.uiContracts.length,
    ready: missing.length === 0,
    missing,
    fixes: [...new Set(fixes)],
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const check = (ok: boolean) => (ok ? "OK  " : "MISS");
  const lines = [
    "Proof Loop doctor -- environment + readiness",
    "",
    `  [${check(report.node.ok)}] node ${report.node.version} (need >= ${MINIMUM_NODE_MAJOR})`,
    `  [${check(report.git.available)}] git on PATH`,
    `  [${check(report.git.isRepo)}] inside a git repo`,
  ];
  for (const worker of report.workers) {
    lines.push(`  [${worker.onPath ? "OK  " : "----"}] worker "${worker.name}"${worker.onPath ? ` -> ${worker.location}` : " (not on PATH)"}`);
  }
  lines.push(`  [${report.claudeDirExists ? "OK  " : "----"}] .claude/ present`);
  lines.push(`  [${report.hooksInstalled ? "OK  " : "----"}] proofloop hooks installed`);
  lines.push(`  [${check(report.configExists)}] proofloop.config.json present`);
  lines.push(`  [${check(report.manifestExists)}] .proofloop/manifest.json present`);
  lines.push(`  [${report.agentDocs.some((entry) => entry.exists) ? "OK  " : "MISS"}] agent docs (${report.agentDocs.filter((entry) => entry.exists).map((entry) => entry.path).join(", ") || "missing"})`);
  lines.push(`  [${report.packageScripts.every((entry) => entry.exists) ? "OK  " : "MISS"}] package script aliases`);
  lines.push(`  [${report.playwright.declared || report.playwright.configExists ? "OK  " : "MISS"}] Playwright/browser readiness`);
  lines.push(`  [${check(report.githubWorkflowExists)}] GitHub proof workflow`);
  lines.push(`  [${report.uiContractsFound > 0 ? "OK  " : "MISS"}] stable UI contracts (${report.uiContractsFound})`);
  lines.push("");
  if (report.ready) {
    lines.push("You're ready: run `proofloop gate` to prove the work, or paste `proofloop prompt` into your agent.");
  } else {
    lines.push("Here's what's missing before the loop is fully wired:");
    for (const item of report.missing) lines.push(`  - ${item}`);
    if (report.fixes.length > 0) {
      lines.push("");
      lines.push("Fix commands:");
      for (const fix of report.fixes) lines.push(`  - ${fix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Exit 0 always. */
export function runDoctor(options: { root: string; json?: boolean; log?: (line: string) => void }): 0 {
  const log = options.log ?? console.log;
  const report = buildDoctorReport(resolve(options.root));
  log(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
  return 0;
}

function detectPlaywright(root: string): { declared: boolean; configExists: boolean } {
  const packagePath = join(root, "package.json");
  let declared = false;
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const section = pkg[field];
        if (section && typeof section === "object" && !Array.isArray(section) && ("@playwright/test" in section || "playwright" in section)) {
          declared = true;
        }
      }
    } catch {
      declared = false;
    }
  }
  const configExists = ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"].some((name) => existsSync(join(root, name)));
  return { declared, configExists };
}

function hasProofloopGithubWorkflow(root: string): boolean {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!/\.(ya?ml)$/i.test(name)) continue;
    try {
      const text = readFileSync(join(dir, name), "utf8").toLowerCase();
      if (text.includes("proofloop") || text.includes("proof loop")) return true;
    } catch {
      continue;
    }
  }
  return false;
}
