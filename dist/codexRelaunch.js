"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeCodexRelaunchPacket = writeCodexRelaunchPacket;
exports.readCodexReprompt = readCodexReprompt;
exports.codexRunDir = codexRunDir;
exports.latestProofloopRunDir = latestProofloopRunDir;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function writeCodexRelaunchPacket(args) {
    const packetPath = (0, node_path_1.join)(args.runDir, "codex-relaunch.json");
    const promptPath = (0, node_path_1.join)(args.runDir, "codex-reprompt.md");
    if (args.verdict.passed && !args.force)
        return { wrote: false, packetPath, promptPath };
    const root = (0, node_path_1.resolve)(args.root ?? process.cwd());
    (0, node_fs_1.mkdirSync)(args.runDir, { recursive: true });
    const packet = {
        schema: "proofloop-codex-relaunch-v1",
        generatedAt: new Date().toISOString(),
        runId: args.verdict.runId,
        suite: args.verdict.suite,
        passed: false,
        failure: {
            exitCode: args.verdict.exitCode,
            failedGates: args.verdict.failedGates ?? [],
            ...(args.verdict.score !== undefined ? { score: args.verdict.score } : {}),
            ...(args.verdict.minScore !== undefined ? { minScore: args.verdict.minScore } : {}),
        },
        receipts: {
            repairPrompt: rel(root, args.repairPromptPath),
            proofReceipts: args.verdict.receiptPaths,
        },
        commands: {
            gate: "npx proofloop gate",
            codexReprompt: `npx proofloop codex reprompt ${args.verdict.runId}`,
            codexRelaunch: `npx proofloop codex relaunch ${args.verdict.runId}`,
            installCodexHooks: "npx proofloop hooks install --worker codex --local",
        },
        codexPrompt: renderCodexReprompt({
            verdict: args.verdict,
            repairPromptPath: rel(root, args.repairPromptPath),
        }),
    };
    writeJson(packetPath, packet);
    (0, node_fs_1.writeFileSync)(promptPath, `${packet.codexPrompt}\n`, "utf8");
    return { wrote: true, packetPath, promptPath, packet };
}
function readCodexReprompt(path) {
    return (0, node_fs_1.existsSync)(path) ? (0, node_fs_1.readFileSync)(path, "utf8") : "";
}
function codexRunDir(root, runId) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), ".proofloop", "runs", runId);
}
function latestProofloopRunDir(root) {
    const runsDir = (0, node_path_1.join)((0, node_path_1.resolve)(root), ".proofloop", "runs");
    if (!(0, node_fs_1.existsSync)(runsDir))
        return undefined;
    return (0, node_fs_1.readdirSync)(runsDir)
        .map((name) => (0, node_path_1.join)(runsDir, name))
        .filter((path) => (0, node_fs_1.existsSync)(path) && (0, node_fs_1.statSync)(path).isDirectory())
        .sort((a, b) => (0, node_fs_1.statSync)(b).mtimeMs - (0, node_fs_1.statSync)(a).mtimeMs)[0];
}
function renderCodexReprompt(args) {
    const gates = args.verdict.failedGates?.length ? args.verdict.failedGates.join(", ") : `exit_${args.verdict.exitCode}`;
    const receipts = args.verdict.receiptPaths.length ? args.verdict.receiptPaths.join("\n- ") : "none";
    return [
        "# Codex Proof Loop Repair Prompt",
        "",
        "You are Codex repairing a failed Proof Loop run. Do not claim the work is done until the deterministic gate or proof receipt passes.",
        "",
        `Run: ${args.verdict.runId}`,
        `Suite: ${args.verdict.suite}`,
        `Command: ${args.verdict.cmd}`,
        `Failed gates: ${gates}`,
        `Repair prompt: ${args.repairPromptPath}`,
        "",
        "Proof receipts:",
        `- ${receipts}`,
        "",
        "Required loop:",
        "1. Read the repair prompt and receipts above.",
        "2. Make the smallest product or harness change that addresses the first failing gate.",
        "3. Add or update deterministic coverage for the failure.",
        "4. Rerun `npx proofloop gate`.",
        "5. Stop only after the verifier passes and the new receipt is recorded.",
    ].join("\n");
}
function rel(root, path) {
    const relativePath = (0, node_path_1.relative)(root, path).replace(/\\/g, "/");
    return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
