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
/**
 * One small adapter per coding agent -- Codex, Claude Code, Cursor, Windsurf,
 * Devin, and a generic CLI -- so the rest of the codebase can say "install your
 * hooks" and "here is a repair prompt, go fix it" without knowing which agent is
 * on the other side.
 *
 * An adapter is deliberately thin: where its settings file lives, and how to
 * launch it with a prompt file. Launching is spawn-based and reports
 * `needs_command` rather than guessing when the agent is not installed --
 * silently doing nothing would look identical to a passing run.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const proofloopHooks_1 = require("./proofloopHooks");
const repairDeadline_1 = require("./repairDeadline");
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
        launch: (promptPath, targetDir, options) => launchProofloopAgentAdapter({ adapterId: id, promptPath, targetDir, ...options }),
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
async function launchProofloopAgentAdapter(args) {
    const timeoutMs = (0, repairDeadline_1.repairTimeoutMs)(args.timeoutMs);
    const targetDir = (0, node_path_1.resolve)(args.targetDir ?? process.cwd());
    const env = args.env ?? process.env;
    const failedBeforeLaunch = (message) => ({
        adapterId: args.adapterId, status: "failed", launched: false,
        promptPath: rel(targetDir, args.promptPath), message,
    });
    if (args.signal?.aborted)
        return failedBeforeLaunch("Repair cancelled before launch.");
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
    let prompt;
    try {
        prompt = (0, node_fs_1.readFileSync)(args.promptPath, "utf8");
    }
    catch (error) {
        return failedBeforeLaunch(`Cannot read repair prompt: ${errorMessage(error)}`);
    }
    const result = await runRepairProcess(command, targetDir, prompt, {
        ...env, PROOFLOOP_AGENT_ADAPTER: args.adapterId, PROOFLOOP_REPAIR_PROMPT: args.promptPath,
    }, timeoutMs, args.signal);
    const stdoutPath = (0, node_path_1.join)((0, node_path_1.dirname)(args.promptPath), `${safeAgentId(args.adapterId)}-stdout.log`);
    const stderrPath = (0, node_path_1.join)((0, node_path_1.dirname)(args.promptPath), `${safeAgentId(args.adapterId)}-stderr.log`);
    let failure = result.failure;
    const persisted = {};
    for (const [key, path, contents] of [["stdoutPath", stdoutPath, result.stdout], ["stderrPath", stderrPath, result.stderr]]) {
        try {
            (0, node_fs_1.writeFileSync)(path, contents);
            persisted[key] = rel(targetDir, path);
        }
        catch (error) {
            failure = `${failure ? `${failure}; ` : ""}Cannot persist ${key}: ${errorMessage(error)}`;
        }
    }
    const exitCode = failure ? result.code || 1 : result.code ?? 1;
    return {
        adapterId: args.adapterId,
        status: !failure && exitCode === 0 ? "launched" : "failed",
        launched: result.launched,
        command,
        promptPath: rel(targetDir, args.promptPath),
        exitCode,
        ...persisted,
        message: failure ?? (exitCode === 0 ? `${args.adapterId} completed; rerun the Proof Loop gate.` : `${args.adapterId} exited ${exitCode}.`),
    };
}
const REPAIR_OUTPUT_BYTES = 1024 * 1024;
const CLEANUP_BUDGET_MS = process.platform === "win32" ? 4000 : 2000;
function runRepairProcess(command, cwd, prompt, env, timeoutMs, signal) {
    return new Promise((resolveResult) => {
        let child;
        try {
            child = (0, node_child_process_1.spawn)(command, { cwd, env, shell: true, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        }
        catch (error) {
            resolveResult({ launched: false, code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), failure: `Repair launch failed: ${errorMessage(error)}` });
            return;
        }
        let launched = false, closed = false, exited = false, settled = false;
        let code = null, failure;
        const output = { stdout: [], stderr: [] };
        const bytes = { stdout: 0, stderr: 0 };
        const finish = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(deadline);
            signal?.removeEventListener("abort", abort);
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            resolveResult({ launched, code, stdout: Buffer.concat(output.stdout), stderr: Buffer.concat(output.stderr), ...(failure ? { failure } : {}) });
        };
        const fail = (reason) => {
            if (settled || failure)
                return;
            failure = reason;
            clearTimeout(deadline);
            if (!child.pid) {
                finish();
                return;
            }
            // A root which already exited cannot identify a remaining Windows process tree safely.
            void terminateOwnedRepair(child.pid, () => closed, exited).then(confirmed => {
                if (!confirmed)
                    failure += "; cleanup-unverified: owned process tree or output closure could not be confirmed; stop automation.";
                finish();
            }, error => {
                failure += `; cleanup-unverified: ${errorMessage(error)}; stop automation.`;
                finish();
            });
        };
        const abort = () => fail("Repair cancelled by caller.");
        const deadline = setTimeout(() => fail(`Repair timed out after ${timeoutMs}ms.`), timeoutMs);
        child.once("spawn", () => { launched = true; });
        child.once("error", error => fail(`Repair launch failed: ${errorMessage(error)}`));
        child.once("exit", status => { exited = true; code = status; });
        child.once("close", status => { closed = true; code = status; if (!failure)
            finish(); });
        for (const stream of ["stdout", "stderr"]) {
            child[stream].on("data", (chunk) => {
                if (settled)
                    return;
                const remaining = REPAIR_OUTPUT_BYTES - bytes[stream];
                if (remaining > 0) {
                    const captured = Buffer.from(chunk.subarray(0, remaining));
                    output[stream].push(captured);
                    bytes[stream] += captured.length;
                }
                if (chunk.length > remaining)
                    fail(`Repair ${stream} exceeded ${REPAIR_OUTPUT_BYTES} bytes.`);
            });
            child[stream].on("error", error => fail(`Repair ${stream} failed: ${errorMessage(error)}`));
        }
        child.stdin.on("error", error => fail(`Repair stdin failed: ${errorMessage(error)}`));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted)
            abort();
        else
            child.stdin.end(prompt);
    });
}
async function terminateOwnedRepair(pid, closed, rootAlreadyExited) {
    const until = Date.now() + CLEANUP_BUDGET_MS;
    if (process.platform === "win32") {
        if (rootAlreadyExited)
            return false;
        const killed = await new Promise(resolveKill => {
            const killer = (0, node_child_process_1.spawn)((0, node_path_1.join)(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            let done = false;
            const finish = (ok) => { if (!done) {
                done = true;
                clearTimeout(timer);
                resolveKill(ok);
            } };
            const timer = setTimeout(() => {
                try {
                    killer.kill();
                }
                catch { /* Helper termination is unverified too. */ }
                killer.unref();
                finish(false);
            }, 3000);
            killer.once("error", () => finish(false));
            killer.once("close", status => finish(status === 0));
        });
        while (killed && !closed() && Date.now() < until)
            await pause(25);
        // A helper exit alone is insufficient: require the owned shell's drained close too.
        return killed && closed();
    }
    const groupExists = () => {
        try {
            process.kill(-pid, 0);
            return true;
        }
        catch (error) {
            return error.code !== "ESRCH";
        }
    };
    const send = (signal) => {
        try {
            process.kill(-pid, signal);
        }
        catch (error) {
            if (error.code !== "ESRCH")
                return false;
        }
        return true;
    };
    if (!send("SIGTERM"))
        return false;
    const escalateAt = Date.now() + 250;
    while (groupExists() && Date.now() < escalateAt)
        await pause(25);
    if (groupExists() && !send("SIGKILL"))
        return false;
    while ((!closed() || groupExists()) && Date.now() < until)
        await pause(25);
    return closed() && !groupExists();
}
function pause(ms) { return new Promise(resolvePause => setTimeout(resolvePause, ms)); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
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
