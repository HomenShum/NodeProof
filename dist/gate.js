"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATE_STATE_RELATIVE_PATH = void 0;
exports.gateStatePath = gateStatePath;
exports.statusToExit = statusToExit;
exports.runGate = runGate;
exports.runGateCli = runGateCli;
exports.formatGateState = formatGateState;
/**
 * `proofloop gate [--check]` -- the proof gate the hooks call.
 *
 * Run mode (default): read proofloop.config.json gate.checks (each check =
 * { name, command }; a check passes iff its shell command exits 0). If no
 * checks are configured, fall back to `npm test` when package.json declares a
 * test script; otherwise report "no gate configured". Writes
 * .proofloop/gate-state.json and exits 0 (passed) / 1 (failed) / 2 (unusable).
 *
 * Check mode (--check): read the LAST gate-state.json WITHOUT re-running any
 * command, and exit on its status. This mirrors the noderoom stop-gate's
 * check-only default -- the Stop hook must be side-effect-free, so it reads the
 * persisted verdict instead of re-running the (possibly expensive) suite on
 * every stop attempt.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
exports.GATE_STATE_RELATIVE_PATH = ".proofloop/gate-state.json";
function gateStatePath(root) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), ...exports.GATE_STATE_RELATIVE_PATH.split("/"));
}
/** Exit code from a gate status: passed=0, failed=1, no_gate=2 (unusable). */
function statusToExit(status) {
    if (status === "passed")
        return 0;
    if (status === "failed")
        return 1;
    return 2;
}
function readGateState(root) {
    const path = gateStatePath(root);
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
        if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
            return parsed;
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
function writeGateState(root, state) {
    const path = gateStatePath(root);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
/** Does package.json declare a `test` script? */
function hasNpmTestScript(root) {
    const path = (0, node_path_1.join)((0, node_path_1.resolve)(root), "package.json");
    if (!(0, node_fs_1.existsSync)(path))
        return false;
    try {
        const pkg = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        const scripts = pkg && typeof pkg === "object" ? pkg.scripts : undefined;
        return Boolean(scripts && typeof scripts === "object" && typeof scripts.test === "string");
    }
    catch {
        return false;
    }
}
function runCommand(root, command) {
    const started = Date.now();
    const result = (0, node_child_process_1.spawnSync)(command, {
        cwd: (0, node_path_1.resolve)(root),
        shell: true,
        encoding: "utf8",
        timeout: 30 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: "inherit",
    });
    const ms = Date.now() - started;
    if (result.error)
        return { pass: false, ms, exitCode: null };
    const exitCode = result.status ?? 1;
    return { pass: exitCode === 0, ms, exitCode };
}
/**
 * Run the gate. Returns the persisted GateState.
 * The IO `log`/`logError` are for CLI framing; check commands stream directly
 * to the parent stdio so the user sees real test output.
 */
function runGate(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const now = options.now ?? (() => new Date());
    const config = (0, config_1.readConfig)(root);
    const configuredChecks = config?.gate.checks ?? [];
    let source;
    let plannedChecks;
    if (configuredChecks.length > 0) {
        source = "config-checks";
        plannedChecks = configuredChecks;
    }
    else if (hasNpmTestScript(root)) {
        source = "npm-test-fallback";
        plannedChecks = [{ name: "npm test", command: "npm test" }];
        log("proofloop gate: no checks configured; falling back to `npm test` (package.json has a test script).");
    }
    else {
        source = "none";
        plannedChecks = [];
    }
    const results = [];
    for (const check of plannedChecks) {
        log(`proofloop gate: running check "${check.name}" -> ${check.command}`);
        const outcome = runCommand(root, check.command);
        results.push({ name: check.name, command: check.command, pass: outcome.pass, ms: outcome.ms, exitCode: outcome.exitCode });
        log(`proofloop gate: check "${check.name}" ${outcome.pass ? "PASSED" : "FAILED"} (${outcome.ms}ms, exit ${outcome.exitCode ?? "error"})`);
    }
    let status;
    if (source === "none") {
        status = "no_gate";
        logError("proofloop gate: no gate configured. Add checks to proofloop.config.json gate.checks (each { name, command }), or add a `test` script to package.json.");
    }
    else {
        status = results.every((result) => result.pass) ? "passed" : "failed";
    }
    const state = {
        schema: "proofloop-gate-v1",
        status,
        checks: results,
        ts: now().toISOString(),
        source,
    };
    writeGateState(root, state);
    return state;
}
/**
 * `proofloop gate [--check]`. Exit code: 0 passed, 1 failed, 2 no_gate/unusable.
 */
function runGateCli(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    if (options.check) {
        const state = readGateState(root);
        if (!state) {
            logError(`proofloop gate --check: no gate result found at ${gateStatePath(root)}. Run \`proofloop gate\` first to produce one (fail-closed, exit 2).`);
            return 2;
        }
        log(formatGateState(state, gateStatePath(root), true));
        return statusToExit(state.status);
    }
    const state = runGate(options);
    log(formatGateState(state, gateStatePath(root), false));
    return statusToExit(state.status);
}
function formatGateState(state, statePath, fromCache) {
    const header = `proofloop gate: ${state.status.toUpperCase()}${fromCache ? " (cached --check, not re-run)" : ""}`;
    const lines = [header, `  state: ${statePath}`, `  ts:    ${state.ts}`, `  source: ${state.source}`];
    if (state.checks.length > 0) {
        lines.push("  checks:");
        for (const check of state.checks) {
            lines.push(`    - [${check.pass ? "pass" : "FAIL"}] ${check.name} (${check.ms}ms)`);
        }
    }
    return `${lines.join("\n")}\n`;
}
