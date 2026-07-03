"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMUM_NODE_MAJOR = void 0;
exports.buildDoctorReport = buildDoctorReport;
exports.formatDoctorReport = formatDoctorReport;
exports.runDoctor = runDoctor;
/**
 * `proofloop doctor` -- environment + readiness report. Exit 0 ALWAYS (it's a
 * report, not a gate). Reports: node version (warn if <20), git present +
 * is-a-git-repo, which coding-agent workers are on PATH (claude, codex),
 * whether .claude/ exists, whether hooks are installed, whether a config exists.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const detect_1 = require("./detect");
const proofloopHooks_1 = require("./proofloopHooks");
exports.MINIMUM_NODE_MAJOR = 20;
function nodeMajor(version) {
    const match = /^v?(\d+)\./.exec(version);
    return match ? Number(match[1]) : 0;
}
function buildDoctorReport(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const version = process.version;
    const major = nodeMajor(version);
    const nodeOk = major >= exports.MINIMUM_NODE_MAJOR;
    const gitAvailable = (0, detect_1.isGitAvailable)();
    const gitRepo = gitAvailable && (0, detect_1.isGitRepo)(resolved);
    const workers = (0, detect_1.detectWorkers)();
    const claudeDirExists = (0, node_fs_1.existsSync)((0, node_path_1.join)(resolved, ".claude"));
    const hooksStatus = (0, proofloopHooks_1.proofloopHooksStatus)({ root: resolved });
    const hooksInstalled = hooksStatus.settings.some((file) => file.stopHookInstalled);
    const hasConfig = (0, config_1.configExists)(resolved);
    const missing = [];
    if (!nodeOk)
        missing.push(`Node >= ${exports.MINIMUM_NODE_MAJOR} (you have ${version})`);
    if (!gitAvailable)
        missing.push("git on PATH");
    if (!gitRepo)
        missing.push("this directory is not a git repo (run `git init`)");
    if (!workers.some((worker) => worker.onPath))
        missing.push("a coding-agent CLI on PATH (claude or codex)");
    if (!hasConfig)
        missing.push("proofloop.config.json (run `proofloop init`)");
    return {
        node: { version, major, ok: nodeOk },
        git: { available: gitAvailable, isRepo: gitRepo },
        workers,
        claudeDirExists,
        hooksInstalled,
        configExists: hasConfig,
        ready: missing.length === 0,
        missing,
    };
}
function formatDoctorReport(report) {
    const check = (ok) => (ok ? "OK  " : "MISS");
    const lines = [
        "Proof Loop doctor -- environment + readiness",
        "",
        `  [${check(report.node.ok)}] node ${report.node.version} (need >= ${exports.MINIMUM_NODE_MAJOR})`,
        `  [${check(report.git.available)}] git on PATH`,
        `  [${check(report.git.isRepo)}] inside a git repo`,
    ];
    for (const worker of report.workers) {
        lines.push(`  [${worker.onPath ? "OK  " : "----"}] worker "${worker.name}"${worker.onPath ? ` -> ${worker.location}` : " (not on PATH)"}`);
    }
    lines.push(`  [${report.claudeDirExists ? "OK  " : "----"}] .claude/ present`);
    lines.push(`  [${report.hooksInstalled ? "OK  " : "----"}] proofloop hooks installed`);
    lines.push(`  [${check(report.configExists)}] proofloop.config.json present`);
    lines.push("");
    if (report.ready) {
        lines.push("You're ready: run `proofloop gate` to prove the work, or paste `proofloop prompt` into your agent.");
    }
    else {
        lines.push("Here's what's missing before the loop is fully wired:");
        for (const item of report.missing)
            lines.push(`  - ${item}`);
    }
    return `${lines.join("\n")}\n`;
}
/** Exit 0 always. */
function runDoctor(options) {
    const log = options.log ?? console.log;
    log(formatDoctorReport(buildDoctorReport((0, node_path_1.resolve)(options.root))));
    return 0;
}
