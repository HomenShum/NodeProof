"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProofloopAgentLoop = runProofloopAgentLoop;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const agentAdapters_1 = require("./agentAdapters");
const codexRelaunch_1 = require("./codexRelaunch");
const gate_1 = require("./gate");
async function runProofloopAgentLoop(options) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const agentId = options.agentId ?? "codex";
    const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
    const runId = options.runId ?? `gate-${compactTimestamp(new Date())}`;
    const runDir = (0, node_path_1.join)(root, ".proofloop", "runs", runId);
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    let lastExit = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        lastExit = (0, gate_1.runGateCli)({
            root,
            log: options.log ?? console.log,
            logError: options.logError ?? console.error,
        });
        const state = readGateState(root);
        const verdict = verdictFromGate(runId, state, lastExit);
        writeJson((0, node_path_1.join)(runDir, `gate-attempt-${attempt}.json`), state ?? { missing: (0, gate_1.gateStatePath)(root), exitCode: lastExit });
        if (verdict.passed) {
            return { runId, exitCode: 0, attempts: attempt, passed: true, runDir };
        }
        const repairPromptPath = (0, node_path_1.join)(runDir, `${safeAgentId(agentId)}-repair-prompt-${attempt}.md`);
        const prompt = (0, agentAdapters_1.buildAgentRepairPrompt)({
            adapterId: agentId,
            verdict,
            repairPrompt: repairContextFromGate(state),
            attempt,
            maxAttempts,
        });
        (0, node_fs_1.writeFileSync)(repairPromptPath, prompt, "utf8");
        if (agentId === "codex")
            (0, codexRelaunch_1.writeCodexRelaunchPacket)({ root, runDir, verdict, repairPromptPath, force: true });
        const runResult = options.dryRun
            ? {
                adapterId: agentId,
                status: "needs_command",
                launched: false,
                promptPath: repairPromptPath,
                message: "dry run; agent was not launched",
            }
            : (0, agentAdapters_1.launchProofloopAgentAdapter)({
                adapterId: agentId,
                promptPath: repairPromptPath,
                targetDir: root,
                ...(options.command ? { command: options.command } : {}),
            });
        (0, agentAdapters_1.writeAgentRepairAttemptReceipt)({
            root,
            runDir,
            adapterId: agentId,
            meta: verdict,
            repairPromptPath,
            attempt,
            maxAttempts,
            runResult,
        });
        if (options.dryRun || !runResult.launched || runResult.status === "failed") {
            return { runId, exitCode: lastExit || 1, attempts: attempt, passed: false, runDir, repairPromptPath };
        }
    }
    return { runId, exitCode: lastExit || 1, attempts: maxAttempts, passed: false, runDir };
}
function readGateState(root) {
    const path = (0, gate_1.gateStatePath)(root);
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
function verdictFromGate(runId, state, exitCode) {
    const failedChecks = state?.checks.filter((check) => !check.pass).map((check) => check.name) ?? [];
    return {
        runId,
        suite: "proofloop-gate",
        cmd: "npx proofloop gate",
        passed: exitCode === 0,
        exitCode,
        failedGates: failedChecks.length ? failedChecks : exitCode === 0 ? [] : [state?.status ?? "gate_unavailable"],
        receiptPaths: [".proofloop/gate-state.json"],
    };
}
function repairContextFromGate(state) {
    if (!state)
        return "No gate-state.json was produced. Run `npx proofloop doctor --json` and configure proofloop.config.json checks.";
    if (state.status === "no_gate")
        return "No proof gate is configured. Add deterministic proofloop.config.json gate.checks before claiming done.";
    const failed = state.checks.filter((check) => !check.pass);
    if (!failed.length)
        return `Gate status is ${state.status}.`;
    return failed.map((check) => `${check.name}: ${check.command} exited ${check.exitCode ?? "error"} after ${check.ms}ms`).join("\n");
}
function compactTimestamp(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}
function safeAgentId(adapterId) {
    return adapterId.replace(/[^a-z0-9-]/gi, "-");
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
