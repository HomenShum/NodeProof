#!/usr/bin/env node
/**
 * proofloop CLI -- the portable proof-supervisor.
 *
 *   proofloop init                     detect the app + write proofloop.config.json
 *   proofloop doctor                   environment + readiness report (exit 0)
 *   proofloop gate [--check]           run gate.checks (0 pass / 1 fail / 2 unusable)
 *   proofloop hooks <install|uninstall|status>   Claude Code Stop/PreToolUse/PostToolUse hooks
 *   proofloop tooluse <verify|init>    expected-tool-use contracts
 *   proofloop ci install github        write the GitHub Actions gate workflow
 *   proofloop prompt                   print the one-prompt kickoff
 *   proofloop this-repo [--goal ...] [--write-runner-plan] [--run]
 *   proofloop manifest|docs|template|workflow|ui|resume|report|charts|mcp
 *
 * Exit codes are per-command (documented at each case). Zero runtime deps.
 */
import { resolve } from "node:path";
import { runInit } from "./init";
import { runDoctor } from "./doctor";
import { runGateCli } from "./gate";
import { runThisRepo } from "./thisRepo";
import { proofloopKickoffPrompt, PACKAGE_COMMANDS } from "./prompt";
import {
  installProofloopHooks,
  uninstallProofloopHooks,
  proofloopHooksStatus,
  formatProofloopHooksStatus,
} from "./proofloopHooks";
import { installProofloopGithubCi } from "./proofloopCi";
import { runToolUseInit, runToolUseVerify } from "./proofloopToolUse";
import { startMcpServer } from "./mcp";
import {
  buildProofloopProjectManifest,
  buildReport,
  buildResume,
  discoverUiContracts,
  formatProofloopProjectManifestDense,
  formatProofloopTemplateList,
  formatUiContractsDense,
  listProofloopTemplates,
  listProofloopWorkflows,
  writeProofloopCharts,
  writeProofloopTemplate,
  type ProofloopAgentTarget,
} from "./project";
import { runProofloopRunner } from "./runner";

type Flags = { positional: string[]; options: Record<string, string | boolean> };
export const MCP_SERVER_RUNNING = -999;

/** Parse `--flag`, `--flag value`, `--flag=value`, and positionals. */
function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          options[body] = next;
          i += 1;
        } else {
          options[body] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: string | boolean | undefined): number | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function usage(): string {
  return [
    "proofloop -- bring any coding agent; Proof Loop makes it prove the app works.",
    "",
    "Usage: proofloop <command> [options]",
    "",
    "Commands:",
    "  init                       detect the app + write a starter proofloop.config.json",
    "  doctor                     environment + readiness report",
    "  gate [--check]             run gate.checks (exit 0 pass / 1 fail / 2 unusable)",
    "  hooks install|uninstall|status   Claude Code Stop/PreToolUse/PostToolUse hooks",
    "  tooluse verify|init        expected-tool-use contracts",
    "  ci install github          write the GitHub Actions gate workflow",
    "  manifest [--json|--dense]  compact project manifest",
    "  docs agents --dense        compact agent workflow instructions",
    "  template --list|<id> --write   list/write proof templates",
    "  workflow --list            list proof workflows",
    "  ui contract|component      inspect stable UI contracts",
    "  resume [--dense|--json]    next action from the latest gate receipt",
    "  report latest [--json]     latest gate report",
    "  charts latest              write local JSON/SVG proof charts",
    "  runner run|resume|status   durable append-only task runner with budget and resume",
    "  mcp                        start the optional read-only MCP server",
    "  prompt                     print the one-prompt kickoff",
    "  this-repo [--goal <text>] [--write-runner-plan] [--run]",
    "",
    "Global options:",
    "  --dir <path>               operate on this repo root (default: cwd)",
    "",
    `Commands: ${PACKAGE_COMMANDS.join(", ")}`,
  ].join("\n");
}

export function runCli(argv: string[]): number | Promise<number> {
  const { positional, options } = parseArgs(argv);
  const command = positional[0];
  const root = resolve(str(options.dir) ?? process.cwd());

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      console.log(usage());
      return 0;
    }

    case "init":
      return runInit({
        root,
        ...(str(options.agent) !== undefined ? { agent: str(options.agent)! as ProofloopAgentTarget } : {}),
        live: options.live === true,
        features: parseFeatures(str(options.features)),
      });

    case "doctor":
      return runDoctor({ root, json: options.json === true });

    case "gate":
      return runGateCli({ root, check: options.check === true });

    case "prompt": {
      console.log(proofloopKickoffPrompt());
      return 0;
    }

    case "this-repo":
      return runThisRepo({
        root,
        live: options.live === true,
        writeRunnerPlan: options["write-runner-plan"] === true || options.runner === true,
        run: options.run === true,
        ...(str(options.goal) !== undefined ? { goal: str(options.goal)! } : {}),
        ...(num(options["budget-usd"]) !== undefined ? { budgetUsd: num(options["budget-usd"])! } : {}),
        ...(num(options["max-tasks"]) !== undefined ? { maxTasks: num(options["max-tasks"])! } : {}),
      });

    case "manifest":
      return runManifestCommand(options, root);

    case "docs":
      return runDocsCommand(positional[1], options);

    case "template":
      return runTemplateCommand(positional[1], options, root);

    case "workflow":
      return runWorkflowCommand(options, root);

    case "ui":
      return runUiCommand(positional[1], positional[2], options, root);

    case "resume":
      return runResumeCommand(options, root);

    case "report":
      return runReportCommand(positional[1], options, root);

    case "charts":
      return runChartsCommand(positional[1], root);

    case "runner":
      return runRunnerCommand(positional[1], options, root);

    case "mcp":
      startMcpServer({ root });
      return MCP_SERVER_RUNNING;

    case "hooks":
      return runHooksCommand(positional[1], options, root);

    case "tooluse":
      return runToolUseCommand(positional[1], options, root);

    case "ci":
      return runCiCommand(positional[1], positional[2], root);

    default:
      console.error(`proofloop: unknown command "${command}".`);
      console.error(usage());
      return 2;
  }
}

