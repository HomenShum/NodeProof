#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_SERVER_RUNNING = void 0;
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
 *   proofloop target [--url <url>] [--write-runner-plan] [--write-browser-smoke]
 *   proofloop solo ingest|status|gate|resume|attest|verify-attestation
 *   proofloop this-repo [--goal ...] [--write-runner-plan] [--run]
 *   proofloop maturity [--dense|--json|--write] [--target-level 5]
 *   proofloop productivity [--write] [--baseline-source benchmark] [--dev-hours 2] [--qa-hours 1]
 *   proofloop agents list|setup [codex|claude-code|cursor|windsurf|devin|generic-cli|all]
 *   proofloop codex-loop [--dry-run] [--max-attempts 2]
 *   proofloop codex reprompt|relaunch [run-id]
 *   proofloop providers setup [butterbase|neo4j|rocketride|daytona|cognee|nebius|all]
 *   proofloop manifest|docs|template|workflow|ui|resume|report|charts|receipt|mcp
 *
 * Exit codes are per-command (documented at each case). Zero runtime deps.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const init_1 = require("./init");
const doctor_1 = require("./doctor");
const gate_1 = require("./gate");
const thisRepo_1 = require("./thisRepo");
const prompt_1 = require("./prompt");
const proofloopHooks_1 = require("./proofloopHooks");
const proofloopCi_1 = require("./proofloopCi");
const proofloopToolUse_1 = require("./proofloopToolUse");
const receipts_1 = require("./receipts");
const proofReceipt_1 = require("./proofReceipt");
const mcp_1 = require("./mcp");
const project_1 = require("./project");
const runner_1 = require("./runner");
const program_1 = require("./program");
const nodekitProof_1 = require("./nodekitProof");
const easeProof_1 = require("./easeProof");
const targetPlan_1 = require("./targetPlan");
const hosted_1 = require("./hosted");
const maturity_1 = require("./maturity");
const productivity_1 = require("./productivity");
const agentAdapters_1 = require("./agentAdapters");
const agentLoop_1 = require("./agentLoop");
const codexRelaunch_1 = require("./codexRelaunch");
const providerSetup_1 = require("./providerSetup");
const soloInterop_1 = require("./soloInterop");
const soloTrust_1 = require("./soloTrust");
const soloSetup_1 = require("./soloSetup");
exports.MCP_SERVER_RUNNING = -999;
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
        "  manifest [--json|--dense]  compact project manifest",
        "  docs agents --dense        compact agent workflow instructions",
        "  template --list|<id> --write   list/write proof templates",
        "  workflow --list            list proof workflows",
        "  ui contract|component      inspect stable UI contracts",
        "  resume [--dense|--json]    next action from the latest gate receipt",
        "  report latest [--json]     latest gate report",
        "  charts latest              write local JSON/SVG proof charts",
        "  receipt verify --file <path>   verify app-produced proof receipts",
        "  receipt envelope verify --file <path>   verify a proofloop.receipt/v1 envelope",
        "  receipt schema [--json]        locate or print the proofloop.receipt/v1 JSON Schema",
        "  ease verify --manifest <path> [--out <receipt>]   verify NodeKit EaseProof evidence integrity without inventing usability authority",
        "  solo setup --source <path> [--agent codex|claude-code|both] [--install-deps] [--verify]",
        "  solo ingest|status|gate|resume   validate and inspect Solo interop evidence",
        "  solo attest --file <envelope> --gate-receipt <receipt> --out <receipt> --key-id <id>",
        "  solo verify-attestation --file <receipt> [--public-key-file <pem>] [--key-id <id>]",
        "  runner run|resume|status|report   durable append-only task runner with budget and resume",
        "  program run|resume|status|report|verify-nodekit  P0 program supervisor and local NodeKit proof binding",
        "  hosted intake|validate|dashboard|run   create or resume a hosted URL proof packet",
        "  target [--url <url>] [--write-runner-plan] [--write-browser-smoke]   recommend benchmark families and write target/context receipts",
        "  maturity [--dense|--json|--write] [--target-level 5]   judge agent-era codebase/app maturity and missing layers",
        "  productivity [--write] [--baseline-source <source>]   write wage-equivalent verified productivity receipts and charts",
        "  agents list|setup [id|all]   install/report agent adapters for Codex, Claude Code, and wrapper hosts",
        "  codex-loop [--dry-run] [--max-attempts 2]   run gate, write repair prompt, optionally relaunch Codex",
        "  codex reprompt|relaunch [run-id]   show or launch the latest Codex repair prompt",
        "  providers setup [id|all]   write provider setup receipts for live integration lanes",
        "  mcp                        start the optional read-only MCP server",
        "  prompt                     print the one-prompt kickoff",
        "  this-repo [--goal <text>] [--write-runner-plan] [--run]",
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
            return (0, init_1.runInit)({
                root,
                ...(str(options.agent) !== undefined ? { agent: str(options.agent) } : {}),
                live: options.live === true,
                features: parseFeatures(str(options.features)),
            });
        case "doctor":
            return (0, doctor_1.runDoctor)({ root, json: options.json === true });
        case "gate":
            return (0, gate_1.runGateCli)({ root, check: options.check === true });
        case "prompt": {
            console.log((0, prompt_1.proofloopKickoffPrompt)());
            return 0;
        }
        case "this-repo":
            return (0, thisRepo_1.runThisRepo)({
                root,
                live: options.live === true,
                writeRunnerPlan: options["write-runner-plan"] === true || options.runner === true,
                run: options.run === true,
                ...(str(options.goal) !== undefined ? { goal: str(options.goal) } : {}),
                ...(num(options["budget-usd"]) !== undefined ? { budgetUsd: num(options["budget-usd"]) } : {}),
                ...(num(options["max-tasks"]) !== undefined ? { maxTasks: num(options["max-tasks"]) } : {}),
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
        case "receipt":
            return runReceiptCommand(positional[1], positional[2], options, root);
        case "ease":
            return runEaseCommand(positional[1], options, root);
        case "solo":
            return runSoloCommand(positional[1], options, root);
        case "runner":
            return runRunnerCommand(positional[1], options, root);
        case "program":
            return runProgramCommand(positional[1], options, root);
        case "hosted":
            return runHostedCommand(positional[1], options, root);
        case "target":
            return runTargetCommand(options, root);
        case "maturity":
            return runMaturityCommand(options, root);
        case "productivity":
            return runProductivityCommand(options, root);
        case "agents":
            return runAgentsCommand(positional[1], positional[2], options, root);
        case "codex-loop":
            return runCodexLoopCommand(options, root);
        case "codex":
            return runCodexCommand(positional[1], positional[2], options, root);
        case "providers":
            return runProvidersCommand(positional[1], positional[2], options, root);
        case "mcp":
            (0, mcp_1.startMcpServer)({ root });
            return exports.MCP_SERVER_RUNNING;
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
function runSoloCommand(sub, options, root) {
    if (sub === "setup")
        return runSoloSetupCommand(options, root);
    if (sub === "attest")
        return runSoloAttestCommand(options, root);
    if (sub === "verify-attestation")
        return runSoloVerifyAttestationCommand(options, root);
    return (0, soloInterop_1.runSoloInteropCli)({
        root,
        subcommand: sub,
        ...(str(options.file) !== undefined ? { filePath: str(options.file) } : {}),
        writeRunnerPlan: options["write-runner-plan"] === true,
        json: options.json === true,
    });
}
function runSoloSetupCommand(options, root) {
    const sourceDir = str(options.source) ?? str(options["source-dir"]);
    const agents = (str(options.agent) ?? "both");
    const result = (0, soloSetup_1.setupSolo)({
        targetRoot: root,
        ...(sourceDir ? { sourceDir: (0, node_path_1.resolve)(root, sourceDir) } : {}),
        agents,
        force: options.force === true,
        installDependencies: options["install-deps"] === true,
        verify: options.verify === true,
    });
    const hooks = [];
    if (result.status === "ready" && options["no-hooks"] !== true) {
        const workers = agents === "both" ? ["codex", "claude-code"] : [agents];
        try {
            for (const worker of workers) {
                const installed = (0, proofloopHooks_1.installProofloopHooks)({
                    root,
                    worker,
                    local: options.local === true,
                    gateCommand: result.command,
                });
                hooks.push({ worker, settingsPath: installed.settingsPath });
            }
        }
        catch (error) {
            console.error(`proofloop solo setup: hook installation failed: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }
    if (options.json === true) {
        console.log(JSON.stringify({ ...result, hooks }, null, 2));
    }
    else {
        console.log(`proofloop solo setup: ${result.status} -> ${result.receiptPath}`);
        for (const hook of hooks)
            console.log(`  ${hook.worker}: ${hook.settingsPath}`);
        for (const command of result.nextCommands)
            console.log(`  next: ${command}`);
    }
    return result.status === "ready" ? 0 : 1;
}
function runSoloAttestCommand(options, root) {
    const file = str(options.file);
    const gateReceipt = str(options["gate-receipt"]);
    const out = str(options.out);
    const keyId = str(options["key-id"]);
    if (!file || !gateReceipt || !out || !keyId) {
        console.error("proofloop solo attest: --file, --gate-receipt, --out, and --key-id are required.");
        return 2;
    }
    const privateKeyPem = process.env.PROOFLOOP_TRUST_PRIVATE_KEY_PEM;
    if (!privateKeyPem) {
        console.error("proofloop solo attest: PROOFLOOP_TRUST_PRIVATE_KEY_PEM is required.");
        return 2;
    }
    const outPath = (0, node_path_1.resolve)(root, out);
    if (resolvesInsideSolo(root, outPath)) {
        console.error("proofloop solo attest: refusing to write a trust receipt inside .solo.");
        return 2;
    }
    try {
        const receipt = (0, soloTrust_1.createSoloTrustReceipt)({
            envelopePath: (0, node_path_1.resolve)(root, file),
            gateReceiptPath: (0, node_path_1.resolve)(root, gateReceipt),
            outPath,
            privateKeyPem,
            keyId,
        });
        if (options.json === true) {
            console.log(JSON.stringify({ ok: true, outPath, receipt }, null, 2));
        }
        else {
            console.log(`proofloop solo attest: wrote ${outPath} keyId=${receipt.keyId} issuer=${receipt.payload.issuer.kind}`);
        }
        return 0;
    }
    catch (error) {
        console.error(`proofloop solo attest: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
function runSoloVerifyAttestationCommand(options, root) {
    const file = str(options.file);
    if (!file) {
        console.error("proofloop solo verify-attestation: --file <receipt> is required.");
        return 2;
    }
    const publicKeyFile = str(options["public-key-file"]);
    let publicKeyPem;
    try {
        publicKeyPem = publicKeyFile
            ? (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, publicKeyFile), "utf8")
            : process.env.PROOFLOOP_TRUST_PUBLIC_KEY_PEM;
    }
    catch (error) {
        console.error(`proofloop solo verify-attestation: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
    if (!publicKeyPem) {
        console.error("proofloop solo verify-attestation: --public-key-file or PROOFLOOP_TRUST_PUBLIC_KEY_PEM is required.");
        return 2;
    }
    try {
        const receiptPath = (0, node_path_1.resolve)(root, file);
        const result = (0, soloTrust_1.verifySoloTrustReceipt)((0, soloTrust_1.readSoloTrustReceipt)(receiptPath), {
            publicKeyPem,
            ...(str(options["key-id"]) !== undefined ? { expectedKeyId: str(options["key-id"]) } : {}),
            ...(str(options.candidate) !== undefined ? { expectedCandidateCommit: str(options.candidate) } : {}),
            ...(str(options.repository) !== undefined ? { expectedRepository: str(options.repository) } : {}),
        });
        if (options.json === true) {
            console.log(JSON.stringify({ ...result, receiptPath }, null, 2));
        }
        else if (result.ok) {
            console.log(`proofloop solo verify-attestation: passed ${receiptPath}`);
        }
        else {
            console.error(`proofloop solo verify-attestation: failed ${receiptPath}\n${result.errors.map((entry) => `- ${entry}`).join("\n")}`);
        }
        return result.ok ? 0 : 1;
    }
    catch (error) {
        console.error(`proofloop solo verify-attestation: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
function isPathWithin(rootInput, targetInput) {
    const path = (0, node_path_1.relative)((0, node_path_1.resolve)(rootInput), (0, node_path_1.resolve)(targetInput));
    return path === "" || (path !== ".." && !path.startsWith(`..${node_path_1.sep}`) && !(0, node_path_1.isAbsolute)(path));
}
function resolvesInsideSolo(root, target) {
    const soloPath = (0, node_path_1.resolve)(root, ".solo");
    if (isPathWithin(soloPath, target))
        return true;
    if (!(0, node_fs_1.existsSync)(soloPath))
        return false;
    let ancestor = (0, node_path_1.resolve)(target);
    while (!(0, node_fs_1.existsSync)(ancestor)) {
        const parent = (0, node_path_1.dirname)(ancestor);
        if (parent === ancestor)
            return false;
        ancestor = parent;
    }
    const projectedTarget = (0, node_path_1.resolve)((0, node_fs_1.realpathSync)(ancestor), (0, node_path_1.relative)(ancestor, target));
    return isPathWithin((0, node_fs_1.realpathSync)(soloPath), projectedTarget);
}
async function runAgentsCommand(sub, adapter, options, root) {
    if (sub === undefined || sub === "list") {
        const payload = agentAdapters_1.PROOFLOOP_AGENT_ADAPTER_IDS.map((id) => ({ id, setup: `npx proofloop agents setup ${id}` }));
        console.log(options.json === true ? JSON.stringify(payload, null, 2) : `${payload.map((entry) => `${entry.id}: ${entry.setup}`).join("\n")}\n`);
        return 0;
    }
    if (sub !== "setup") {
        console.error("proofloop agents: expected `list` or `setup`.");
        return 2;
    }
    try {
        const target = adapter ?? "codex";
        const ids = target === "all" ? [...agentAdapters_1.PROOFLOOP_AGENT_ADAPTER_IDS] : [(0, agentAdapters_1.parseProofloopAgentAdapterId)(target)];
        const receipts = [];
        for (const id of ids) {
            receipts.push(await (0, agentAdapters_1.setupProofloopAgentAdapter)({
                adapterId: id,
                root,
                local: options.local === true,
                ...(str(options.command) !== undefined ? { command: str(options.command) } : {}),
            }));
        }
        if (options.json === true) {
            console.log(JSON.stringify(receipts, null, 2));
        }
        else {
            for (const receipt of receipts) {
                console.log(`proofloop agents: ${receipt.adapterId} ${receipt.status} -> ${receipt.receiptPath}`);
                console.log(`  ${receipt.message}`);
                if (receipt.settingsPath)
                    console.log(`  hooks=${receipt.settingsPath}`);
                if (receipt.launchCommand)
                    console.log(`  launch=${receipt.launchCommand}`);
            }
        }
        return receipts.every((receipt) => receipt.status === "ready") ? 0 : 1;
    }
    catch (error) {
        console.error(`proofloop agents: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}
async function runCodexLoopCommand(options, root) {
    try {
        const agentId = (0, agentAdapters_1.parseProofloopAgentAdapterId)(str(options.agent) ?? "codex");
        const result = await (0, agentLoop_1.runProofloopAgentLoop)({
            root,
            agentId,
            dryRun: options["dry-run"] === true,
            ...(str(options.command) !== undefined ? { command: str(options.command) } : {}),
            ...(num(options["max-attempts"]) !== undefined ? { maxAttempts: num(options["max-attempts"]) } : {}),
            ...(str(options["run-id"]) !== undefined ? { runId: str(options["run-id"]) } : {}),
        });
        console.log(`proofloop codex-loop: ${result.passed ? "passed" : "needs-repair"} run=${result.runId} attempts=${result.attempts}`);
        console.log(`  runDir=${result.runDir}`);
        if (result.repairPromptPath)
            console.log(`  repairPrompt=${result.repairPromptPath}`);
        return result.exitCode;
    }
    catch (error) {
        console.error(`proofloop codex-loop: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}
function runCodexCommand(sub, runId, options, root) {
    if (sub !== "reprompt" && sub !== "relaunch") {
        console.error("proofloop codex: expected `reprompt` or `relaunch`.");
        return 2;
    }
    const runDir = runId ? (0, codexRelaunch_1.codexRunDir)(root, runId) : (0, codexRelaunch_1.latestProofloopRunDir)(root);
    if (!runDir) {
        console.error("proofloop codex: no .proofloop/runs/<run-id> directory found. Run `npx proofloop codex-loop --dry-run` first.");
        return 2;
    }
    const promptPath = (0, node_path_1.join)(runDir, "codex-reprompt.md");
    const prompt = (0, codexRelaunch_1.readCodexReprompt)(promptPath);
    if (!prompt) {
        console.error(`proofloop codex: no reprompt found at ${promptPath}.`);
        return 2;
    }
    if (sub === "reprompt") {
        console.log(prompt);
        return 0;
    }
    const result = (0, agentAdapters_1.launchProofloopAgentAdapter)({
        adapterId: "codex",
        promptPath,
        targetDir: root,
        ...(str(options.command) !== undefined ? { command: str(options.command) } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return result.launched && result.status !== "failed" ? 0 : 1;
}
async function runProvidersCommand(sub, provider, options, root) {
    if (sub !== "setup") {
        console.error("proofloop providers: expected `setup`.");
        return 2;
    }
    try {
        const target = provider ?? "all";
        const ids = target === "all" ? [...providerSetup_1.PROOFLOOP_PROVIDER_IDS] : [(0, providerSetup_1.parseProofloopProviderId)(target)];
        const receipts = await (0, providerSetup_1.setupProofloopProviders)(ids, {
            root,
            ...(num(options["timeout-ms"]) !== undefined ? { timeoutMs: num(options["timeout-ms"]) } : {}),
        });
        if (options.json === true) {
            console.log(JSON.stringify(receipts, null, 2));
        }
        else {
            for (const receipt of receipts) {
                console.log(`proofloop providers: ${receipt.providerId} ${receipt.status} -> .proofloop/setup/providers/${receipt.providerId}.json`);
                for (const check of receipt.checks)
                    console.log(`  ${check.id}: ${check.status} - ${check.detail}`);
            }
        }
        return receipts.every((receipt) => receipt.status === "ready") ? 0 : 1;
    }
    catch (error) {
        console.error(`proofloop providers: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}
function runHostedCommand(sub, options, root) {
    if (sub === "run") {
        const requestFile = str(options.request);
        if (!requestFile) {
            console.error("proofloop hosted run: expected --request <queue.json|request.json|run-bundle.json>.");
            return 2;
        }
        try {
            const result = (0, hosted_1.writeHostedWorkerPlan)({
                root,
                requestFile,
                outFile: str(options.out),
            });
            if (options.json === true) {
                console.log(JSON.stringify({ runId: result.bundle.runId, file: result.file, plan: result.plan }, null, 2));
            }
            else {
                console.log([
                    `proofloop hosted run: ${result.plan.status} (${result.bundle.runId})`,
                    `target=${result.plan.targetUrl}`,
                    `worker=${result.plan.worker.mode}`,
                    `artifactRoot=${result.plan.worker.artifactRoot}`,
                    `workerPlan=${result.file}`,
                    ...result.plan.blockers.map((blocker) => `blocked=${blocker}`),
                    ...result.plan.warnings.map((warning) => `warning=${warning}`),
                    "",
                    "Required worker capabilities:",
                    ...result.plan.worker.requiredCapabilities.map((item) => `- ${item}`),
                    "",
                    "Next actions:",
                    ...result.plan.nextActions.map((item) => `- ${item}`),
                ].join("\n"));
            }
            return result.plan.status === "ready_for_managed_worker" ? 0 : 1;
        }
        catch (error) {
            console.error(`proofloop hosted run: ${error.message}`);
            return 2;
        }
    }
    const targetUrl = str(options.url);
    if (!targetUrl) {
        console.error("proofloop hosted: expected --url <https://app.example>.");
        return 2;
    }
    const appType = (str(options["app-type"]) ?? "agent-app");
    const authMode = (str(options["auth-mode"]) ?? "none");
    const visibility = (str(options.visibility) ?? "private");
    const common = {
        targetUrl,
        appType,
        intendedAudience: str(options.audience),
        primaryGoal: str(options.goal),
        authMode,
        authNotes: str(options["auth-notes"]),
        budgetUsd: num(options["budget-usd"]) ?? 0,
        families: parseCsv(str(options.families)),
        consentAccepted: options.consent === true,
        ownsOrAuthorized: options.authorized === true || options.consent === true,
        allowBrowserAutomation: options["allow-browser"] === true || options.consent === true,
        allowRecording: options.record === true || options.consent === true,
        contactEmail: str(options.email),
        visibility,
        allowlistedHosts: parseCsv(str(options["allow-hosts"])),
    };
    if (sub === "validate") {
        const request = (0, hosted_1.createHostedRunRequest)(common);
        const validation = (0, hosted_1.validateHostedRunRequest)(request, { allowlistedHosts: common.allowlistedHosts });
        const permission = (0, hosted_1.verifyHostedDomainPermission)(request, { allowlistedHosts: common.allowlistedHosts });
        console.log(JSON.stringify({ request, validation, permission }, null, 2));
        return validation.ok ? 0 : 1;
    }
    if (sub === "dashboard") {
        console.log((0, hosted_1.buildHostedRunBundle)(common).dashboardHtml);
        return 0;
    }
    if (sub === "intake" || sub === undefined) {
        const result = (0, hosted_1.writeHostedRunBundle)({
            root,
            outDir: str(options.out),
            ...common,
        });
        const validation = (0, hosted_1.validateHostedRunRequest)(result.bundle.request, { allowlistedHosts: common.allowlistedHosts });
        const runbook = (0, hosted_1.renderHostedRunbook)(result.bundle);
        if (options.json === true) {
            console.log(JSON.stringify({ runId: result.bundle.runId, validation, files: result.files, bundle: result.bundle }, null, 2));
        }
        else {
            console.log([
                `proofloop hosted intake: ${validation.ok ? "ready" : "needs-permission"} (${result.bundle.runId})`,
                `target=${result.bundle.request.targetUrl}`,
                `appType=${result.bundle.request.appType}`,
                `permission=${result.bundle.permission.status}`,
                `queue=${result.bundle.runner.queuePath}`,
                `dashboard=${result.bundle.artifactContract.dashboard}`,
                ...validation.blockers.map((blocker) => `blocked=${blocker}`),
                ...validation.warnings.map((warning) => `warning=${warning}`),
                "",
                runbook,
            ].join("\n"));
        }
        return validation.ok ? 0 : 1;
    }
    console.error(`proofloop hosted: unknown subcommand "${sub}". Expected intake, validate, dashboard, or run.`);
    return 2;
}
function parseFeatures(value) {
    if (!value)
        return [];
    return value.split(",").map((part) => part.trim()).filter(Boolean);
}
function parseCsv(value) {
    if (!value)
        return [];
    return value.split(",").map((part) => part.trim()).filter(Boolean);
}
function parseReceiptKind(value) {
    if (value === undefined || value === "nodeagent-ingestion")
        return "nodeagent-ingestion";
    return undefined;
}
function parseBaselineSource(value) {
    if (value === undefined)
        return "estimated";
    if (value === "measured" || value === "historical" || value === "benchmark" || value === "research" || value === "estimated")
        return value;
    return undefined;
}
function runManifestCommand(options, root) {
    const manifest = (0, project_1.buildProofloopProjectManifest)(root);
    if (options.dense === true) {
        console.log((0, project_1.formatProofloopProjectManifestDense)(manifest));
    }
    else {
        console.log(JSON.stringify(manifest, null, 2));
    }
    return 0;
}
function runDocsCommand(sub, options) {
    if (sub !== "agents") {
        console.error("proofloop docs: expected `agents`.");
        return 2;
    }
    const dense = [
        "proofloop-agent-docs",
        "setup=npx proofloop init --agent auto --live",
        "doctor=npx proofloop doctor --json",
        "manifest=npx proofloop manifest --dense",
        "target=npx proofloop target --write-runner-plan",
        "context=.proofloop/reports/latest.md",
        "agent-os=docs/agent-os/README.md",
        "ui=npx proofloop ui contract --dense",
        "gate=npx proofloop gate",
        "resume=npx proofloop resume --dense",
        "mcp=npx proofloop mcp",
    ].join("\n");
    console.log(options.json === true ? JSON.stringify({ commands: dense.split("\n").slice(1) }, null, 2) : `${dense}\n`);
    return 0;
}
function runTemplateCommand(sub, options, root) {
    if (options.list === true || sub === "--list" || sub === undefined) {
        const templates = (0, project_1.listProofloopTemplates)();
        console.log(options.json === true ? JSON.stringify(templates, null, 2) : (0, project_1.formatProofloopTemplateList)(templates));
        return 0;
    }
    if (options.write === true) {
        try {
            const written = (0, project_1.writeProofloopTemplate)(root, sub, options.force === true);
            console.log(`proofloop template: wrote/kept ${written.length} file(s) for ${sub}`);
            for (const path of written)
                console.log(`  ${path}`);
            return 0;
        }
        catch (error) {
            console.error(`proofloop template: ${error instanceof Error ? error.message : String(error)}`);
            return 2;
        }
    }
    const template = (0, project_1.listProofloopTemplates)().find((entry) => entry.id === sub);
    if (!template) {
        console.error(`proofloop template: unknown template "${sub}". Run \`proofloop template --list\`.`);
        return 2;
    }
    console.log(options.json === true ? JSON.stringify(template, null, 2) : `${template.id}: ${template.title}\n${template.workflow}\n`);
    return 0;
}
function runWorkflowCommand(options, root) {
    const workflows = (0, project_1.listProofloopWorkflows)(root);
    console.log(options.json === true ? JSON.stringify({ workflows }, null, 2) : `${workflows.join("\n") || "none"}\n`);
    return 0;
}
function runUiCommand(sub, component, options, root) {
    const contracts = (0, project_1.discoverUiContracts)(root);
    if (sub === "contract" || sub === "list" || sub === undefined) {
        console.log(options.json === true ? JSON.stringify(contracts, null, 2) : (0, project_1.formatUiContractsDense)(contracts));
        return 0;
    }
    if (sub === "component") {
        if (!component) {
            console.error("proofloop ui component: expected component id.");
            return 2;
        }
        const matches = contracts.filter((contract) => contract.id === component);
        console.log(options.json === true ? JSON.stringify(matches, null, 2) : (0, project_1.formatUiContractsDense)(matches));
        return matches.length > 0 ? 0 : 2;
    }
    console.error("proofloop ui: expected `contract`, `list`, or `component <id>`.");
    return 2;
}
function runResumeCommand(options, root) {
    const resume = (0, project_1.buildResume)(root);
    console.log(options.json === true ? JSON.stringify(resume.json, null, 2) : resume.dense);
    return 0;
}
function runReportCommand(sub, options, root) {
    if (sub !== undefined && sub !== "latest") {
        console.error("proofloop report: only `latest` is supported.");
        return 2;
    }
    const report = (0, project_1.buildReport)(root);
    console.log(options.json === true ? JSON.stringify(report.json, null, 2) : report.text);
    return 0;
}
function runChartsCommand(sub, root) {
    if (sub !== undefined && sub !== "latest") {
        console.error("proofloop charts: only `latest` is supported.");
        return 2;
    }
    const result = (0, project_1.writeProofloopCharts)(root);
    console.log(`proofloop charts: wrote ${result.jsonPath}`);
    console.log(`proofloop charts: wrote ${result.svgPath}`);
    return 0;
}
function runReceiptCommand(sub, action, options, root) {
    if (sub === "schema") {
        if (action !== undefined) {
            console.error("proofloop receipt schema: unexpected positional argument.");
            return 2;
        }
        if (options.json === true)
            console.log(JSON.stringify((0, proofReceipt_1.readProofReceiptSchema)(), null, 2));
        else
            console.log((0, proofReceipt_1.proofReceiptSchemaPath)());
        return 0;
    }
    if (sub === "envelope") {
        if (action !== "verify") {
            console.error("proofloop receipt envelope: expected `verify`.");
            return 2;
        }
        const filePath = str(options.file);
        if (!filePath) {
            console.error("proofloop receipt envelope verify: --file <path> is required.");
            return 2;
        }
        return (0, proofReceipt_1.runProofReceiptEnvelopeVerify)({
            root,
            filePath,
            json: options.json === true,
        });
    }
    if (sub !== "verify" || action !== undefined) {
        console.error("proofloop receipt: expected `verify`, `envelope verify`, or `schema`.");
        return 2;
    }
    const filePath = str(options.file);
    if (!filePath) {
        console.error("proofloop receipt verify: --file <path> is required.");
        return 2;
    }
    const kind = parseReceiptKind(str(options.kind));
    if (!kind) {
        console.error("proofloop receipt verify: unsupported --kind. Supported: nodeagent-ingestion.");
        return 2;
    }
    return (0, receipts_1.runReceiptVerify)({
        root,
        filePath,
        kind,
        ...(num(options["min-documents"]) !== undefined ? { minDocuments: num(options["min-documents"]) } : {}),
        ...(num(options["min-memory-objects"]) !== undefined ? { minMemoryObjects: num(options["min-memory-objects"]) } : {}),
        json: options.json === true,
    });
}
function runEaseCommand(sub, options, root) {
    if (sub !== "verify") {
        console.error("proofloop ease: expected `verify`.");
        return 2;
    }
    const manifestPath = str(options.manifest) ?? "proof/ease/latest/manifest.json";
    return (0, easeProof_1.runEaseProofVerify)({
        root,
        manifestPath,
        ...(str(options.out) !== undefined ? { outputPath: str(options.out) } : {}),
        json: options.json === true,
    });
}
async function runRunnerCommand(sub, options, root) {
    if (sub !== "run" && sub !== "resume" && sub !== "status" && sub !== "report") {
        console.error("proofloop runner: expected `run`, `resume`, `status`, or `report`.");
        return 2;
    }
    const result = await (0, runner_1.runProofloopRunner)({
        root,
        subcommand: sub,
        ...(str(options.plan) !== undefined ? { planPath: str(options.plan) } : {}),
        ...(str(options["run-id"]) !== undefined ? { runId: str(options["run-id"]) } : {}),
        ...(num(options["budget-usd"]) !== undefined ? { budgetUsd: num(options["budget-usd"]) } : {}),
        ...(num(options["max-tasks"]) !== undefined ? { maxTasks: num(options["max-tasks"]) } : {}),
        ...(num(options["lock-ttl-ms"]) !== undefined ? { lockTtlMs: num(options["lock-ttl-ms"]) } : {}),
        clearStaleLock: options["clear-stale-lock"] === true,
        ...(str(options["crash-after-start"]) !== undefined ? { crashAfterStartTaskId: str(options["crash-after-start"]) } : {}),
        json: options.json === true,
    });
    return result.exitCode;
}
async function runProgramCommand(sub, options, root) {
    if (sub === "verify-nodekit") {
        const releaseProofPath = str(options.file);
        const candidateCommit = str(options["candidate-commit"]);
        if (!releaseProofPath || !candidateCommit) {
            console.error("proofloop program verify-nodekit: requires --file <proof/release-proof.json> and --candidate-commit <sha>.");
            return 2;
        }
        const minimumLevel = str(options["minimum-level"]);
        if (minimumLevel !== undefined && minimumLevel !== "local-ready" && minimumLevel !== "release-ready") {
            console.error("proofloop program verify-nodekit: --minimum-level must be local-ready or release-ready.");
            return 2;
        }
        return (0, nodekitProof_1.runNodekitProofBindingVerify)({
            root,
            releaseProofPath,
            candidateCommit,
            ...(minimumLevel !== undefined ? { minimumLevel: minimumLevel } : {}),
            ...(str(options["compiled-definition"]) !== undefined ? { compiledDefinitionPath: str(options["compiled-definition"]) } : {}),
            ...(str(options["config-hash-file"]) !== undefined ? { configHashPath: str(options["config-hash-file"]) } : {}),
            ...(str(options.discovery) !== undefined ? { discoveryPath: str(options.discovery) } : {}),
            json: options.json === true,
        });
    }
    if (sub !== "run" && sub !== "resume" && sub !== "status" && sub !== "report") {
        console.error("proofloop program: expected `run`, `resume`, `status`, `report`, or `verify-nodekit`.");
        return 2;
    }
    const result = await (0, program_1.runProofloopProgram)({
        root,
        subcommand: sub,
        ...(str(options.plan) !== undefined ? { planPath: str(options.plan) } : {}),
        ...(str(options["run-id"]) !== undefined ? { runId: str(options["run-id"]) } : {}),
        ...(num(options["budget-usd"]) !== undefined ? { budgetUsd: num(options["budget-usd"]) } : {}),
        ...(num(options["max-arcs"]) !== undefined ? { maxArcs: num(options["max-arcs"]) } : {}),
        ...(num(options["lock-ttl-ms"]) !== undefined ? { lockTtlMs: num(options["lock-ttl-ms"]) } : {}),
        clearStaleLock: options["clear-stale-lock"] === true,
        json: options.json === true,
    });
    return result.exitCode;
}
async function runTargetCommand(options, root) {
    const result = await (0, targetPlan_1.runProofloopTarget)({
        root,
        ...(str(options.url) !== undefined ? { url: str(options.url) } : {}),
        ...(str(options.out) !== undefined ? { outPath: str(options.out) } : {}),
        writeRunnerPlan: options["write-runner-plan"] === true || options.runner === true,
        writeBrowserSmoke: options["write-browser-smoke"] === true,
        json: options.json === true,
        dense: options.dense === true,
        ...(num(options["timeout-ms"]) !== undefined ? { timeoutMs: num(options["timeout-ms"]) } : {}),
    });
    return result.exitCode;
}
function runMaturityCommand(options, root) {
    const targetLevel = num(options["target-level"]);
    if (options.write === true) {
        const result = (0, maturity_1.writeAgentEraMaturityReport)({
            root,
            ...(targetLevel !== undefined ? { targetLevel } : {}),
            ...(str(options.out) !== undefined ? { outPath: str(options.out) } : {}),
        });
        if (options.json === true) {
            console.log(JSON.stringify({ markdownPath: result.markdownPath, jsonPath: result.jsonPath, report: result.report }, null, 2));
        }
        else {
            console.log(`proofloop maturity: wrote ${result.markdownPath}`);
            console.log(`proofloop maturity: wrote ${result.jsonPath}`);
            console.log((0, maturity_1.formatAgentEraMaturityDense)(result.report));
        }
        return 0;
    }
    const report = (0, maturity_1.assessAgentEraMaturity)({
        root,
        ...(targetLevel !== undefined ? { targetLevel } : {}),
    });
    if (options.json === true) {
        console.log(JSON.stringify(report, null, 2));
    }
    else if (options.dense === true) {
        console.log((0, maturity_1.formatAgentEraMaturityDense)(report));
    }
    else {
        console.log(report.reportMarkdown);
    }
    return 0;
}
function runProductivityCommand(options, root) {
    const baselineSource = parseBaselineSource(str(options["baseline-source"]));
    if (!baselineSource) {
        console.error("proofloop productivity: unsupported --baseline-source. Use measured, historical, benchmark, research, or estimated.");
        return 2;
    }
    const common = {
        root,
        ...(str(options["run-id"]) !== undefined ? { runId: str(options["run-id"]) } : {}),
        ...(str(options["workflow-id"]) !== undefined ? { workflowId: str(options["workflow-id"]) } : {}),
        baselineSource,
        ...(num(options["dev-hours"]) !== undefined ? { devHours: num(options["dev-hours"]) } : {}),
        ...(num(options["qa-hours"]) !== undefined ? { qaHours: num(options["qa-hours"]) } : {}),
        ...(num(options["research-hours"]) !== undefined ? { researchHours: num(options["research-hours"]) } : {}),
        ...(num(options["designer-hours"]) !== undefined ? { designerHours: num(options["designer-hours"]) } : {}),
        ...(num(options.confidence) !== undefined ? { confidence: num(options.confidence) } : {}),
        ...(num(options["human-review-hours"]) !== undefined ? { humanReviewHours: num(options["human-review-hours"]) } : {}),
        ...(num(options["model-cost-usd"]) !== undefined ? { modelCostUsd: num(options["model-cost-usd"]) } : {}),
        ...(num(options["browser-cost-usd"]) !== undefined ? { browserCostUsd: num(options["browser-cost-usd"]) } : {}),
        ...(num(options["ci-cost-usd"]) !== undefined ? { ciCostUsd: num(options["ci-cost-usd"]) } : {}),
        regressionAdded: options["regression-added"] === true,
        liveBrowserVerified: options["live-browser-verified"] === true,
        deterministicGateAdded: options["deterministic-gate-added"] === true ? true : undefined,
    };
    if (options.write === true) {
        const result = (0, productivity_1.writeProductivityProofPack)({
            ...common,
            ...(str(options.out) !== undefined ? { outDir: str(options.out) } : {}),
        });
        if (options.json === true) {
            console.log(JSON.stringify({ runDir: result.runDir, files: result.files, ledger: result.pack.ledger }, null, 2));
        }
        else {
            console.log(`proofloop productivity: wrote ${result.files.ledger}`);
            console.log(`proofloop productivity: wrote ${result.files.scorecard}`);
            for (const chart of result.files.charts)
                console.log(`proofloop productivity: wrote ${chart}`);
            console.log((0, productivity_1.formatProductivityDense)(result.pack, result.runDir));
        }
        return 0;
    }
    const pack = (0, productivity_1.buildProductivityProofPack)(common);
    if (options.json === true) {
        console.log(JSON.stringify(pack, null, 2));
    }
    else {
        console.log((0, productivity_1.formatProductivityDense)(pack));
    }
    return 0;
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
    Promise.resolve(runCli(process.argv.slice(2))).then((code) => {
        if (code !== exports.MCP_SERVER_RUNNING)
            process.exit(code);
    }).catch((error) => {
        console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(2);
    });
}
