#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
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
const node_path_1 = require("node:path");
const init_1 = require("./init");
const doctor_1 = require("./doctor");
const gate_1 = require("./gate");
const thisRepo_1 = require("./thisRepo");
const prompt_1 = require("./prompt");
const proofloopHooks_1 = require("./proofloopHooks");
const proofloopCi_1 = require("./proofloopCi");
const proofloopToolUse_1 = require("./proofloopToolUse");
/** Parse `--flag`, `--flag value`, `--flag=value`, and positionals. */
function parseArgs(argv) {
    const positional = [];
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const body = arg.slice(2);
            const eq = body.indexOf("=");
            if (eq >= 0) {
                options[body.slice(0, eq)] = body.slice(eq + 1);
            }
            else {
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith("--")) {
                    options[body] = next;
                    i += 1;
                }
                else {
                    options[body] = true;
                }
            }
        }
        else {
            positional.push(arg);
        }
    }
    return { positional, options };
}
function str(value) {
    return typeof value === "string" ? value : undefined;
}
function num(value) {
    const s = str(value);
    if (s === undefined)
        return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}
function usage() {
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
        `Commands: ${prompt_1.PACKAGE_COMMANDS.join(", ")}`,
    ].join("\n");
}
function runCli(argv) {
    const { positional, options } = parseArgs(argv);
    const command = positional[0];
    const root = (0, node_path_1.resolve)(str(options.dir) ?? process.cwd());
    switch (command) {
        case undefined:
        case "help":
        case "--help":
        case "-h": {
            console.log(usage());
            return 0;
        }
        case "init":
            return (0, init_1.runInit)({ root });
        case "doctor":
            return (0, doctor_1.runDoctor)({ root });
        case "gate":
            return (0, gate_1.runGateCli)({ root, check: options.check === true });
        case "prompt": {
            console.log((0, prompt_1.proofloopKickoffPrompt)());
            return 0;
        }
        case "this-repo":
            return (0, thisRepo_1.runThisRepo)({ root, ...(str(options.goal) !== undefined ? { goal: str(options.goal) } : {}) });
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
function runHooksCommand(sub, options, root) {
    switch (sub) {
        case "install": {
            const result = (0, proofloopHooks_1.installProofloopHooks)({
                root,
                local: options.local === true,
                ...(str(options.worker) !== undefined ? { worker: str(options.worker) } : {}),
                ...(str(options["gate-command"]) !== undefined ? { gateCommand: str(options["gate-command"]) } : {}),
                checkOnly: options["check-only"] === true,
                ...(num(options["max-stop-blocks"]) !== undefined ? { maxStopBlocks: num(options["max-stop-blocks"]) } : {}),
                toolUseLog: options["no-tooluse-log"] === true ? false : true,
            });
            console.log(`proofloop hooks: installed into ${result.settingsPath}`);
            console.log(`  stop-gate:        ${result.stopGatePath}${result.addedStopHook ? " (added)" : " (already present)"}`);
            console.log(`  pretooluse-guard: ${result.preToolUseGuardPath}${result.addedPreToolUseHook ? " (added)" : " (already present)"}`);
            console.log(result.postToolUseLogPath
                ? `  posttooluse-log:  ${result.postToolUseLogPath}${result.addedPostToolUseLogHook ? " (added)" : " (already present)"}`
                : "  posttooluse-log:  (skipped: --no-tooluse-log)");
            console.log("The Stop hook refuses fake \"done\" until `proofloop gate` passes.");
            return 0;
        }
        case "uninstall": {
            const result = (0, proofloopHooks_1.uninstallProofloopHooks)({ root, purge: options.purge === true });
            console.log(`proofloop hooks: removed ${result.removedEntries} entr${result.removedEntries === 1 ? "y" : "ies"} from ${result.cleanedSettingsPaths.length} settings file(s).`);
            if (result.purgedHooksDir)
                console.log("  purged .proofloop/hooks/");
            return 0;
        }
        case "status": {
            console.log((0, proofloopHooks_1.formatProofloopHooksStatus)((0, proofloopHooks_1.proofloopHooksStatus)({ root })));
            return 0;
        }
        default:
            console.error("proofloop hooks: expected `install`, `uninstall`, or `status`.");
            return 2;
    }
}
function runToolUseCommand(sub, options, root) {
    switch (sub) {
        case "init":
            return (0, proofloopToolUse_1.runToolUseInit)({
                root,
                ...(str(options.template) !== undefined ? { template: str(options.template) } : {}),
                ...(str(options.out) !== undefined ? { outPath: str(options.out) } : {}),
            });
        case "verify": {
            const contract = str(options.contract);
            if (!contract) {
                console.error("proofloop tooluse verify: --contract <file> is required.");
                return 2;
            }
            return (0, proofloopToolUse_1.runToolUseVerify)({
                root,
                contractPath: contract,
                ...(str(options.trace) !== undefined ? { tracePath: str(options.trace) } : {}),
                ...(str(options.session) !== undefined ? { session: str(options.session) } : {}),
                json: options.json === true,
            });
        }
        default:
            console.error("proofloop tooluse: expected `verify` or `init`.");
            return 2;
    }
}
function runCiCommand(sub, provider, root) {
    if (sub !== "install") {
        console.error("proofloop ci: expected `install github`.");
        return 2;
    }
    if (provider !== "github") {
        console.error(`proofloop ci install: unsupported provider "${provider ?? ""}". Only "github" is supported.`);
        return 2;
    }
    try {
        const result = (0, proofloopCi_1.installProofloopGithubCi)({ root });
        console.log(`proofloop ci: wrote ${result.workflowPath}`);
        console.log("  The gate runs `npx proofloop gate` on push to main and on PRs.");
        return 0;
    }
    catch (error) {
        console.error(`proofloop ci: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}
// Only auto-run when invoked as the CLI entry point, never when imported.
if (require.main === module) {
    process.exit(runCli(process.argv.slice(2)));
}
