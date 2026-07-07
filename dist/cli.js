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
 *   proofloop this-repo [--goal ...] [--write-runner-plan] [--run]
 *   proofloop manifest|docs|template|workflow|ui|resume|report|charts|receipt|mcp
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
const receipts_1 = require("./receipts");
const mcp_1 = require("./mcp");
const project_1 = require("./project");
const runner_1 = require("./runner");
const targetPlan_1 = require("./targetPlan");
const hosted_1 = require("./hosted");
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
        "  runner run|resume|status|report   durable append-only task runner with budget and resume",
        "  hosted intake|validate|dashboard|run   create or resume a hosted URL proof packet",
        "  target [--url <url>] [--write-runner-plan] [--write-browser-smoke]   recommend benchmark families and write target/context receipts",
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
            return runReceiptCommand(positional[1], options, root);
        case "runner":
            return runRunnerCommand(positional[1], options, root);
        case "hosted":
            return runHostedCommand(positional[1], options, root);
        case "target":
            return runTargetCommand(options, root);
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
function runReceiptCommand(sub, options, root) {
    if (sub !== "verify") {
        console.error("proofloop receipt: expected `verify`.");
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
