import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildProofloopProjectManifest, buildReport } from "./project";
import type { ProofloopTargetPlan } from "./targetPlan";

export type ProofloopContextReportResult = {
  reportPath: string;
  latestPath: string;
  text: string;
};

export type ProofloopContextReportInputs = {
  root: string;
  targetPlan: ProofloopTargetPlan;
  targetPlanPath: string;
  runnerPlanPath?: string;
  generatedAt?: string;
};

const REPORT_ROOT = ".proofloop/reports";

export function writeProofloopContextReport(inputs: ProofloopContextReportInputs): ProofloopContextReportResult {
  const root = resolve(inputs.root);
  const generatedAt = inputs.generatedAt ?? new Date().toISOString();
  const runId = reportRunId(generatedAt);
  const reportPath = join(root, REPORT_ROOT, runId, "proofloop-context.md");
  const latestPath = join(root, REPORT_ROOT, "latest.md");
  const text = renderProofloopContextReport({ ...inputs, root, generatedAt });
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(latestPath), { recursive: true });
  writeFileSync(reportPath, text, "utf8");
  writeFileSync(latestPath, text, "utf8");
  return { reportPath, latestPath, text };
}

export function renderProofloopContextReport(inputs: ProofloopContextReportInputs & { generatedAt: string }): string {
  const manifest = buildProofloopProjectManifest(inputs.root);
  const gate = buildReport(inputs.root);
  const target = inputs.targetPlan.target;
  const runnerTasks = inputs.targetPlan.runnerPlan?.tasks ?? [];
  const recommendations = inputs.targetPlan.recommendations;
  const blockers = [...manifest.knownBlockers, ...inputs.targetPlan.blocked];
  const sourceRows = [
    ["target plan", inputs.targetPlanPath],
    ...(inputs.runnerPlanPath ? [["runner plan", inputs.runnerPlanPath] as [string, string]] : []),
    ["latest context report", join(inputs.root, REPORT_ROOT, "latest.md")],
    ["manifest", join(inputs.root, ".proofloop", "manifest.json")],
    ["gate state", join(inputs.root, ".proofloop", "gate-state.json")],
  ];

  return [
    `# ProofLoop Context Report: ${manifest.repo.name}`,
    "",
    `Generated: ${inputs.generatedAt}`,
    "",
    "This page is deterministic. It is rendered from local files, URL fetch metadata, target-plan receipts, runner-plan receipts, and gate receipts. It is not an LLM-written claim that the app works.",
    "",
    "## Target",
    "",
    `- Kind: ${target.kind}`,
    `- Repo root: ${target.root ?? manifest.repo.root}`,
    `- Package: ${target.packageName ?? manifest.repo.name}`,
    `- URL: ${target.url ?? "none"}`,
    `- HTTP status: ${target.httpStatus ?? "not fetched"}`,
    `- Title: ${target.title ?? "unknown"}`,
    "",
    "## Current Repo State",
    "",
    `- App: ${manifest.repo.app}`,
    `- App reason: ${manifest.repo.appReason}`,
    `- Stack: ${manifest.repo.stack.join(", ") || "unknown"}`,
    `- Config: ${manifest.config.kind}${manifest.config.path ? ` (${manifest.config.path})` : ""}`,
    `- Agent docs: ${manifest.agentInstructions.filter((entry) => entry.exists).map((entry) => entry.path).join(", ") || "missing"}`,
    `- Workflows: ${manifest.workflows.join(", ") || "none"}`,
    `- UI contracts: ${manifest.uiContracts.slice(0, 12).map((contract) => contract.id).join(", ") || "none"}`,
    "",
    "## Benchmark And Proof Targeting",
    "",
    "| Family | Fit | Confidence | Adapter | Scorer | Evidence |",
    "|---|---|---:|---|---|---|",
    ...recommendations.map((entry) => `| ${entry.id} | ${entry.fit} | ${entry.confidence.toFixed(2)} | ${entry.adapterStatus} | ${entry.officialScoreStatus} | ${escapeTable(entry.evidence.slice(0, 4).join("; "))} |`),
    "",
    "## Runnable Plan",
    "",
    runnerTasks.length
      ? [
          "| Task | Command | Cost estimate |",
          "|---|---|---:|",
          ...runnerTasks.map((task) => `| ${task.id} | ${escapeTable(task.command)} | ${money(task.estimatedCostUsd ?? 0)} |`),
        ].join("\n")
      : "No runner tasks were generated. Add proof checks, browser scripts, or benchmark adapters.",
    "",
    "## Gate Receipt",
    "",
    codeFence(gate.text.trim() || JSON.stringify(gate.json, null, 2), "text"),
    "",
    "## Not Done / Blocked",
    "",
    blockers.length ? blockers.map((blocker) => `- ${blocker}`).join("\n") : "- No blockers recorded by the current manifest or target plan.",
    "",
    "## Next Actions",
    "",
    inputs.targetPlan.nextActions.map((action) => `- ${action}`).join("\n"),
    "",
    "## Source Receipts",
    "",
    "| Source | Path |",
    "|---|---|",
    ...sourceRows.map(([label, path]) => `| ${label} | ${escapeTable(path)} |`),
    "",
    "## Agent Handoff",
    "",
    "Give this file to a coding agent together with the repo. The agent should treat the blockers above as the open work queue and should not claim done until `npx proofloop gate` or the configured runner plan passes.",
    "",
    codeFence([
      "npx proofloop doctor --json",
      "npx proofloop manifest --dense",
      target.url ? `npx proofloop target --url ${target.url} --write-runner-plan` : "npx proofloop target --write-runner-plan",
      inputs.runnerPlanPath ? `npx proofloop runner run --plan ${inputs.runnerPlanPath} --budget-usd 100` : "npx proofloop gate",
      "npx proofloop report latest",
    ].join("\n"), "bash"),
    "",
    "## Honesty Boundary",
    "",
    inputs.targetPlan.honesty,
    "",
  ].join("\n");
}

function reportRunId(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace(/[^0-9A-Za-z_-]+/g, "-");
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function codeFence(value: string, info: string): string {
  return ["```" + info, value, "```"].join("\n");
}

function money(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}
