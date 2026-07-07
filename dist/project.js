"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProofloopAgentTargets = resolveProofloopAgentTargets;
exports.writeProofloopAgentDocs = writeProofloopAgentDocs;
exports.syncProofloopPackageScripts = syncProofloopPackageScripts;
exports.buildProofloopProjectManifest = buildProofloopProjectManifest;
exports.writeProofloopProjectManifest = writeProofloopProjectManifest;
exports.formatProofloopProjectManifestDense = formatProofloopProjectManifestDense;
exports.discoverUiContracts = discoverUiContracts;
exports.formatUiContractsDense = formatUiContractsDense;
exports.listProofloopTemplates = listProofloopTemplates;
exports.formatProofloopTemplateList = formatProofloopTemplateList;
exports.writeProofloopTemplate = writeProofloopTemplate;
exports.writeProofloopLiveScaffold = writeProofloopLiveScaffold;
exports.listProofloopWorkflows = listProofloopWorkflows;
exports.buildResume = buildResume;
exports.buildReport = buildReport;
exports.writeProofloopCharts = writeProofloopCharts;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const detect_1 = require("./detect");
const gate_1 = require("./gate");
const AGENT_MARKER_START = "<!-- proofloop-agent-friendly:start -->";
const AGENT_MARKER_END = "<!-- proofloop-agent-friendly:end -->";
const AGENT_FILES = {
    codex: { path: "AGENTS.md", label: "Codex" },
    claude: { path: "CLAUDE.md", label: "Claude Code" },
    cursor: { path: ".cursor/rules/proofloop.mdc", label: "Cursor" },
    windsurf: { path: ".windsurf/rules/proofloop.md", label: "Windsurf" },
};
const RELEVANT_SCRIPT_NAMES = new Set([
    "dev",
    "start",
    "build",
    "preview",
    "test",
    "test:e2e",
    "typecheck",
    "lint",
]);
const GENERATED_PACKAGE_SCRIPTS = {
    "proofloop:init": "npx proofloop init --agent auto --live",
    "proofloop:live": "npx proofloop this-repo --live",
    "proofloop:gate": "npx proofloop gate",
    "proofloop:resume": "npx proofloop resume --dense",
    "proofloop:doctor": "npx proofloop doctor --json",
    "proofloop:target": "npx proofloop target --write-runner-plan",
    "proofloop:report": "npx proofloop report latest",
    "proofloop:charts": "npx proofloop charts latest",
};
const PROJECT_TEMPLATES = [
    {
        id: "chat-agent",
        title: "Chat Agent",
        workflow: "Send a user request, wait for the agent response, and verify the answer is grounded in visible evidence.",
        checks: [
            { name: "build", command: "npm run build" },
            { name: "live-chat", command: "npm run test:e2e -- proofloop" },
        ],
        selectors: ["chat-input", "chat-send", "agent-response", "evidence-panel"],
    },
    {
        id: "spreadsheet-agent",
        title: "Spreadsheet Agent",
        workflow: "Load a workbook-like task, perform calculations, and verify formulas, totals, charts, and exported artifacts.",
        checks: [
            { name: "build", command: "npm run build" },
            { name: "spreadsheet-proof", command: "npm run test:e2e -- spreadsheet" },
        ],
        selectors: ["spreadsheet-grid", "formula-bar", "chart-canvas", "export-button"],
    },
    {
        id: "underwriting-agent",
        title: "Underwriting Agent",
        workflow: "Ingest synthetic borrower/company inputs, extract facts, apply policy rules, and produce a decision memo with citations.",
        checks: [
            { name: "build", command: "npm run build" },
            { name: "underwriting-proof", command: "npm run test:e2e -- underwriting" },
        ],
        selectors: ["intake-upload", "risk-score", "policy-evidence", "decision-memo"],
    },
    {
        id: "nodeagent-ingestion",
        title: "NodeAgent Document Ingestion",
        workflow: "Shard sources through a document pool, transform canonical documents through a memory pool, and verify the two-pool receipt.",
        checks: [
            { name: "ingestion-smoke", command: "npm run nodeagent:ingestion:smoke" },
            { name: "ingestion-receipt", command: "npx proofloop receipt verify --file docs/eval/nodeagent-ingestion-orchestrator.json --kind nodeagent-ingestion --min-documents 1 --min-memory-objects 1" },
        ],
        selectors: ["source-list", "ingestion-run", "receipt-status", "memory-objects"],
    },
    {
        id: "research-dossier",
        title: "Research Dossier",
        workflow: "Research an entity, cite sources, compare alternatives, and produce a reviewable dossier.",
        checks: [
            { name: "build", command: "npm run build" },
            { name: "research-proof", command: "npm run test:e2e -- research" },
        ],
        selectors: ["research-query", "source-list", "dossier-output", "citation"],
    },
    {
        id: "support-agent",
        title: "Support Agent",
        workflow: "Triage an issue, retrieve account/product context, propose a response, and require approval before external action.",
        checks: [
            { name: "build", command: "npm run build" },
            { name: "support-proof", command: "npm run test:e2e -- support" },
        ],
        selectors: ["ticket-input", "context-panel", "draft-reply", "approval-button"],
    },
];
function resolveProofloopAgentTargets(root, target = "auto") {
    if (target === "all")
        return ["codex", "claude", "cursor", "windsurf"];
    if (target !== "auto")
        return [target];
    const found = Object.entries(AGENT_FILES).filter(([, file]) => (0, node_fs_1.existsSync)((0, node_path_1.join)((0, node_path_1.resolve)(root), file.path)));
    if (found.length > 0)
        return found.map(([agent]) => agent);
    return ["codex", "claude"];
}
function writeProofloopAgentDocs(root, target = "auto") {
    const resolved = (0, node_path_1.resolve)(root);
    const targets = resolveProofloopAgentTargets(resolved, target);
    const written = [];
    for (const agent of targets) {
        const file = AGENT_FILES[agent];
        const path = (0, node_path_1.join)(resolved, file.path);
        const previous = (0, node_fs_1.existsSync)(path) ? (0, node_fs_1.readFileSync)(path, "utf8") : "";
        const block = buildAgentDocBlock(agent);
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
        (0, node_fs_1.writeFileSync)(path, upsertMarkedBlock(previous, block), "utf8");
        written.push(file.path);
    }
    return written;
}
function buildAgentDocBlock(agent) {
    const label = AGENT_FILES[agent].label;
    return [
        AGENT_MARKER_START,
        `These instructions are generated for ${label}. Keep Proof Loop CLI-first and load only the slice you need.`,
        "",
        "Setup and status:",
        "- `npx proofloop init --agent auto --live` writes config, manifest, agent docs, scripts, and live-proof templates.",
        "- `npx proofloop doctor --json` reports exact missing setup checks with fix commands.",
        "- `npx proofloop manifest --dense` prints compact repo status, proof gates, workflows, and UI contracts.",
        "- `npx proofloop ui contract --dense` lists stable selectors before browser work.",
        "- `npx proofloop target --write-runner-plan` writes target plan JSON and `.proofloop/reports/latest.md`.",
        "- Read `docs/agent-os/README.md` for the ProofLoop Agent OS doctrine pack when present.",
        "",
        "Loop contract:",
        "- `npx proofloop this-repo --live` starts a local proof loop for this repo.",
        "- `npx proofloop gate` is the completion gate; transcript summaries are not proof.",
        "- `npx proofloop resume --dense` prints the next action after a stop or failure.",
        "- `npx proofloop report latest` summarizes the latest gate receipt.",
        "- `.proofloop/reports/latest.md` is the dated context page to hand to another coding agent.",
        "- `npx proofloop charts latest` writes local proof charts from gate receipts.",
        "",
        "Guardrails:",
        "- Fix the product or tests; do not weaken `proofloop.config.json`, `.proofloop/`, or `.github/workflows/` to get green.",
        "- MCP is optional and secondary: `npx proofloop mcp` exposes the same compact read-only surfaces to MCP clients.",
        AGENT_MARKER_END,
        "",
    ].join("\n");
}
function upsertMarkedBlock(previous, block) {
    const start = previous.indexOf(AGENT_MARKER_START);
    const end = previous.indexOf(AGENT_MARKER_END);
    if (start >= 0 && end >= start) {
        const after = end + AGENT_MARKER_END.length;
        return `${previous.slice(0, start).trimEnd()}\n\n${block}${previous.slice(after).trimStart() ? `\n${previous.slice(after).trimStart()}` : ""}`;
    }
    return previous.trim().length > 0 ? `${previous.trimEnd()}\n\n${block}` : block;
}
function syncProofloopPackageScripts(root) {
    const path = (0, node_path_1.join)((0, node_path_1.resolve)(root), "package.json");
    if (!(0, node_fs_1.existsSync)(path))
        return { changed: false, scripts: {} };
    const pkg = readJsonRecord(path);
    const scripts = pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? { ...pkg.scripts } : {};
    let changed = false;
    for (const [name, command] of Object.entries(GENERATED_PACKAGE_SCRIPTS)) {
        if (scripts[name] !== command) {
            scripts[name] = command;
            changed = true;
        }
    }
    if (changed) {
        pkg.scripts = scripts;
        (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }
    return {
        path,
        changed,
        scripts: Object.fromEntries(Object.entries(scripts).filter(([, value]) => typeof value === "string")),
    };
}
function buildProofloopProjectManifest(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const app = (0, detect_1.detectApp)(resolved);
    const pkg = readPackageJson(resolved);
    const repoName = typeof pkg?.name === "string" && pkg.name.trim() ? pkg.name.trim() : (0, node_path_1.basename)(resolved);
    const config = safeReadConfig(resolved);
    const referenceConfigPath = (0, node_path_1.join)(resolved, ".proofloop", "config.json");
    const referenceConfigExists = (0, node_fs_1.existsSync)(referenceConfigPath);
    const packageScripts = relevantScripts(pkg);
    const agentInstructions = Object.entries(AGENT_FILES)
        .map(([agent, file]) => ({ agent, path: file.path, exists: (0, node_fs_1.existsSync)((0, node_path_1.join)(resolved, file.path)) }));
    const workflows = listProofloopWorkflows(resolved);
    const uiContracts = discoverUiContracts(resolved);
    const knownBlockers = [];
    if (!(0, config_1.configExists)(resolved) && !referenceConfigExists)
        knownBlockers.push("proofloop.config.json missing; run `npx proofloop init --agent auto --live`.");
    if (!(0, config_1.configExists)(resolved) && referenceConfigExists) {
        knownBlockers.push("NodeRoom reference `.proofloop/config.json` detected; add `proofloop.config.json` only if standalone `npx proofloop gate` should run directly.");
    }
    if (config && config.gate.checks.length === 0)
        knownBlockers.push("gate.checks is empty; add deterministic checks before claiming proof.");
    if (!pkg)
        knownBlockers.push("package.json missing; package script aliases were not installed.");
    if (pkg && !hasProofloopScripts(pkg))
        knownBlockers.push("Proof Loop package scripts missing; run `npx proofloop init --agent auto --live`.");
    if (uiContracts.length === 0)
        knownBlockers.push("No stable `data-testid` or `data-proofloop` selectors found.");
    if (!hasProofloopGithubWorkflow(resolved))
        knownBlockers.push("GitHub proof gate missing; run `npx proofloop ci install github`.");
    return {
        schema: "proofloop-project-manifest-v1",
        generatedAt: new Date().toISOString(),
        config: (0, config_1.configExists)(resolved)
            ? { kind: "portable", path: "proofloop.config.json" }
            : referenceConfigExists
                ? { kind: "reference", path: ".proofloop/config.json" }
                : { kind: "missing" },
        repo: {
            name: repoName,
            root: resolved,
            app: app.app,
            appReason: app.reason,
            stack: detectStack(pkg, resolved),
        },
        commands: {
            init: "npx proofloop init --agent auto --live",
            doctor: "npx proofloop doctor --json",
            manifest: "npx proofloop manifest --dense",
            target: "npx proofloop target --write-runner-plan",
            live: "npx proofloop this-repo --live",
            gate: "npx proofloop gate",
            resume: "npx proofloop resume --dense",
            report: "npx proofloop report latest",
            charts: "npx proofloop charts latest",
            ui: "npx proofloop ui contract --dense",
            mcp: "npx proofloop mcp",
        },
        packageScripts,
        agentInstructions,
        workflows,
        proofGates: config?.gate.checks ?? readReferenceSuiteChecks(referenceConfigPath),
        uiContracts,
        knownBlockers,
    };
}
function writeProofloopProjectManifest(root) {
    const path = (0, node_path_1.join)((0, node_path_1.resolve)(root), ".proofloop", "manifest.json");
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(buildProofloopProjectManifest(root), null, 2)}\n`, "utf8");
    return path;
}
function formatProofloopProjectManifestDense(manifest) {
    const lines = [
        `repo=${manifest.repo.name}`,
        `app=${manifest.repo.app} (${manifest.repo.appReason})`,
        `config=${manifest.config.kind}${manifest.config.path ? `:${manifest.config.path}` : ""}`,
        `stack=${manifest.repo.stack.length ? manifest.repo.stack.join(",") : "unknown"}`,
        `agents=${manifest.agentInstructions.filter((entry) => entry.exists).map((entry) => entry.path).join(",") || "missing"}`,
        `scripts=${Object.keys(manifest.packageScripts).join(",") || "none"}`,
        `gates=${manifest.proofGates.map((check) => check.name).join(",") || "none"}`,
        `workflows=${manifest.workflows.join(",") || "none"}`,
        `ui=${manifest.uiContracts.slice(0, 12).map((contract) => contract.id).join(",") || "none"}`,
        `blockers=${manifest.knownBlockers.length}`,
    ];
    for (const blocker of manifest.knownBlockers.slice(0, 8))
        lines.push(`blocked=${blocker}`);
    lines.push("next=npx proofloop doctor --json && npx proofloop gate");
    return `${lines.join("\n")}\n`;
}
function discoverUiContracts(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const files = collectCandidateFiles(resolved);
    const byId = new Map();
    const attrPattern = /data-(testid|proofloop)\s*=\s*["'`]([^"'`]+)["'`]/g;
    for (const file of files) {
        let text = "";
        try {
            text = (0, node_fs_1.readFileSync)(file, "utf8");
        }
        catch {
            continue;
        }
        for (const match of text.matchAll(attrPattern)) {
            const attr = match[1] === "proofloop" ? "data-proofloop" : "data-testid";
            const id = match[2].trim();
            if (!id || byId.has(id))
                continue;
            const windowText = text.slice(Math.max(0, match.index - 800), Math.min(text.length, match.index + 1200));
            byId.set(id, {
                id,
                selector: `[${attr}="${id}"]`,
                source: slash((0, node_path_1.relative)(resolved, file)),
                actions: inferUiActions(id, windowText),
                assertions: ["visible"],
            });
        }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function formatUiContractsDense(contracts) {
    if (contracts.length === 0)
        return "ui=none\nnext=add stable data-testid or data-proofloop selectors to proof-critical controls\n";
    return `${contracts
        .map((contract) => `${contract.id} ${contract.selector} source=${contract.source} actions=${contract.actions.join("|")} assertions=${contract.assertions.join("|")}`)
        .join("\n")}\n`;
}
function inferUiActions(id, text) {
    const lower = `${id} ${text}`.toLowerCase();
    const actions = new Set();
    if (/click|button|submit|send|save|export|upload|download|run|start|approve/.test(lower))
        actions.add("click");
    if (/input|textarea|type|prompt|query|search|message/.test(lower))
        actions.add("fill");
    if (/select|combobox|dropdown|option/.test(lower))
        actions.add("select");
    if (actions.size === 0)
        actions.add("inspect");
    return [...actions];
}
function listProofloopTemplates() {
    return PROJECT_TEMPLATES.map((template) => ({ ...template, checks: template.checks.map((check) => ({ ...check })), selectors: [...template.selectors] }));
}
function formatProofloopTemplateList(templates = listProofloopTemplates()) {
    return `${templates.map((template) => `${template.id}: ${template.title} - ${template.workflow}`).join("\n")}\n`;
}
function writeProofloopTemplate(root, id, force = false) {
    const template = PROJECT_TEMPLATES.find((entry) => entry.id === id);
    if (!template)
        throw new Error(`unknown template "${id}". Known: ${PROJECT_TEMPLATES.map((entry) => entry.id).join(", ")}`);
    const resolved = (0, node_path_1.resolve)(root);
    const promptPath = (0, node_path_1.join)(resolved, "proofloop", "templates", `${template.id}.prompt.md`);
    const rubricPath = (0, node_path_1.join)(resolved, "proofloop", "rubrics", `${template.id}.yaml`);
    const workflowPath = (0, node_path_1.join)(resolved, "proofloop", "workflows", `${template.id}.workflow.yaml`);
    const files = [
        {
            path: promptPath,
            content: [
                `# ${template.title}`,
                "",
                template.workflow,
                "",
                "Proof contract:",
                "- Run deterministic checks before calling done.",
                "- Use stable UI selectors for live-browser proof.",
                "- Keep proof receipts under `.proofloop/`.",
                "",
            ].join("\n"),
        },
        {
            path: rubricPath,
            content: [
                `id: ${template.id}`,
                `title: ${template.title}`,
                "must:",
                "  - deterministic checks pass",
                "  - live workflow evidence exists",
                "  - no proof gate or verifier weakening",
                "selectors:",
                ...template.selectors.map((selector) => `  - ${selector}`),
                "",
            ].join("\n"),
        },
        {
            path: workflowPath,
            content: [
                `id: ${template.id}`,
                `title: ${template.title}`,
                `workflow: ${JSON.stringify(template.workflow)}`,
                "commands:",
                "  doctor: npx proofloop doctor --json",
                "  gate: npx proofloop gate",
                "checks:",
                ...template.checks.map((check) => `  - name: ${check.name}\n    command: ${JSON.stringify(check.command)}`),
                "",
            ].join("\n"),
        },
    ];
    for (const file of files) {
        if ((0, node_fs_1.existsSync)(file.path) && !force)
            continue;
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(file.path), { recursive: true });
        (0, node_fs_1.writeFileSync)(file.path, file.content, "utf8");
    }
    return files.map((file) => file.path);
}
function writeProofloopLiveScaffold(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const files = [
        {
            path: (0, node_path_1.join)(resolved, "proofloop", "workflows", "primary.workflow.yaml"),
            content: [
                "id: primary",
                "title: Primary Proof Loop",
                "commands:",
                "  doctor: npx proofloop doctor --json",
                "  live: npx proofloop this-repo --live",
                "  gate: npx proofloop gate",
                "  resume: npx proofloop resume --dense",
                "required_receipts:",
                "  - .proofloop/gate-state.json",
                "  - .proofloop/manifest.json",
                "",
            ].join("\n"),
        },
        {
            path: (0, node_path_1.join)(resolved, "proofloop", "rubrics", "live-user-contract.yaml"),
            content: [
                "id: live-user-contract",
                "must:",
                "  - run the real app path, not a mocked transcript",
                "  - verify visible user-facing output",
                "  - preserve gate and verifier integrity",
                "",
            ].join("\n"),
        },
        {
            path: (0, node_path_1.join)(resolved, "proofloop", "rubrics", "behavioral.yaml"),
            content: [
                "id: behavioral",
                "must_not:",
                "  - claim done from summary text",
                "  - weaken deterministic checks",
                "  - edit proof receipts by hand",
                "",
            ].join("\n"),
        },
    ];
    const written = [];
    for (const file of files) {
        if ((0, node_fs_1.existsSync)(file.path))
            continue;
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(file.path), { recursive: true });
        (0, node_fs_1.writeFileSync)(file.path, file.content, "utf8");
        written.push(file.path);
    }
    return written;
}
function listProofloopWorkflows(root) {
    const dir = (0, node_path_1.join)((0, node_path_1.resolve)(root), "proofloop", "workflows");
    if (!(0, node_fs_1.existsSync)(dir))
        return [];
    return (0, node_fs_1.readdirSync)(dir)
        .filter((name) => /\.(ya?ml|json)$/i.test(name))
        .map((name) => slash((0, node_path_1.relative)((0, node_path_1.resolve)(root), (0, node_path_1.join)(dir, name))))
        .sort();
}
function buildResume(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const config = safeReadConfig(resolved);
    const state = readGateState(resolved);
    const status = state?.status ?? "no_gate_result";
    const checks = state?.checks ?? [];
    const failing = checks.filter((check) => !check.pass).map((check) => check.name);
    const blockers = [];
    if (!config)
        blockers.push("missing proofloop.config.json");
    if (config && config.gate.checks.length === 0)
        blockers.push("gate.checks empty");
    if (status === "failed" && failing.length > 0)
        blockers.push(`failing checks: ${failing.join(", ")}`);
    const next = status === "passed"
        ? "ship or install CI with `npx proofloop ci install github` if not already present"
        : config
            ? "fix blockers, then run `npx proofloop gate`"
            : "run `npx proofloop init --agent auto --live`";
    const dense = [
        `status=${status}`,
        `gate=${gate_1.GATE_STATE_RELATIVE_PATH}`,
        `checks=${checks.length}`,
        `failed=${failing.join(",") || "none"}`,
        `blocked=${blockers.join(" | ") || "none"}`,
        `next=${next}`,
    ].join("\n");
    return {
        dense: `${dense}\n`,
        json: { status, gate: gate_1.GATE_STATE_RELATIVE_PATH, checks, blockers, next },
    };
}
function buildReport(root) {
    const state = readGateState(root);
    if (!state) {
        return {
            text: "proofloop report: no gate receipt found. Run `npx proofloop gate`.\n",
            json: { status: "missing", gate: gate_1.GATE_STATE_RELATIVE_PATH },
        };
    }
    const passed = state.checks.filter((check) => check.pass).length;
    const failed = state.checks.length - passed;
    return {
        text: [
            `proofloop report: ${state.status}`,
            `source: ${state.source}`,
            `checks: ${passed} passed, ${failed} failed`,
            `updated: ${state.ts}`,
            "",
        ].join("\n"),
        json: { status: state.status, source: state.source, passed, failed, ts: state.ts, checks: state.checks },
    };
}
function writeProofloopCharts(root) {
    const resolved = (0, node_path_1.resolve)(root);
    const report = buildReport(resolved).json;
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const passed = checks.filter((check) => check.pass === true).length;
    const failed = checks.filter((check) => check.pass === false).length;
    const missing = checks.length === 0 ? 1 : 0;
    const dir = (0, node_path_1.join)(resolved, ".proofloop", "charts");
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    const jsonPath = (0, node_path_1.join)(dir, "latest.json");
    const svgPath = (0, node_path_1.join)(dir, "latest.svg");
    (0, node_fs_1.writeFileSync)(jsonPath, `${JSON.stringify({ schema: "proofloop-chart-v1", generatedAt: new Date().toISOString(), passed, failed, missing, report }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)(svgPath, renderChartSvg({ passed, failed, missing }), "utf8");
    return { jsonPath, svgPath };
}
function renderChartSvg(values) {
    const bars = [
        { label: "passed", value: values.passed, color: "#0f8a5f" },
        { label: "failed", value: values.failed, color: "#c2410c" },
        { label: "missing", value: values.missing, color: "#64748b" },
    ];
    const max = Math.max(1, ...bars.map((bar) => bar.value));
    const rows = bars.map((bar, index) => {
        const y = 40 + index * 42;
        const width = Math.round((bar.value / max) * 240);
        return `<text x="24" y="${y + 18}" font-size="13" fill="#0f172a">${bar.label}</text><rect x="100" y="${y}" width="${width}" height="24" rx="4" fill="${bar.color}"/><text x="${112 + width}" y="${y + 17}" font-size="12" fill="#0f172a">${bar.value}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="190" viewBox="0 0 400 190"><rect width="400" height="190" fill="#ffffff"/><text x="24" y="24" font-size="16" font-family="Arial, sans-serif" fill="#0f172a">Proof Loop Gate Receipt</text><g font-family="Arial, sans-serif">${rows.join("")}</g></svg>\n`;
}
function readGateState(root) {
    const path = (0, node_path_1.join)((0, node_path_1.resolve)(root), gate_1.GATE_STATE_RELATIVE_PATH);
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
function safeReadConfig(root) {
    try {
        return (0, config_1.readConfig)(root);
    }
    catch {
        return undefined;
    }
}
function readPackageJson(root) {
    const path = (0, node_path_1.join)((0, node_path_1.resolve)(root), "package.json");
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    return readJsonRecord(path);
}
function readJsonRecord(path) {
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function relevantScripts(pkg) {
    const scripts = pkg?.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
    const out = {};
    for (const [name, command] of Object.entries(scripts)) {
        if (typeof command !== "string")
            continue;
        if (RELEVANT_SCRIPT_NAMES.has(name) || name.startsWith("proofloop:") || name.startsWith("benchmark:proofloop") || name.startsWith("benchmark:official")) {
            out[name] = command;
        }
    }
    return out;
}
function hasProofloopScripts(pkg) {
    const scripts = relevantScripts(pkg);
    return Object.keys(GENERATED_PACKAGE_SCRIPTS).every((name) => typeof scripts[name] === "string" && scripts[name].includes("proofloop"));
}
function readReferenceSuiteChecks(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return [];
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        const suites = record.suites && typeof record.suites === "object" && !Array.isArray(record.suites) ? record.suites : {};
        const checks = [];
        for (const [name, value] of Object.entries(suites)) {
            if (!value || typeof value !== "object" || Array.isArray(value))
                continue;
            const command = value.cmd;
            if (typeof command === "string" && command.trim())
                checks.push({ name, command: command.trim() });
        }
        return checks;
    }
    catch {
        return [];
    }
}
function detectStack(pkg, root) {
    const deps = {};
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const section = pkg?.[field];
        if (section && typeof section === "object" && !Array.isArray(section)) {
            for (const [name, version] of Object.entries(section)) {
                if (typeof version === "string")
                    deps[name] = version;
            }
        }
    }
    const stack = [];
    if (deps.next)
        stack.push("Next.js");
    if (deps.vite || deps["@vitejs/plugin-react"])
        stack.push("Vite");
    if (deps.react || deps["react-dom"])
        stack.push("React");
    if (deps.typescript || (0, node_fs_1.existsSync)((0, node_path_1.join)(root, "tsconfig.json")))
        stack.push("TypeScript");
    if (deps["@playwright/test"] || deps.playwright || (0, node_fs_1.existsSync)((0, node_path_1.join)(root, "playwright.config.ts")))
        stack.push("Playwright");
    if (deps.convex || (0, node_fs_1.existsSync)((0, node_path_1.join)(root, "convex")))
        stack.push("Convex");
    if ((0, node_fs_1.existsSync)((0, node_path_1.join)(root, "vercel.json")) || deps.vercel)
        stack.push("Vercel");
    return [...new Set(stack)];
}
function hasProofloopGithubWorkflow(root) {
    const dir = (0, node_path_1.join)((0, node_path_1.resolve)(root), ".github", "workflows");
    if (!(0, node_fs_1.existsSync)(dir))
        return false;
    for (const name of (0, node_fs_1.readdirSync)(dir)) {
        if (!/\.(ya?ml)$/i.test(name))
            continue;
        const path = (0, node_path_1.join)(dir, name);
        try {
            const text = (0, node_fs_1.readFileSync)(path, "utf8").toLowerCase();
            if (text.includes("proofloop") || text.includes("proof loop"))
                return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
function collectCandidateFiles(root) {
    const roots = ["src", "app", "pages", "components", "e2e", "tests", "test", "proofloop"]
        .map((name) => (0, node_path_1.join)(root, name))
        .filter((path) => (0, node_fs_1.existsSync)(path));
    const files = [];
    for (const start of roots)
        walk(start, files, 800);
    return files.slice(0, 800);
}
function walk(path, files, limit) {
    if (files.length >= limit)
        return;
    let stat;
    try {
        stat = (0, node_fs_1.statSync)(path);
    }
    catch {
        return;
    }
    if (stat.isFile()) {
        if (/\.(tsx?|jsx?|mjs|cjs|html|svelte|vue)$/i.test(path))
            files.push(path);
        return;
    }
    if (!stat.isDirectory())
        return;
    const name = (0, node_path_1.basename)(path);
    if (["node_modules", "dist", "build", ".git", ".next", "coverage", ".proofloop"].includes(name))
        return;
    for (const child of (0, node_fs_1.readdirSync)(path).sort())
        walk((0, node_path_1.join)(path, child), files, limit);
}
function slash(value) {
    return value.replace(/\\/g, "/");
}
