"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProofloopLayeredRunnerPlan = buildProofloopLayeredRunnerPlan;
exports.writeProofloopLayeredRunnerPlan = writeProofloopLayeredRunnerPlan;
exports.defaultLayeredPlanPath = defaultLayeredPlanPath;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const DEFAULT_PLAN_PATH = (0, node_path_1.join)(".proofloop", "runner", "latest-updates.plan.json");
const SETUP_TASK_TIMEOUT_MS = 10 * 60_000;
const CAPABILITY_TASK_TIMEOUT_MS = 30 * 60_000;
const BROWSER_TASK_TIMEOUT_MS = 45 * 60_000;
const CAPABILITY_SCRIPT_NAMES = new Set([
    "build",
    "check",
    "lint",
    "test",
    "typecheck",
    "verify",
]);
const CAPABILITY_COMMAND_PATTERNS = [
    /\bbiome\b/i,
    /\beslint\b/i,
    /\bjest\b/i,
    /\bmocha\b/i,
    /\btsc\b/i,
    /\bvitest\b/i,
];
const BROWSER_PATTERNS = [
    /\bbrowser\b/i,
    /\bcypress\b/i,
    /\be2e\b/i,
    /\bplaywright\b/i,
    /\bpuppeteer\b/i,
    /\bselenium\b/i,
    /\bwebdriver\b/i,
];
const LONG_RUNNING_SCRIPT_PARTS = new Set(["dev", "preview", "serve", "start", "watch"]);
const LONG_RUNNING_COMMAND_PATTERNS = [
    /\b--watch\b/i,
    /\b--ui\b/i,
    /\bnext\s+dev\b/i,
    /\bnuxt\s+dev\b/i,
    /\bremix\s+dev\b/i,
    /\btsx\s+watch\b/i,
    /\bts-node-dev\b/i,
    /\bturbo\s+dev\b/i,
];
function buildProofloopLayeredRunnerPlan(rootInput, options = {}) {
    const root = (0, node_path_1.resolve)(rootInput);
    const scripts = readPackageScripts(root);
    const tasks = [];
    addTask(tasks, {
        id: "setup.doctor",
        command: "npx proofloop doctor --json",
        timeoutMs: SETUP_TASK_TIMEOUT_MS,
    });
    const scriptEntries = Object.entries(scripts).sort(([a], [b]) => scoreScript(a) - scoreScript(b) || a.localeCompare(b));
    for (const [name, command] of scriptEntries) {
        if (looksLikeLongRunningScript(name, command))
            continue;
        if (!looksLikeCapabilityScript(name, command))
            continue;
        addTask(tasks, {
            id: `capability.${toTaskId(name)}`,
            command: `npm run ${quoteNpmScriptName(name)}`,
            timeoutMs: CAPABILITY_TASK_TIMEOUT_MS,
        });
    }
    addTask(tasks, {
        id: "capability.gate",
        command: "npx proofloop gate",
        timeoutMs: CAPABILITY_TASK_TIMEOUT_MS,
    });
    for (const [name, command] of scriptEntries) {
        if (looksLikeLongRunningScript(name, command))
            continue;
        if (!looksLikeBrowserScript(name, command))
            continue;
        addTask(tasks, {
            id: `browser.${toTaskId(name)}`,
            command: `npm run ${quoteNpmScriptName(name)}`,
            timeoutMs: BROWSER_TASK_TIMEOUT_MS,
        });
    }
    const setupTasks = tasks.filter((task) => task.id.startsWith("setup.")).length;
    const browserTasks = tasks.filter((task) => task.id.startsWith("browser.")).length;
    const capabilityTasks = tasks.filter((task) => task.id.startsWith("capability.")).length;
    return {
        schema: "proofloop-runner-plan-v1",
        mode: "two-layer-certification-v1",
        generatedAt: new Date().toISOString(),
        ...(options.goal ? { goal: options.goal } : {}),
        summary: {
            setupTasks,
            capabilityTasks,
            browserTasks,
            totalTasks: tasks.length,
            browserRequiredForAllCapabilityTasks: false,
        },
        notes: [
            "Capability tasks run headless checks and ProofLoop gates first.",
            "Browser tasks are separate UI certification checks discovered from e2e/browser scripts.",
            "Do not multiply every benchmark or agent task through the browser unless the task is specifically certifying UI behavior.",
            "The durable runner records state under .proofloop/runner/runs and can resume after interruption.",
        ],
        tasks,
    };
}
function writeProofloopLayeredRunnerPlan(rootInput, options = {}) {
    const root = (0, node_path_1.resolve)(rootInput);
    const plan = buildProofloopLayeredRunnerPlan(root, { ...(options.goal ? { goal: options.goal } : {}) });
    const planPath = (0, node_path_1.resolve)(root, options.planPath ?? DEFAULT_PLAN_PATH);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(planPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    return { planPath, plan };
}
function defaultLayeredPlanPath(rootInput) {
    return (0, node_path_1.resolve)(rootInput, DEFAULT_PLAN_PATH);
}
function readPackageScripts(root) {
    const packagePath = (0, node_path_1.join)(root, "package.json");
    if (!(0, node_fs_1.existsSync)(packagePath))
        return {};
    const parsed = JSON.parse((0, node_fs_1.readFileSync)(packagePath, "utf8").replace(/^\uFEFF/, ""));
    return parsed.scripts ?? {};
}
function looksLikeBrowserScript(name, command) {
    const haystack = `${name} ${command}`;
    return BROWSER_PATTERNS.some((pattern) => pattern.test(haystack));
}
function looksLikeCapabilityScript(name, command) {
    if (looksLikeBrowserScript(name, command))
        return false;
    const parts = name.split(/[:/_-]/g).filter(Boolean);
    if (parts.some((part) => CAPABILITY_SCRIPT_NAMES.has(part)))
        return true;
    return CAPABILITY_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
function looksLikeLongRunningScript(name, command) {
    const parts = name.split(/[:/_-]/g).filter(Boolean);
    if (parts.some((part) => LONG_RUNNING_SCRIPT_PARTS.has(part)))
        return true;
    return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
function addTask(tasks, task) {
    const existing = new Set(tasks.map((entry) => entry.id));
    if (!existing.has(task.id)) {
        tasks.push(task);
        return;
    }
    let suffix = 2;
    let next = `${task.id}-${suffix}`;
    while (existing.has(next)) {
        suffix += 1;
        next = `${task.id}-${suffix}`;
    }
    tasks.push({ ...task, id: next });
}
function toTaskId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "script";
}
function quoteNpmScriptName(name) {
    return /^[A-Za-z0-9:_-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}
function scoreScript(name) {
    const order = ["build", "typecheck", "lint", "check", "test", "verify"];
    const index = order.findIndex((entry) => name === entry || name.startsWith(`${entry}:`) || name.endsWith(`:${entry}`));
    return index >= 0 ? index : order.length;
}
