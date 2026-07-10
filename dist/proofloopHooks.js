"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUARDED_CONTENT_PATH_PREFIXES = exports.DEFAULT_GATE_COMMAND = exports.DEFAULT_MAX_STOP_BLOCKS = exports.POSTTOOLUSE_LOG_MATCHER = exports.PRETOOLUSE_MATCHER = exports.POSTTOOLUSE_LOG_COMMAND = exports.PRETOOLUSE_GUARD_COMMAND = exports.STOP_GATE_COMMAND = exports.PROOFLOOP_HOOK_COMMAND_PREFIX = void 0;
exports.installProofloopHooks = installProofloopHooks;
exports.buildHooksConfig = buildHooksConfig;
exports.mergeHookEntries = mergeHookEntries;
exports.mergeCodexHookEntries = mergeCodexHookEntries;
exports.uninstallProofloopHooks = uninstallProofloopHooks;
exports.removeOurHookEntries = removeOurHookEntries;
exports.proofloopHooksStatus = proofloopHooksStatus;
exports.formatProofloopHooksStatus = formatProofloopHooksStatus;
/**
 * Proof Loop worker hooks -- `proofloop hooks <install|uninstall|status>`.
 *
 * PORTED from the noderoom reference implementation
 * (src/eval/proofloopHooks.ts). The security semantics are preserved:
 * deep-merge into .claude/settings.json without clobbering the user's hooks,
 * idempotent install/uninstall, a per-session block counter so the Stop loop
 * can never become infinite, a PreToolUse guard that blocks immutable/protected
 * paths (pure string checks that never fail open) and verifier-weakening
 * content, and a fail-open PostToolUse logger paired with a fail-closed
 * verifier.
 *
 * PACKAGE ADAPTATIONS (documented inline):
 *   - Protected/immutable paths are GENERIC + config-overridable (see
 *     scaffoldConstants.ts) -- a stranger's repo has no noderoom harness files.
 *   - The default gate is `npx proofloop gate --check` (this package's gate),
 *     which reads the persisted .proofloop/gate-state.json without re-running.
 *     "check-only" mode reads that same gate-state.json directly.
 *
 * v0 supports Claude Code and Codex hook hosts.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const scaffoldConstants_1 = require("./scaffoldConstants");
const proofloopToolUse_1 = require("./proofloopToolUse");
const gate_1 = require("./gate");
const config_1 = require("./config");
exports.PROOFLOOP_HOOK_COMMAND_PREFIX = "node .proofloop/hooks/";
exports.STOP_GATE_COMMAND = "node .proofloop/hooks/stop-gate.mjs";
exports.PRETOOLUSE_GUARD_COMMAND = "node .proofloop/hooks/pretooluse-guard.mjs";
exports.POSTTOOLUSE_LOG_COMMAND = "node .proofloop/hooks/posttooluse-log.mjs";
exports.PRETOOLUSE_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
/**
 * Matcher for the PostToolUse logger: ALL tools. Claude Code treats matchers
 * as regexes; ".*" matches every tool name regardless of anchoring, so MCP
 * names like mcp__composio__GMAIL_SEND_EMAIL are captured too.
 */
exports.POSTTOOLUSE_LOG_MATCHER = ".*";
exports.DEFAULT_MAX_STOP_BLOCKS = 5;
/**
 * OPTIONAL command-mode gate for the Stop hook. NOT the default: the default
 * is "check-only" (read the persisted .proofloop/gate-state.json verdict
 * directly, in-process). A Stop hook must be deterministic and offline-safe;
 * `npx proofloop ...` inside the hook would make the stop verdict depend on
 * npm/registry/network state (and 404s outright until the package is
 * published). Users who want a live re-run on every stop attempt can opt in
 * with `--gate-command "npx proofloop gate"` (or any command).
 */
