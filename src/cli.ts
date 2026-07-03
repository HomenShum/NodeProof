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
 *   proofloop this-repo [--goal ...]   guided local-loop setup (drives YOUR agent)
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

type Flags = { positional: string[]; options: Record<string, string | boolean> };

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
    "  prompt                     print the one-prompt kickoff",
    "  this-repo [--goal <text>]  guided local-loop setup (drives YOUR agent honestly)",
    "",
    "Global options:",
    "  --dir <path>               operate on this repo root (default: cwd)",
    "",
    `Commands: ${PACKAGE_COMMANDS.join(", ")}`,
  ].join("\n");
}

export function runCli(argv: string[]): number {
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
      return runInit({ root });

    case "doctor":
      return runDoctor({ root });

    case "gate":
      return runGateCli({ root, check: options.check === true });

    case "prompt": {
      console.log(proofloopKickoffPrompt());
      return 0;
    }

    case "this-repo":
      return runThisRepo({ root, ...(str(options.goal) !== undefined ? { goal: str(options.goal)! } : {}) });

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
  process.exit(runCli(process.argv.slice(2)));
}
