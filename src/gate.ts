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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readConfig } from "./config";

export const GATE_STATE_RELATIVE_PATH = ".proofloop/gate-state.json";

export type GateStatus = "passed" | "failed" | "no_gate";

export type GateCheckResult = {
  name: string;
  command: string;
  pass: boolean;
  ms: number;
  exitCode: number | null;
};

export type GateState = {
  schema: "proofloop-gate-v1";
  status: GateStatus;
  checks: GateCheckResult[];
  ts: string;
  /** How the gate was assembled (config checks vs the npm-test fallback vs none). */
  source: "config-checks" | "npm-test-fallback" | "none";
};

export type GateCliIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
  now?: () => Date;
};

export function gateStatePath(root: string): string {
  return join(resolve(root), ...GATE_STATE_RELATIVE_PATH.split("/"));
}

/** Exit code from a gate status: passed=0, failed=1, no_gate=2 (unusable). */
export function statusToExit(status: GateStatus): 0 | 1 | 2 {
  if (status === "passed") return 0;
  if (status === "failed") return 1;
  return 2;
}

function readGateState(root: string): GateState | undefined {
  const path = gateStatePath(root);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && typeof (parsed as GateState).status === "string") {
      return parsed as GateState;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function writeGateState(root: string, state: GateState): void {
  const path = gateStatePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Does package.json declare a `test` script? */
function hasNpmTestScript(root: string): boolean {
  const path = join(resolve(root), "package.json");
  if (!existsSync(path)) return false;
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const scripts = pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>).scripts : undefined;
    return Boolean(scripts && typeof scripts === "object" && typeof (scripts as Record<string, unknown>).test === "string");
  } catch {
    return false;
  }
}

function runCommand(root: string, command: string): { pass: boolean; ms: number; exitCode: number | null } {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: resolve(root),
    shell: true,
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: "inherit",
  });
  const ms = Date.now() - started;
  if (result.error) return { pass: false, ms, exitCode: null };
  const exitCode = result.status ?? 1;
  return { pass: exitCode === 0, ms, exitCode };
}

/**
 * Run the gate. Returns the persisted GateState.
 * The IO `log`/`logError` are for CLI framing; check commands stream directly
 * to the parent stdio so the user sees real test output.
 */
export function runGate(options: { root: string } & GateCliIo): GateState {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const now = options.now ?? (() => new Date());

  const config = readConfig(root);
  const configuredChecks = config?.gate.checks ?? [];

  let source: GateState["source"];
  let plannedChecks: { name: string; command: string }[];

  if (configuredChecks.length > 0) {
    source = "config-checks";
    plannedChecks = configuredChecks;
  } else if (hasNpmTestScript(root)) {
    source = "npm-test-fallback";
    plannedChecks = [{ name: "npm test", command: "npm test" }];
    log("proofloop gate: no checks configured; falling back to `npm test` (package.json has a test script).");
  } else {
    source = "none";
    plannedChecks = [];
  }

  const results: GateCheckResult[] = [];
  for (const check of plannedChecks) {
    log(`proofloop gate: running check "${check.name}" -> ${check.command}`);
    const outcome = runCommand(root, check.command);
    results.push({ name: check.name, command: check.command, pass: outcome.pass, ms: outcome.ms, exitCode: outcome.exitCode });
    log(`proofloop gate: check "${check.name}" ${outcome.pass ? "PASSED" : "FAILED"} (${outcome.ms}ms, exit ${outcome.exitCode ?? "error"})`);
  }

  let status: GateStatus;
  if (source === "none") {
    status = "no_gate";
    logError(
      "proofloop gate: no gate configured. Add checks to proofloop.config.json gate.checks (each { name, command }), or add a `test` script to package.json.",
    );
  } else {
    status = results.every((result) => result.pass) ? "passed" : "failed";
  }

  const state: GateState = {
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
export function runGateCli(options: { root: string; check?: boolean } & GateCliIo): 0 | 1 | 2 {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  if (options.check) {
    const state = readGateState(root);
    if (!state) {
      logError(
        `proofloop gate --check: no gate result found at ${gateStatePath(root)}. Run \`proofloop gate\` first to produce one (fail-closed, exit 2).`,
      );
      return 2;
    }
    log(formatGateState(state, gateStatePath(root), true));
    return statusToExit(state.status);
  }

  const state = runGate(options);
  log(formatGateState(state, gateStatePath(root), false));
  return statusToExit(state.status);
}

export function formatGateState(state: GateState, statePath: string, fromCache: boolean): string {
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