exports.DEFAULT_GATE_COMMAND = "npx proofloop gate --check";
/** Path prefixes whose NEW CONTENT is scanned for verifier-weakening patterns. */
exports.GUARDED_CONTENT_PATH_PREFIXES = [
    "scripts/proofloop",
    "src/eval/",
    "proofloop/",
];
// ---------------------------------------------------------------------------
// install
function installProofloopHooks(options = {}) {
    const worker = parseHookWorker(options.worker ?? "claude-code");
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const hooksDir = (0, node_path_1.join)(root, ".proofloop", "hooks");
    (0, node_fs_1.mkdirSync)(hooksDir, { recursive: true });
    const config = buildHooksConfig({ ...options, root });
    const configPath = (0, node_path_1.join)(hooksDir, "config.json");
    (0, node_fs_1.writeFileSync)(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const stopGatePath = (0, node_path_1.join)(hooksDir, "stop-gate.mjs");
    const preToolUseGuardPath = (0, node_path_1.join)(hooksDir, "pretooluse-guard.mjs");
    (0, node_fs_1.writeFileSync)(stopGatePath, stopGateScript(config), "utf8");
    (0, node_fs_1.writeFileSync)(preToolUseGuardPath, preToolUseGuardScript(config), "utf8");
    let postToolUseLogPath = null;
    if (config.toolUseLog) {
        postToolUseLogPath = (0, node_path_1.join)(hooksDir, "posttooluse-log.mjs");
        (0, node_fs_1.writeFileSync)(postToolUseLogPath, postToolUseLogScript(config), "utf8");
    }
    const settingsPath = hookSettingsPath(root, worker, options.local === true);
    const settings = readSettingsForMerge(settingsPath);
    const merged = worker === "codex"
        ? mergeCodexHookEntries(settings, { toolUseLog: config.toolUseLog })
        : mergeHookEntries(settings, { toolUseLog: config.toolUseLog });
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(settingsPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return {
        root,
        settingsPath,
        hooksDir,
        configPath,
        stopGatePath,
        preToolUseGuardPath,
        postToolUseLogPath,
        addedStopHook: merged.addedStop,
        addedPreToolUseHook: merged.addedPreToolUse,
        addedPostToolUseLogHook: merged.addedPostToolUseLog,
    };
}
function buildHooksConfig(options = {}) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    // Merge the user's repo-specific immutable paths (proofloop.config.json
    // `immutable: []`) onto the (empty) package default, and the user's
    // additional protected paths (`protectedPaths: []`) onto the generic
    // defaults. A stranger's repo has no noderoom harness files, so the default
    // immutable list is empty by design; the generic proof-state protections
    // live in protectedExtraPaths and ALWAYS apply (defaults are not removable
    // -- an agent that could config-away ".proofloop/" would own its own
    // enforcement layer). FAIL-CLOSED: an unparseable proofloop.config.json
    // THROWS (from readConfig) instead of silently installing hooks without the
    // user's declared protections.
    const userConfig = (0, config_1.readConfig)(root);
    const immutableFiles = dedupe([...scaffoldConstants_1.DEFAULT_IMMUTABLE_FILES, ...(userConfig?.immutable ?? [])]);
    const protectedExtraPaths = dedupe([...scaffoldConstants_1.DEFAULT_PROTECTED_EXTRA_PATHS, ...(userConfig?.protectedPaths ?? [])]);
    const explicitCommand = options.gateCommand?.trim();
    // Default to check-only (read the persisted .proofloop/gate-state.json) unless the user opts
    // into a command. Command mode would spawn `npx proofloop gate --check`, which fails with an
    // npm E404 until this package is published -- bricking a fresh repo's Stop hook. Check-only is
    // a pure file read: absent state -> allow (never brick), state "failed" -> block. Only an
    // explicit --gate-command (or checkOnly:false + a command) chooses command mode.
    const gateMode = options.checkOnly ? "check-only" : explicitCommand ? "command" : "check-only";
    const gateCommand = gateMode === "command" ? explicitCommand ?? exports.DEFAULT_GATE_COMMAND : null;
    return {
        schema: "proofloop-hooks-v1",
        worker: parseHookWorker(options.worker ?? "claude-code"),
        generatedAt: (options.now?.() ?? new Date()).toISOString(),
        gateMode,
        gateCommand,
        gateStatePath: gate_1.GATE_STATE_RELATIVE_PATH,
        maxStopBlocks: options.maxStopBlocks && options.maxStopBlocks > 0 ? options.maxStopBlocks : exports.DEFAULT_MAX_STOP_BLOCKS,
        toolUseLog: options.toolUseLog !== false,
        toolUseLogPath: proofloopToolUse_1.TOOL_USE_LOG_RELATIVE_PATH,
        immutableFiles,
        protectedExtraPaths,
        // The verifier-weakening content check ALSO applies under the protected
        // paths (belt-and-braces: the hard path block fires before it) and under
        // the generic guarded prefixes.
        guardedContentPathPrefixes: dedupe([...exports.GUARDED_CONTENT_PATH_PREFIXES, ...protectedExtraPaths]),
        verifierWeakeningPatterns: scaffoldConstants_1.VERIFIER_WEAKENING_PATTERNS.map((pattern) => ({
            source: pattern.source,
            flags: pattern.flags,
        })),
    };
}
function dedupe(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
/**
 * Deep-merge our hook entries into an existing Claude Code settings object.
 * Never clobbers user hooks: appends to existing arrays, preserves unknown
 * keys, and is idempotent (an entry whose command starts with
 * PROOFLOOP_HOOK_COMMAND_PREFIX is recognized as ours and not duplicated).
 */
function mergeHookEntries(settings, options = {}) {
    const hooks = asRecord(settings.hooks) ?? {};
    settings.hooks = hooks;
    const stopGroups = asGroupArray(hooks.Stop);
    hooks.Stop = stopGroups;
    let addedStop = false;
    if (!groupsContainCommand(stopGroups, exports.STOP_GATE_COMMAND)) {
        stopGroups.push({
            hooks: [{ type: "command", command: exports.STOP_GATE_COMMAND, timeout: 600 }],
        });
        addedStop = true;
    }
    const preGroups = asGroupArray(hooks.PreToolUse);
    hooks.PreToolUse = preGroups;
    let addedPreToolUse = false;
    if (!groupsContainCommand(preGroups, exports.PRETOOLUSE_GUARD_COMMAND)) {
        preGroups.push({
            matcher: exports.PRETOOLUSE_MATCHER,
            hooks: [{ type: "command", command: exports.PRETOOLUSE_GUARD_COMMAND }],
        });
        addedPreToolUse = true;
    }
    // Expected-tool-use capture: a SEPARATE additional PostToolUse entry (never
    // touches any pre-existing PostToolUse groups the user may have).
    let addedPostToolUseLog = false;
    if (options.toolUseLog !== false) {
        const postGroups = asGroupArray(hooks.PostToolUse);
        hooks.PostToolUse = postGroups;
        if (!groupsContainCommand(postGroups, exports.POSTTOOLUSE_LOG_COMMAND)) {
            postGroups.push({
                matcher: exports.POSTTOOLUSE_LOG_MATCHER,
                hooks: [{ type: "command", command: exports.POSTTOOLUSE_LOG_COMMAND }],
            });
            addedPostToolUseLog = true;
        }
    }
    return { addedStop, addedPreToolUse, addedPostToolUseLog };
}
/**
 * Codex hook configuration uses a flat hooks array. The command scripts are
 * the same self-contained Node scripts used by Claude Code: they consume stdin
 * JSON and keep Proof Loop's Stop/PreToolUse/PostToolUse semantics host-neutral.
 */
function mergeCodexHookEntries(settings, options = {}) {
    if (settings.hooks !== undefined && !Array.isArray(settings.hooks)) {
        throw new Error("Refusing to overwrite Codex hooks because .codex hooks must be a flat array.");
    }
    const hooks = asCodexHookArray(settings.hooks);
    settings.hooks = hooks;
    const add = (event, command, matcher) => {
        if (hooks.some((entry) => entry?.event === event && entry?.command === command))
            return false;
        hooks.push({ event, ...(matcher ? { matcher } : {}), command });
        return true;
    };
    const addedStop = add("Stop", exports.STOP_GATE_COMMAND);
    const addedPreToolUse = add("PreToolUse", exports.PRETOOLUSE_GUARD_COMMAND, exports.PRETOOLUSE_MATCHER);
    const addedPostToolUseLog = options.toolUseLog === false
        ? false
        : add("PostToolUse", exports.POSTTOOLUSE_LOG_COMMAND, exports.POSTTOOLUSE_LOG_MATCHER);
    return { addedStop, addedPreToolUse, addedPostToolUseLog };
}
// ---------------------------------------------------------------------------
// uninstall
function uninstallProofloopHooks(options = {}) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const cleanedSettingsPaths = [];
    let removedEntries = 0;
    for (const settingsPath of hookSettingsCandidatePaths(root)) {
        const settings = readJsonRecord(settingsPath);
        if (!settings)
            continue;
        const removed = removeOurHookEntries(settings);
        if (removed > 0) {
            removedEntries += removed;
            cleanedSettingsPaths.push(settingsPath);
            (0, node_fs_1.writeFileSync)(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        }
    }
    const hooksDir = (0, node_path_1.join)(root, ".proofloop", "hooks");
    let purgedHooksDir = false;
    if (options.purge && (0, node_fs_1.existsSync)(hooksDir)) {
        (0, node_fs_1.rmSync)(hooksDir, { recursive: true, force: true });
        purgedHooksDir = true;
    }
    return { root, cleanedSettingsPaths, removedEntries, purgedHooksDir };
}
/** Remove ONLY entries whose command carries our marker prefix. */
function removeOurHookEntries(settings) {
    const hooks = asRecord(settings.hooks);
    if (!hooks) {
        const codexHooks = Array.isArray(settings.hooks) ? settings.hooks : undefined;
        if (!codexHooks)
            return 0;
        const kept = codexHooks.filter((entry) => {
            const command = entry?.command;
            return !(typeof command === "string" && command.startsWith(exports.PROOFLOOP_HOOK_COMMAND_PREFIX));
        });
        settings.hooks = kept;
        return codexHooks.length - kept.length;
    }
    let removed = 0;
    for (const eventName of Object.keys(hooks)) {
        const groups = hooks[eventName];
        if (!Array.isArray(groups))
            continue;
        const keptGroups = [];
        for (const group of groups) {
            const record = asRecord(group);
            const entries = record && Array.isArray(record.hooks) ? record.hooks : undefined;
            if (!record || !entries) {
                keptGroups.push(group);
                continue;
            }
            const keptEntries = entries.filter((entry) => {
                const command = asRecord(entry)?.command;
                const isOurs = typeof command === "string" && command.startsWith(exports.PROOFLOOP_HOOK_COMMAND_PREFIX);
                if (isOurs)
                    removed += 1;
                return !isOurs;
            });
            if (keptEntries.length > 0) {
                record.hooks = keptEntries;
                keptGroups.push(record);
            }
            else if (entries.length === 0) {
                keptGroups.push(record);
            }
            // groups whose only entries were ours are dropped entirely
        }
        if (keptGroups.length > 0) {
            hooks[eventName] = keptGroups;
        }
        else {
            delete hooks[eventName];
        }
    }
    return removed;
}
// ---------------------------------------------------------------------------
// status
function proofloopHooksStatus(options = {}) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const hooksDir = (0, node_path_1.join)(root, ".proofloop", "hooks");
    const configPath = (0, node_path_1.join)(hooksDir, "config.json");
    const config = readJsonRecord(configPath);
    const settings = hookSettingsCandidatePaths(root).map((path) => {
        const parsed = readJsonRecord(path);
        const codex = path.replace(/\\/g, "/").includes("/.codex/");
        const hooks = parsed ? asRecord(parsed.hooks) : undefined;
        const codexHooks = parsed ? asCodexHookArray(parsed.hooks) : [];
        return {
            path,
            exists: parsed !== undefined,
            stopHookInstalled: codex ? codexHooksContainCommand(codexHooks, "Stop", exports.STOP_GATE_COMMAND) : hooks ? groupsContainCommand(asGroupArray(hooks.Stop), exports.STOP_GATE_COMMAND) : false,
            preToolUseHookInstalled: codex ? codexHooksContainCommand(codexHooks, "PreToolUse", exports.PRETOOLUSE_GUARD_COMMAND) : hooks ? groupsContainCommand(asGroupArray(hooks.PreToolUse), exports.PRETOOLUSE_GUARD_COMMAND) : false,
            postToolUseLogInstalled: codex ? codexHooksContainCommand(codexHooks, "PostToolUse", exports.POSTTOOLUSE_LOG_COMMAND) : hooks ? groupsContainCommand(asGroupArray(hooks.PostToolUse), exports.POSTTOOLUSE_LOG_COMMAND) : false,
        };
    });
    const sessionBlockCounts = {};
    const state = readJsonRecord((0, node_path_1.join)(hooksDir, "state.json"));
    const sessions = state ? asRecord(state.sessions) : undefined;
    if (sessions) {
        for (const [sessionId, value] of Object.entries(sessions)) {
            const blocks = asRecord(value)?.blocks;
            if (typeof blocks === "number")
                sessionBlockCounts[sessionId] = blocks;
        }
    }
    return {
        root,
        settings,
        scripts: ["stop-gate.mjs", "pretooluse-guard.mjs", "posttooluse-log.mjs"].map((name) => {
            const path = (0, node_path_1.join)(hooksDir, name);
            return { path, exists: (0, node_fs_1.existsSync)(path) };
        }),
        configPath,
        configExists: config !== undefined,
        maxStopBlocks: typeof config?.maxStopBlocks === "number" ? config.maxStopBlocks : undefined,
        gateMode: typeof config?.gateMode === "string" ? config.gateMode : undefined,
        gateCommand: typeof config?.gateCommand === "string" ? config.gateCommand : config?.gateCommand === null ? null : undefined,
        toolUseLog: typeof config?.toolUseLog === "boolean" ? config.toolUseLog : undefined,
        toolUseLogPath: typeof config?.toolUseLogPath === "string" ? config.toolUseLogPath : undefined,
        sessionBlockCounts,
    };
}
function formatProofloopHooksStatus(status) {
    const lines = [`Proof Loop hooks status (${status.root})`, ""];
    for (const file of status.settings) {
        if (!file.exists) {
            lines.push(`  ${file.path}: not present`);
            continue;
        }
        lines.push(`  ${file.path}: Stop=${file.stopHookInstalled ? "installed" : "missing"} PreToolUse=${file.preToolUseHookInstalled ? "installed" : "missing"} PostToolUseLog=${file.postToolUseLogInstalled ? "installed" : "missing"}`);
    }
    for (const script of status.scripts) {
        lines.push(`  ${script.path}: ${script.exists ? "present" : "MISSING"}`);
    }
    const gate = status.gateMode === "command" ? `command -> ${status.gateCommand ?? "?"}` : status.gateMode ?? "?";
    lines.push(`  ${status.configPath}: ${status.configExists ? `present (gate=${gate}, maxStopBlocks=${status.maxStopBlocks ?? "?"}, toolUseLog=${status.toolUseLog === undefined ? "?" : status.toolUseLog ? `on -> ${status.toolUseLogPath ?? "?"}` : "off"})` : "MISSING"}`);
    const counters = Object.entries(status.sessionBlockCounts);
    lines.push(counters.length
        ? `  block counters: ${counters.map(([id, blocks]) => `${id}=${blocks}`).join(", ")}`
        : "  block counters: none");
    return `${lines.join("\n")}\n`;
}
// ---------------------------------------------------------------------------
// generated hook scripts
function configLiteral(config) {
    return JSON.stringify(config, null, 2);
}
function stopGateScript(config) {
    return `#!/usr/bin/env node
/**
 * Proof Loop Stop gate for Claude Code. Generated by \`proofloop hooks install\`;
 * re-run install to refresh. Self-contained: plain Node, no project imports.
 *
 * ASSUMED Claude Code Stop-hook contract (re-verify against the current hooks
 * docs at https://docs.claude.com/en/docs/claude-code/hooks before relying on it):
 *   - The hook receives JSON on stdin: { session_id, transcript_path, stop_hook_active, ... }.
 *   - Exit 0 with no stdout JSON  => the stop is allowed.
 *   - Printing {"decision":"block","reason":"..."} to stdout and exiting 0
 *     => the stop is BLOCKED and \`reason\` is fed back to Claude to keep working.
 *   - stderr is informational only.
 *
 * Loop protection comes FIRST: a per-session block counter in state.json caps
 * how many times this hook may block (maxStopBlocks); at the cap the stop is
 * allowed with an honest stderr note, so the loop can never become infinite.
 *
 * Gate semantics:
 *   - "command" (package default): spawn config.gateCommand
 *     (\`npx proofloop gate --check\`); exit code 0 = pass, 1 = fail,
 *     2 = no gate result yet (treated as "no gate configured" => allow, so a
 *     fresh repo is never bricked).
 *   - "check-only": read .proofloop/gate-state.json directly (no side effects)
 *     and require status === "passed"; status "no_gate"/absent => allow.
 *   - No gate configured => allow. This hook must never brick a repo that has
 *     not set up a Proof Loop gate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CONFIG_PATH = join(SCRIPT_DIR, "config.json");
const STATE_PATH = join(SCRIPT_DIR, "state.json");
const MAX_TRACKED_SESSIONS = 20;

/** Install-time snapshot; config.json (if readable) overrides it. */
const DEFAULT_CONFIG = ${configLiteral(config)};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function saveState(state) {
  try {
    const sessions = state.sessions ?? {};
    const ids = Object.keys(sessions);
    if (ids.length > MAX_TRACKED_SESSIONS) {
      ids
        .sort((a, b) => String(sessions[a]?.updatedAt ?? "").localeCompare(String(sessions[b]?.updatedAt ?? "")))
        .slice(0, ids.length - MAX_TRACKED_SESSIONS)
        .forEach((id) => delete sessions[id]);
    }
    mkdirSync(SCRIPT_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\\n", "utf8");
  } catch (error) {
    console.error("proofloop stop-gate: could not persist block-counter state: " + (error?.message ?? error));
  }
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function tail(text, max = 400) {
  const trimmed = String(text ?? "").trim().replace(/\\s+/g, " ");
  return trimmed.length > max ? trimmed.slice(trimmed.length - max) : trimmed;
}

function readGateState(config) {
  const rel = typeof config.gateStatePath === "string" && config.gateStatePath ? config.gateStatePath : ".proofloop/gate-state.json";
  const statePath = join(REPO_ROOT, ...rel.split("/"));
  // "no_goal" is the shared allow-without-proof verdict name main() checks;
  // a missing gate-state.json means "no gate result yet" (fresh repo).
  if (!existsSync(statePath)) return { verdict: "no_goal", reasons: [] };
  let gateState;
  try {
    gateState = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    return { verdict: "gate_error", reasons: ["could not read gate state " + statePath + ": " + (error?.message ?? error)] };
  }
  if (gateState.status === "passed") return { verdict: "pass", reasons: [] };
  if (gateState.status === "no_gate") return { verdict: "no_goal", reasons: [] };
  const reasons = [];
  for (const check of gateState.checks ?? []) {
    if (check && check.pass === false) reasons.push(String(check.name) + ": failing");
  }
  if (!reasons.length) reasons.push("gate status is " + gateState.status);
  return { verdict: "fail", reasons };
}

/** => { verdict: "pass"|"fail"|"no_goal"|"gate_error", reasons: string[] } */
function checkGate(config) {
  if (config.gateMode === "command" && typeof config.gateCommand === "string" && config.gateCommand) {
    const result = spawnSync(config.gateCommand, {
      cwd: REPO_ROOT,
      shell: true,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.error) {
      return { verdict: "gate_error", reasons: ["gate command could not run: " + (result.error?.message ?? result.error)] };
    }
    const output = (result.stdout ?? "") + "\\n" + (result.stderr ?? "");
    const status = result.status ?? 1;
    if (status === 0) return { verdict: "pass", reasons: [] };
    // Exit 2 from \`proofloop gate --check\` means "no gate result yet" -- a fresh
    // repo that has not run the gate. Never brick it: allow the stop.
    if (status === 2 || output.includes("no gate configured") || output.includes("no gate result")) {
      return { verdict: "no_goal", reasons: [tail(output)] };
    }
    return { verdict: "fail", reasons: [tail(output) || ("gate command exited " + status)] };
  }
  return readGateState(config);
}

async function main() {
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    input = {};
  }
  const config = loadConfig();
  const maxStopBlocks = Number(config.maxStopBlocks) > 0 ? Number(config.maxStopBlocks) : 5;
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : "unknown-session";
  const state = loadState();
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
  const blocksSoFar = Number(state.sessions[sessionId]?.blocks) || 0;

  // Loop protection FIRST: never block forever.
  if (blocksSoFar >= maxStopBlocks) {
    console.error(
      "proofloop stop-gate: the proof gate is STILL failing, but the block limit (" +
        maxStopBlocks +
        ") was reached for this session -- allowing the stop. The gate is NOT proven passing; run \`proofloop gate\` manually to see what remains.",
    );
    process.exit(0);
  }

  const check = checkGate(config);
  if (check.verdict === "pass") {
    if (state.sessions[sessionId]) {
      delete state.sessions[sessionId];
      saveState(state);
    }
    process.exit(0);
  }
  if (check.verdict === "no_goal") {
    console.error(
      "proofloop stop-gate: no Proof Loop gate result is available yet -- allowing the stop. Run \`proofloop gate\` to produce one (and add checks to proofloop.config.json).",
    );
    process.exit(0);
  }
  if (check.verdict === "gate_error") {
    console.error("proofloop stop-gate: gate check errored (" + check.reasons.join("; ") + ") -- failing open and allowing the stop.");
    process.exit(0);
  }

  const blocks = blocksSoFar + 1;
  state.sessions[sessionId] = { blocks, updatedAt: new Date().toISOString() };
  saveState(state);
  const reason =
    "proofloop gate is failing: " +
    tail(check.reasons.slice(0, 3).join("; ")) +
    ". Continue working: fix the failures, then re-run the gate. (block " +
    blocks +
    "/" +
    maxStopBlocks +
    ")";
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

main().catch((error) => {
  console.error("proofloop stop-gate: unexpected error (" + (error?.message ?? error) + ") -- failing open and allowing the stop.");
  process.exit(0);
});
`;
}
function preToolUseGuardScript(config) {
    return `#!/usr/bin/env node
/**
 * Proof Loop PreToolUse guard for Claude Code. Generated by
 * \`proofloop hooks install\`; re-run install to refresh. Self-contained.
 *
 * ASSUMED Claude Code PreToolUse hook contract (re-verify against the current
 * hooks docs at https://docs.claude.com/en/docs/claude-code/hooks):
 *   - The hook receives JSON on stdin: { session_id, tool_name, tool_input, ... }.
 *   - Exit 0 => the tool call is allowed.
 *   - Exit 2 => the tool call is BLOCKED and stderr is fed back to Claude.
 *   - Other exit codes => non-blocking error.
 *
 * Why this exists: the doctrine's documented gap is that proof state under
 * .proofloop/ (regressions, the tool-use log) is GITIGNORED, so git-diff-based
 * immutability checks structurally cannot see an agent rewriting that state.
 * This guard closes the gap at edit time -- the write is refused before it
 * happens instead of staying invisible afterward.
 *
 * Blocking rules (checked against the install-time snapshot below):
 *   (a) path matches immutableFiles (user-declared repo-specific paths)  => exit 2
 *   (b) path is under the generic protected extras (regressions state,
 *       .proofloop/hooks/, .proofloop/tooluse/, the CI gate)             => exit 2
 *   (c) path is under a guarded content prefix AND the new content matches a
 *       verifier-weakening pattern                                        => exit 2
 *
 * Failure policy: fail OPEN (exit 0 with a stderr warning) on unexpected
 * errors -- a broken guard must not lock the user out of editing. Cases (a)
 * and (b) are pure string operations performed before anything that can throw,
 * so path-based blocks never fail open.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CONFIG_PATH = join(SCRIPT_DIR, "config.json");

/** Install-time snapshot; config.json (if readable) overrides it. */
const DEFAULT_CONFIG = ${configLiteral(config)};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/**
 * Normalize a tool path to repo-relative forward slashes with "."/".."
 * segments resolved. Pure string operations only. Returns null when the path
 * is absolute but outside this repo (not ours to police).
 */
function normalizeRepoRelative(rawPath) {
  const norm = String(rawPath).replace(/\\\\/g, "/");
  const rootNorm = REPO_ROOT.replace(/\\\\/g, "/").replace(/\\/+$/, "");
  let rel = norm;
  if (/^([a-zA-Z]:)?\\//.test(norm)) {
    // Absolute. Windows drive letters compare case-insensitively.
    if (norm.toLowerCase() === rootNorm.toLowerCase()) return null;
    if (!norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")) return null;
    rel = norm.slice(rootNorm.length + 1);
  }
  const segments = [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!segments.length) return null; // escapes the repo root
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

/** Prefix-match semantics: exact match or startsWith. */
function matchProtected(relPath, list) {
  for (const entry of Array.isArray(list) ? list : []) {
    if (typeof entry !== "string" || !entry) continue;
    if (relPath === entry || relPath.startsWith(entry)) return entry;
  }
  return null;
}

function collectNewContent(toolInput) {
  const texts = [];
  if (typeof toolInput.new_string === "string") texts.push(toolInput.new_string);
  if (typeof toolInput.content === "string") texts.push(toolInput.content);
  if (typeof toolInput.new_source === "string") texts.push(toolInput.new_source);
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit && typeof edit.new_string === "string") texts.push(edit.new_string);
    }
  }
  return texts;
}

async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch (error) {
    // Without parseable input we do not know the target path; fail open.
    console.error("proofloop guard: could not parse hook input (" + (error?.message ?? error) + ") -- allowing.");
    process.exit(0);
  }
  const toolInput = input?.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const rawPath = typeof toolInput.file_path === "string" ? toolInput.file_path : toolInput.notebook_path;
  if (typeof rawPath !== "string" || !rawPath) process.exit(0);

  const relPath = normalizeRepoRelative(rawPath);
  if (relPath === null || relPath === "") process.exit(0);

  const config = loadConfig(); // never throws: falls back to the baked-in snapshot

  // (a) + (b): pure string checks -- these NEVER fail open.
  const immutableHit = matchProtected(relPath, config.immutableFiles);
  if (immutableHit) {
    console.error(
      'proofloop guard: BLOCKED edit to immutable file "' + relPath + '" (matches "' + immutableHit + '"). Immutable files (declared in proofloop.config.json immutable[]) may not be modified by the agent.',
    );
    process.exit(2);
  }
  const protectedHit = matchProtected(relPath, config.protectedExtraPaths);
  if (protectedHit) {
    console.error(
      'proofloop guard: BLOCKED edit to protected proof state "' + relPath + '" (matches "' + protectedHit + '"). This path is gitignored or enforcement-critical, so git diff cannot review the change; it may only change through the proofloop CLI.',
    );
    process.exit(2);
  }

  // (c): content scan in guarded areas. Wrapped so regex/config issues fail open.
  try {
    const prefixes = Array.isArray(config.guardedContentPathPrefixes) ? config.guardedContentPathPrefixes : [];
    const guarded = prefixes.some((prefix) => typeof prefix === "string" && prefix && (relPath === prefix || relPath.startsWith(prefix)));
    if (guarded) {
      const patterns = Array.isArray(config.verifierWeakeningPatterns) ? config.verifierWeakeningPatterns : [];
      for (const text of collectNewContent(toolInput)) {
        for (const pattern of patterns) {
          const regex = new RegExp(pattern.source, pattern.flags ?? "");
          const match = text.match(regex);
          if (match) {
            console.error(
              'proofloop guard: BLOCKED edit to "' + relPath + '": new content matches verifier-weakening pattern /' + pattern.source + "/" + (pattern.flags ?? "") + ' ("' + match[0] + '"). Fix the work, not the verifier.',
            );
            process.exit(2);
          }
        }
      }
    }
  } catch (error) {
    console.error("proofloop guard: content check errored (" + (error?.message ?? error) + ") -- failing open and allowing.");
    process.exit(0);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("proofloop guard: unexpected error (" + (error?.message ?? error) + ") -- failing open and allowing.");
  process.exit(0);
});
`;
}
function postToolUseLogScript(config) {
    return `#!/usr/bin/env node
/**
 * Proof Loop PostToolUse logger for Claude Code (expected-tool-use capture).
 * Generated by \`proofloop hooks install\`; re-run install to refresh.
 * Self-contained: plain Node, no project imports.
 *
 * ASSUMED Claude Code PostToolUse hook contract (re-verify against the current
 * hooks docs at https://docs.claude.com/en/docs/claude-code/hooks):
 *   - The hook receives JSON on stdin: { session_id, tool_name, tool_input, tool_response, ... }.
 *   - It runs AFTER the tool call completed; exit codes cannot un-run the tool.
 *   - The settings entry uses matcher ".*" (regex) so EVERY tool is captured,
 *     including MCP names like mcp__composio__GMAIL_SEND_EMAIL.
 *
 * What it appends to ${config.toolUseLogPath} (one JSON object per line):
 *   { ts, sessionId, tool, params, source: "posttooluse-hook" }
 * params is a REDACTED deep copy of tool_input: any key matching
 * /key|token|secret|password|authorization|bearer|credential/i becomes
 * "[redacted]" (nested objects and arrays included).
 *
 * Record-forging note: the record is serialized with JSON.stringify, which
 * GUARANTEES embedded newlines inside values are escaped to \\n INSIDE the one
 * line. A raw-concatenation logger would let a tool param containing a newline
 * plus JSON text forge a second, fake log record; JSON.stringify structurally
 * prevents that.
 *
 * Failure policy: ALWAYS exit 0 (fail-open logger -- a broken logger must
 * never block the user's tools); write failures are a stderr warning only.
 * The VERIFIER (\`proofloop tooluse verify\`) is fail-closed instead.
 *
 * Integrity: the log dir is on the PreToolUse guard's protectedExtraPaths, so
 * Edit/Write to it are refused at edit time (an agent doctoring its own tool
 * log to pass a contract is the doctrine's reward-hacking pattern). Known
 * bypass: Bash-issued writes are not intercepted; CI re-verification is the
 * backstop. This is LOCAL capture, not server-side attestation.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const LOG_PATH = join(REPO_ROOT, ...${JSON.stringify(config.toolUseLogPath.split("/"))});
const SOLO_STATE_PATH = join(REPO_ROOT, ".solo", "loop-state.json");
const SOLO_EVENTS_PATH = join(REPO_ROOT, ".solo", "events.jsonl");
const REDACT_KEY_RE = /key|token|secret|password|authorization|bearer|credential/i;

/**
 * Deep-redact secret-looking keys. Uses null-prototype objects so a key
 * literally named "__proto__" (JSON.parse creates it as an ordinary own
 * property) is copied as a plain own key and can never mutate a prototype.
 */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value)) {
      out[key] = REDACT_KEY_RE.test(key) ? "[redacted]" : redact(value[key]);
    }
    return out;
  }
  return value;
}

function appendSoloEvent(input, record) {
  if (!existsSync(SOLO_STATE_PATH)) return;
  try {
    const loop = JSON.parse(readFileSync(SOLO_STATE_PATH, "utf8"));
    const response = input && typeof input.tool_response === "object" ? input.tool_response : null;
    const failed = Boolean(input?.error || response?.is_error || response?.error);
    const event = {
      schemaVersion: 1,
      id: "evt_" + randomUUID().replace(/-/g, ""),
      ts: record.ts,
      event: "tool.post",
      agentHost: typeof input?.agent_host === "string" && input.agent_host ? input.agent_host : "proofloop-hook",
      source: "nodeproof-posttooluse",
      ...(typeof loop?.loopId === "string" ? { loopId: loop.loopId } : {}),
      ...(typeof loop?.currentMilestone === "string" ? { milestone: loop.currentMilestone } : {}),
      status: failed ? "error" : "ok",
      toolName: record.tool,
      payload: { sessionId: record.sessionId, params: record.params },
    };
    mkdirSync(dirname(SOLO_EVENTS_PATH), { recursive: true });
    appendFileSync(SOLO_EVENTS_PATH, JSON.stringify(event) + "\\n", "utf8");
  } catch (error) {
    console.error("proofloop solo-event-bridge: could not append to " + SOLO_EVENTS_PATH + " (" + (error?.message ?? error) + ") -- tool call unaffected.");
  }
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0); // nothing parseable to log; never block the tool
  }
  const tool = input && typeof input.tool_name === "string" && input.tool_name ? input.tool_name : null;
  if (!tool) process.exit(0);
  const record = {
    ts: new Date().toISOString(),
    sessionId: typeof input.session_id === "string" && input.session_id ? input.session_id : "unknown-session",
    tool,
    params: redact(input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {}),
    source: "posttooluse-hook",
  };
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    // ONE line per record; JSON.stringify escapes any newline inside values.
    appendFileSync(LOG_PATH, JSON.stringify(record) + "\\n", "utf8");
    appendSoloEvent(input, record);
  } catch (error) {
    console.error("proofloop tooluse-log: could not append to " + LOG_PATH + " (" + (error?.message ?? error) + ") -- tool call unaffected.");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("proofloop tooluse-log: unexpected error (" + (error?.message ?? error) + ") -- tool call unaffected.");
  process.exit(0);
});
`;
}
// ---------------------------------------------------------------------------
// shared helpers
/**
 * Load settings for a merge-then-rewrite. Missing file => fresh object.
 * Unparseable or non-object file => throw instead of silently clobbering the
 * user's settings.
 */
function readSettingsForMerge(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return {};
    let parsed;
    try {
        parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch (error) {
        throw new Error(`Refusing to overwrite unparseable settings file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const record = asRecord(parsed);
    if (!record)
        throw new Error(`Refusing to overwrite non-object settings file ${path}.`);
    return record;
}
function readJsonRecord(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
        return asRecord(parsed);
    }
    catch {
        return undefined;
    }
}
function parseHookWorker(value) {
    if (value === "claude-code" || value === "codex")
        return value;
    throw new Error(`Unsupported worker: ${value}. Expected --worker claude-code or --worker codex.`);
}
function hookSettingsPath(root, worker, local) {
    if (worker === "codex")
        return (0, node_path_1.join)(root, ".codex", local ? "hooks.local.json" : "hooks.json");
    return (0, node_path_1.join)(root, ".claude", local ? "settings.local.json" : "settings.json");
}
function hookSettingsCandidatePaths(root) {
    return [
        hookSettingsPath(root, "claude-code", false),
        hookSettingsPath(root, "claude-code", true),
        hookSettingsPath(root, "codex", false),
        hookSettingsPath(root, "codex", true),
    ];
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function asGroupArray(value) {
    return Array.isArray(value) ? value : [];
}
function asCodexHookArray(value) {
    return Array.isArray(value) ? value : [];
}
function groupsContainCommand(groups, command) {
    return groups.some((group) => {
        const entries = Array.isArray(group?.hooks) ? group.hooks : [];
        return entries.some((entry) => entry?.command === command);
    });
}
function codexHooksContainCommand(hooks, event, command) {
    return hooks.some((entry) => entry?.event === event && entry?.command === command);
}
