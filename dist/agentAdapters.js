"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROOFLOOP_AGENT_ADAPTER_IDS = void 0;
exports.parseProofloopAgentAdapterId = parseProofloopAgentAdapterId;
exports.getProofloopAgentAdapter = getProofloopAgentAdapter;
exports.setupProofloopAgentAdapter = setupProofloopAgentAdapter;
exports.launchProofloopAgentAdapter = launchProofloopAgentAdapter;
exports.collectProofloopAgentTrace = collectProofloopAgentTrace;
exports.buildAgentRepairPrompt = buildAgentRepairPrompt;
exports.writeAgentRepairAttemptReceipt = writeAgentRepairAttemptReceipt;
exports.agentSetupReceiptPath = agentSetupReceiptPath;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const proofloopHooks_1 = require("./proofloopHooks");
exports.PROOFLOOP_AGENT_ADAPTER_IDS = ["codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"];
function parseProofloopAgentAdapterId(value) {
    if (exports.PROOFLOOP_AGENT_ADAPTER_IDS.includes(value))
        return value;
    throw new Error(`Unknown agent adapter ${value}. Expected one of: ${exports.PROOFLOOP_AGENT_ADAPTER_IDS.join(", ")}`);
}
function getProofloopAgentAdapter(id) {
    return {
        id,
        installHooks: (targetDir, options) => setupProofloopAgentAdapter({ adapterId: id, root: targetDir, ...options }),
        launch: (promptPath, targetDir, options) => Promise.resolve(launchProofloopAgentAdapter({ adapterId: id, promptPath, targetDir, ...options })),
        collectTrace: (runDir) => Promise.resolve(collectProofloopAgentTrace({ adapterId: id, runDir })),
        buildRepairPrompt: (verdict, options) => Promise.resolve(buildAgentRepairPrompt({ adapterId: id, verdict, ...options })),
    };
}
async function setupProofloopAgentAdapter(args) {
    const root = (0, node_path_1.resolve)(args.root ?? process.cwd());
    const generatedAt = args.generatedAt ?? new Date().toISOString();
    const hookHost = hookWorkerForAgent(args.adapterId);
    const command = args.command ?? defaultLaunchCommand(args.adapterId, process.env);
    let status = hookHost || command ? "ready" : "needs_adapter";
    let settingsPath;
    let message = adapterSetupMessage(args.adapterId, status);
    if (hookHost) {
        const installed = (0, proofloopHooks_1.installProofloopHooks)({ root, worker: hookHost, local: args.local ?? true });
        settingsPath = rel(root, installed.settingsPath);
        message = `${args.adapterId} hooks installed via ${hookHost}.`;
    }
    else if (args.adapterId === "generic-cli" && !command) {
        status = "needs_command";
        message = "generic-cli requires --command or PROOFLOOP_GENERIC_AGENT_COMMAND.";
    }
    const receipt = {
        schema: "proofloop-agent-adapter-setup-v1",
        generatedAt,
        adapterId: args.adapterId,
        status,
        ...(hookHost ? { hookHost } : {}),
        ...(settingsPath ? { settingsPath } : {}),
        message,
        ...(command ? { launchCommand: command } : {}),
        traceCapture: traceCaptureForAgent(args.adapterId),
        gateEnforcement: gateEnforcementForAgent(args.adapterId, hookHost),
        nextCommands: nextCommandsForAgent(args.adapterId, status),
        receiptPath: rel(root, agentSetupReceiptPath(root, args.adapterId)),
    };
    writeJson(agentSetupReceiptPath(root, args.adapterId), receipt);
    return receipt;
}
function launchProofloopAgentAdapter(args) {
    const targetDir = (0, node_path_1.resolve)(args.targetDir ?? process.cwd());
    const env = args.env ?? process.env;
    const command = args.command ?? defaultLaunchCommand(args.adapterId, env);
    if (!command) {
        const status = args.adapterId === "generic-cli" ? "needs_command" : "needs_adapter";
        return {
            adapterId: args.adapterId,
            status,
            launched: false,
            promptPath: rel(targetDir, args.promptPath),
            message: `${args.adapterId} has no launch command configured.`,
        };
    }
    const prompt = (0, node_fs_1.readFileSync)(args.promptPath, "utf8");
    const result = (0, node_child_process_1.spawnSync)(command, {
        cwd: targetDir,
        shell: true,
        input: prompt,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        env: {
            ...env,
            PROOFLOOP_AGENT_ADAPTER: args.adapterId,
            PROOFLOOP_REPAIR_PROMPT: args.promptPath,
        },
    });
    const stdoutPath = (0, node_path_1.join)((0, node_path_1.dirname)(args.promptPath), `${safeAgentId(args.adapterId)}-stdout.log`);
    const stderrPath = (0, node_path_1.join)((0, node_path_1.dirname)(args.promptPath), `${safeAgentId(args.adapterId)}-stderr.log`);
    (0, node_fs_1.writeFileSync)(stdoutPath, result.stdout ?? "", "utf8");
    (0, node_fs_1.writeFileSync)(stderrPath, result.stderr ?? "", "utf8");
    const exitCode = result.status ?? 1;
    return {
        adapterId: args.adapterId,
        status: exitCode === 0 ? "launched" : "failed",
        launched: true,
        command,
        promptPath: rel(targetDir, args.promptPath),
        exitCode,
        stdoutPath: rel(targetDir, stdoutPath),
        stderrPath: rel(targetDir, stderrPath),
        message: exitCode === 0 ? `${args.adapterId} completed; rerun the Proof Loop gate.` : `${args.adapterId} exited ${exitCode}.`,
    };
}
function collectProofloopAgentTrace(args) {
    const root = (0, node_path_1.resolve)(args.root ?? process.cwd());
    const evidenceFiles = (0, node_fs_1.existsSync)(args.runDir)
        ? (0, node_fs_1.readdirSync)(args.runDir)
            .filter((name) => /trace|eval|receipt|prompt|stdout|stderr|tooluse|meta|ledger|relaunch/i.test(name))
            .map((name) => rel(root, (0, node_path_1.join)(args.runDir, name)))
        : [];
    return {
        schema: "proofloop-agent-trace-v1",
        adapterId: args.adapterId,
        runDir: rel(root, args.runDir),
        evidenceFiles,
    };
}
function buildAgentRepairPrompt(args) {
    const failedGates = args.verdict.failedGates?.length ? args.verdict.failedGates.join("\n- ") : `Command exited ${args.verdict.exitCode}`;
    const attempt = args.attempt ?? 1;
    const maxAttempts = args.maxAttempts ?? 1;
    return [
        `You are ${agentDisplayName(args.adapterId)} continuing a Proof Loop repair loop. Fix the product or harness code so the next Proof Loop gate passes.`,
        "",
        "Non-negotiable rules:",
        "- Do not weaken verifiers, skip gates, lower thresholds, delete required evidence, or edit protected .proofloop hook/tooluse state.",
        "- If setup is missing, install or configure the local setup path instead of claiming it is blocked.",
        "- Exercise the real live UI path when the failure is a browser/live proof failure.",
        "- After changes, run the exact next command below and rely on its receipt, not a chat summary.",
        "",
        `Adapter: ${args.adapterId}`,
        `Loop attempt: ${attempt}/${maxAttempts}`,
        `Failed suite: ${args.verdict.suite}`,
        `Failed run: ${args.verdict.runId}`,
        `Failed command: ${args.verdict.cmd}`,
        `Score: ${args.verdict.score ?? "n/a"}/${args.verdict.minScore ?? "n/a"}`,
        "Failed gates:",
        `- ${failedGates}`,
        "",
        "Receipt paths:",
        ...(args.verdict.receiptPaths.length ? args.verdict.receiptPaths.map((path) => `- ${path}`) : ["- none"]),
        "",
        "Repair context from Proof Loop:",
        (args.repairPrompt ?? "").trim() || "(none)",
        "",
        "Next command after repair:",
        "npx proofloop gate",
        "",
    ].join("\n");
}
function writeAgentRepairAttemptReceipt(args) {
    const path = (0, node_path_1.join)(args.runDir, `${safeAgentId(args.adapterId)}-repair-attempt.json`);
    const receipt = {
        schema: "proofloop-agent-repair-attempt-v1",
        generatedAt: args.generatedAt ?? new Date().toISOString(),
        adapterId: args.adapterId,
        suite: args.meta.suite,
        failedRunId: args.meta.runId,
        attempt: args.attempt,
        maxAttempts: args.maxAttempts,
        repairPromptPath: rel(args.root, args.repairPromptPath),
        runResult: args.runResult,
        nextRunCommand: "npx proofloop gate",
    };
    writeJson(path, receipt);
    return path;
}
function agentSetupReceiptPath(root, adapterId) {
    return (0, node_path_1.join)(root, ".proofloop", "setup", "agents", `${safeAgentId(adapterId)}.json`);
}
function hookWorkerForAgent(adapterId) {
    if (adapterId === "codex")
        return "codex";
    if (adapterId === "claude-code")
        return "claude-code";
    return undefined;
}
function defaultLaunchCommand(adapterId, env) {
    if (adapterId === "codex")
        return env.PROOFLOOP_CODEX_COMMAND?.trim() || "codex exec --json";
    if (adapterId === "claude-code")
        return env.PROOFLOOP_CLAUDE_CODE_COMMAND?.trim() || env.CLAUDE_CODE_COMMAND?.trim() || "claude --print --input-format text";
    if (adapterId === "generic-cli")
        return env.PROOFLOOP_GENERIC_AGENT_COMMAND?.trim();
    return undefined;
}
function adapterSetupMessage(adapterId, status) {
    if (status === "ready")
        return `${adapterId} adapter is ready.`;
    if (adapterId === "cursor")
        return "Cursor needs a wrapper or extension command that can accept a repair prompt and export session evidence.";
    if (adapterId === "windsurf")
        return "Windsurf needs a Cascade/session adapter that can accept a repair prompt and export session evidence.";
    if (adapterId === "devin")
        return "Devin needs API/session export and relaunch hooks before Proof Loop can automate it.";
    return `${adapterId} adapter needs a launch command.`;
}
function traceCaptureForAgent(adapterId) {
    if (adapterId === "codex" || adapterId === "claude-code" || adapterId === "generic-cli") {
        return ["Proof Loop gate receipts", ".proofloop/tooluse/log.jsonl", "agent stdout/stderr", "git diff"];
    }
    return ["adapter-required: command logs", "adapter-required: file diffs", "adapter-required: screenshots/tool calls"];
}
function gateEnforcementForAgent(adapterId, hookHost) {
    if (hookHost)
        return [`${hookHost} Stop hook`, `${hookHost} PreToolUse guard`, "Proof Loop verifier receipts"];
    if (adapterId === "generic-cli")
        return ["wrapper CLI exit code", "Proof Loop verifier receipts"];
    return ["adapter-required: hook, wrapper CLI, or policy layer"];
}
function nextCommandsForAgent(adapterId, status) {
    if (status === "ready") {
        return [
            `npx proofloop codex-loop --agent ${adapterId}`,
            `npx proofloop agents setup ${adapterId}`,
            "npx proofloop gate",
        ];
    }
    if (status === "needs_command")
        return [`npx proofloop agents setup ${adapterId} --command "<agent command>"`];
    return [`Implement a ${adapterId} launch/trace/gate adapter, then rerun agents setup.`];
}
function agentDisplayName(adapterId) {
    if (adapterId === "claude-code")
        return "Claude Code";
    if (adapterId === "generic-cli")
        return "a generic CLI agent";
    return adapterId[0].toUpperCase() + adapterId.slice(1);
}
function safeAgentId(adapterId) {
    return adapterId.replace(/[^a-z0-9-]/gi, "-");
}
function rel(root, path) {
    const relativePath = (0, node_path_1.relative)(root, path).replace(/\\/g, "/");
    return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
