/**
 * `proofloop doctor` -- environment + readiness report. Exit 0 ALWAYS (it's a
 * report, not a gate). Reports: node version (warn if <20), git present +
 * is-a-git-repo, which coding-agent workers are on PATH (claude, codex),
 * whether .claude/ exists, whether hooks are installed, whether a config exists.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { configExists } from "./config";
import { detectWorkers, isGitAvailable, isGitRepo } from "./detect";
import { proofloopHooksStatus } from "./proofloopHooks";

export const MINIMUM_NODE_MAJOR = 20;

export type DoctorReport = {
  node: { version: string; major: number; ok: boolean };
  git: { available: boolean; isRepo: boolean };
  workers: { name: string; onPath: boolean; location?: string }[];
  claudeDirExists: boolean;
  hooksInstalled: boolean;
  configExists: boolean;
  ready: boolean;
  missing: string[];
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

  const missing: string[] = [];
  if (!nodeOk) missing.push(`Node >= ${MINIMUM_NODE_MAJOR} (you have ${version})`);
  if (!gitAvailable) missing.push("git on PATH");
  if (!gitRepo) missing.push("this directory is not a git repo (run `git init`)");
  if (!workers.some((worker) => worker.onPath)) missing.push("a coding-agent CLI on PATH (claude or codex)");
  if (!hasConfig) missing.push("proofloop.config.json (run `proofloop init`)");

  return {
    node: { version, major, ok: nodeOk },
    git: { available: gitAvailable, isRepo: gitRepo },
    workers,
    claudeDirExists,
    hooksInstalled,
    configExists: hasConfig,
    ready: missing.length === 0,
    missing,
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
  lines.push("");
  if (report.ready) {
    lines.push("You're ready: run `proofloop gate` to prove the work, or paste `proofloop prompt` into your agent.");
  } else {
    lines.push("Here's what's missing before the loop is fully wired:");
    for (const item of report.missing) lines.push(`  - ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Exit 0 always. */
export function runDoctor(options: { root: string; log?: (line: string) => void }): 0 {
  const log = options.log ?? console.log;
  log(formatDoctorReport(buildDoctorReport(resolve(options.root))));
  return 0;
}