function parseFeatures(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function runManifestCommand(options: Record<string, string | boolean>, root: string): number {
  const manifest = buildProofloopProjectManifest(root);
  if (options.dense === true) {
    console.log(formatProofloopProjectManifestDense(manifest));
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
  return 0;
}

function runDocsCommand(sub: string | undefined, options: Record<string, string | boolean>): number {
  if (sub !== "agents") {
    console.error("proofloop docs: expected `agents`.");
    return 2;
  }
  const dense = [
    "proofloop-agent-docs",
    "setup=npx proofloop init --agent auto --live",
    "doctor=npx proofloop doctor --json",
    "manifest=npx proofloop manifest --dense",
    "ui=npx proofloop ui contract --dense",
    "gate=npx proofloop gate",
    "resume=npx proofloop resume --dense",
    "mcp=npx proofloop mcp",
  ].join("\n");
  console.log(options.json === true ? JSON.stringify({ commands: dense.split("\n").slice(1) }, null, 2) : `${dense}\n`);
  return 0;
}

function runTemplateCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string): number {
  if (options.list === true || sub === "--list" || sub === undefined) {
    const templates = listProofloopTemplates();
    console.log(options.json === true ? JSON.stringify(templates, null, 2) : formatProofloopTemplateList(templates));
    return 0;
  }
  if (options.write === true) {
    try {
      const written = writeProofloopTemplate(root, sub, options.force === true);
      console.log(`proofloop template: wrote/kept ${written.length} file(s) for ${sub}`);
      for (const path of written) console.log(`  ${path}`);
      return 0;
    } catch (error) {
      console.error(`proofloop template: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }
  const template = listProofloopTemplates().find((entry) => entry.id === sub);
  if (!template) {
    console.error(`proofloop template: unknown template "${sub}". Run \`proofloop template --list\`.`);
    return 2;
  }
  console.log(options.json === true ? JSON.stringify(template, null, 2) : `${template.id}: ${template.title}\n${template.workflow}\n`);
  return 0;
}

function runWorkflowCommand(options: Record<string, string | boolean>, root: string): number {
  const workflows = listProofloopWorkflows(root);
  console.log(options.json === true ? JSON.stringify({ workflows }, null, 2) : `${workflows.join("\n") || "none"}\n`);
  return 0;
}

function runUiCommand(sub: string | undefined, component: string | undefined, options: Record<string, string | boolean>, root: string): number {
  const contracts = discoverUiContracts(root);
  if (sub === "contract" || sub === "list" || sub === undefined) {
    console.log(options.json === true ? JSON.stringify(contracts, null, 2) : formatUiContractsDense(contracts));
    return 0;
  }
  if (sub === "component") {
    if (!component) {
      console.error("proofloop ui component: expected component id.");
      return 2;
    }
    const matches = contracts.filter((contract) => contract.id === component);
    console.log(options.json === true ? JSON.stringify(matches, null, 2) : formatUiContractsDense(matches));
    return matches.length > 0 ? 0 : 2;
  }
  console.error("proofloop ui: expected `contract`, `list`, or `component <id>`.");
  return 2;
}

function runResumeCommand(options: Record<string, string | boolean>, root: string): number {
  const resume = buildResume(root);
  console.log(options.json === true ? JSON.stringify(resume.json, null, 2) : resume.dense);
  return 0;
}

function runReportCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string): number {
  if (sub !== undefined && sub !== "latest") {
    console.error("proofloop report: only `latest` is supported.");
    return 2;
  }
  const report = buildReport(root);
  console.log(options.json === true ? JSON.stringify(report.json, null, 2) : report.text);
  return 0;
}

function runChartsCommand(sub: string | undefined, root: string): number {
  if (sub !== undefined && sub !== "latest") {
    console.error("proofloop charts: only `latest` is supported.");
    return 2;
  }
  const result = writeProofloopCharts(root);
  console.log(`proofloop charts: wrote ${result.jsonPath}`);
  console.log(`proofloop charts: wrote ${result.svgPath}`);
  return 0;
}

async function runRunnerCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string): Promise<number> {
  if (sub !== "run" && sub !== "resume" && sub !== "status") {
    console.error("proofloop runner: expected `run`, `resume`, or `status`.");
    return 2;
  }
  const result = await runProofloopRunner({
    root,
    subcommand: sub,
    ...(str(options.plan) !== undefined ? { planPath: str(options.plan)! } : {}),
    ...(str(options["run-id"]) !== undefined ? { runId: str(options["run-id"])! } : {}),
    ...(num(options["budget-usd"]) !== undefined ? { budgetUsd: num(options["budget-usd"])! } : {}),
    ...(num(options["max-tasks"]) !== undefined ? { maxTasks: num(options["max-tasks"])! } : {}),
    ...(num(options["lock-ttl-ms"]) !== undefined ? { lockTtlMs: num(options["lock-ttl-ms"])! } : {}),
    ...(str(options["crash-after-start"]) !== undefined ? { crashAfterStartTaskId: str(options["crash-after-start"])! } : {}),
    json: options.json === true,
  });
  return result.exitCode;
}

function runHooksCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string): number {
  switch (sub) {
    case "install": {
      const result = installProofloopHooks({
        root,
        local: options.local === true,
        ...(str(options.worker) !== undefined ? { worker: str(options.worker)! } : {}),
        ...(str(options["gate-command"]) !== undefined ? { gateCommand: str(options["gate-command"])! } : {}),
        checkOnly: options["check-only"] === true,
        ...(num(options["max-stop-blocks"]) !== undefined ? { maxStopBlocks: num(options["max-stop-blocks"])! } : {}),
        toolUseLog: options["no-tooluse-log"] === true ? false : true,
      });
      console.log(`proofloop hooks: installed into ${result.settingsPath}`);
      console.log(`  stop-gate:        ${result.stopGatePath}${result.addedStopHook ? " (added)" : " (already present)"}`);
      console.log(`  pretooluse-guard: ${result.preToolUseGuardPath}${result.addedPreToolUseHook ? " (added)" : " (already present)"}`);
      console.log(
        result.postToolUseLogPath
          ? `  posttooluse-log:  ${result.postToolUseLogPath}${result.addedPostToolUseLogHook ? " (added)" : " (already present)"}`
          : "  posttooluse-log:  (skipped: --no-tooluse-log)",
      );
      console.log("The Stop hook refuses fake \"done\" until `proofloop gate` passes.");
      return 0;
    }
    case "uninstall": {
      const result = uninstallProofloopHooks({ root, purge: options.purge === true });
      console.log(`proofloop hooks: removed ${result.removedEntries} entr${result.removedEntries === 1 ? "y" : "ies"} from ${result.cleanedSettingsPaths.length} settings file(s).`);
      if (result.purgedHooksDir) console.log("  purged .proofloop/hooks/");
      return 0;
    }
    case "status": {
      console.log(formatProofloopHooksStatus(proofloopHooksStatus({ root })));
      return 0;
    }
    default:
      console.error("proofloop hooks: expected `install`, `uninstall`, or `status`.");
      return 2;
  }
}

function runToolUseCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string): number {
  switch (sub) {
    case "init":
      return runToolUseInit({
        root,
        ...(str(options.template) !== undefined ? { template: str(options.template)! } : {}),
        ...(str(options.out) !== undefined ? { outPath: str(options.out)! } : {}),
      });
    case "verify": {
      const contract = str(options.contract);
      if (!contract) {
        console.error("proofloop tooluse verify: --contract <file> is required.");
        return 2;
      }
      return runToolUseVerify({
        root,
        contractPath: contract,
        ...(str(options.trace) !== undefined ? { tracePath: str(options.trace)! } : {}),
        ...(str(options.session) !== undefined ? { session: str(options.session)! } : {}),
        json: options.json === true,
      });
    }
    default:
      console.error("proofloop tooluse: expected `verify` or `init`.");
      return 2;
  }
}

function runCiCommand(sub: string | undefined, provider: string | undefined, root: string): number {
  if (sub !== "install") {
    console.error("proofloop ci: expected `install github`.");
    return 2;
  }
  if (provider !== "github") {
    console.error(`proofloop ci install: unsupported provider "${provider ?? ""}". Only "github" is supported.`);
    return 2;
  }
  try {
    const result = installProofloopGithubCi({ root });
    console.log(`proofloop ci: wrote ${result.workflowPath}`);
    console.log("  The gate runs `npx proofloop gate` on push to main and on PRs.");
    return 0;
  } catch (error) {
    console.error(`proofloop ci: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

// Only auto-run when invoked as the CLI entry point, never when imported.
if (require.main === module) {
  Promise.resolve(runCli(process.argv.slice(2))).then((code) => {
    if (code !== MCP_SERVER_RUNNING) process.exit(code);
  }).catch((error: unknown) => {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
}
