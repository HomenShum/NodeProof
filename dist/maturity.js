"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessAgentEraMaturity = assessAgentEraMaturity;
exports.writeAgentEraMaturityReport = writeAgentEraMaturityReport;
exports.formatAgentEraMaturityDense = formatAgentEraMaturityDense;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const LEVELS = [
    {
        level: 0,
        title: "Prompt-era demo",
        description: "A chat, prototype, or app claim can exist, but proof contracts are not yet encoded.",
        requiredCapabilityIds: [],
    },
    {
        level: 1,
        title: "Deterministic product proof",
        description: "The repo has deterministic checks a supervisor can run before accepting done.",
        requiredCapabilityIds: ["deterministic_gates"],
    },
    {
        level: 2,
        title: "Agent-ready repo",
        description: "Agents get scoped instructions, CI backstops the gate, and proof state has guardrails.",
        requiredCapabilityIds: ["ci_backstop", "agent_instructions", "proof_guardrails"],
    },
    {
        level: 3,
        title: "Live app proof",
        description: "The real UI path is testable and produces receipts, screenshots, or scorecards.",
        requiredCapabilityIds: ["tool_ui_contracts", "live_browser_verification", "artifact_receipts"],
    },
    {
        level: 4,
        title: "Long-running proof loop",
        description: "A durable runner can continue work with budget, resume, external workers, and status surfaces.",
        requiredCapabilityIds: ["durable_runner", "budget_model_cost", "external_worker_dashboard", "permission_auth_boundary"],
    },
    {
        level: 5,
        title: "Agent OS / benchmark-ready",
        description: "Official scorers, model sweeps, memory mining, and governance make claims comparable across apps.",
        requiredCapabilityIds: ["official_benchmark_adapters", "model_sweep_costing", "memory_session_mining", "governance_approval"],
    },
];
const DEFAULT_REPORT_PATH = (0, node_path_1.join)(".proofloop", "reports", "agent-era-maturity.md");
const DEFAULT_JSON_PATH = (0, node_path_1.join)(".proofloop", "reports", "agent-era-maturity.json");
const MAX_FILES = 900;
const MAX_TEXT_BYTES = 220_000;
function assessAgentEraMaturity(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const targetLevel = normalizeTargetLevel(options.targetLevel);
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const signals = readRepoSignals(root);
    const capabilities = buildCapabilities(signals);
    const levelAssessments = buildLevelAssessments(capabilities);
    const currentLevel = currentCompletedLevel(levelAssessments);
    const currentStage = levelAssessments.find((entry) => entry.level === currentLevel)?.title ?? LEVELS[0].title;
    const score = maturityScore(capabilities);
    const missing = capabilities
        .filter((capability) => capability.level > 0 && capability.level <= targetLevel && capability.status !== "met")
        .flatMap((capability) => capability.missing.map((item) => `${capability.title}: ${item}`));
    const nextActions = buildNextActions(capabilities, currentLevel, targetLevel);
    const timelineMermaid = renderTimelineMermaid();
    const projectionMermaid = renderProjectionMermaid(currentLevel, targetLevel);
    const report = {
        schema: "proofloop-agent-era-maturity-v1",
        generatedAt,
        root,
        repoName: signals.repoName,
        currentLevel,
        currentStage,
        targetLevel,
        score,
        levelAssessments,
        capabilities,
        missing,
        nextActions,
        timelineMermaid,
        projectionMermaid,
    };
    const reportMarkdown = renderMaturityMarkdown(report);
    return { ...report, reportMarkdown };
}
function writeAgentEraMaturityReport(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const report = assessAgentEraMaturity(options);
    const markdownPath = (0, node_path_1.resolve)(root, options.outPath ?? DEFAULT_REPORT_PATH);
    const jsonPath = (0, node_path_1.resolve)(root, DEFAULT_JSON_PATH);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(markdownPath), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(jsonPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(markdownPath, report.reportMarkdown, "utf8");
    (0, node_fs_1.writeFileSync)(jsonPath, `${JSON.stringify(withoutMarkdown(report), null, 2)}\n`, "utf8");
    return { report, markdownPath, jsonPath };
}
function formatAgentEraMaturityDense(report) {
    const levelLines = report.levelAssessments
        .map((level) => `level=${level.level} status=${level.status} title=${level.title}`)
        .join("\n");
    const capabilityLines = report.capabilities
        .map((capability) => `capability=${capability.id} level=${capability.level} status=${capability.status}`)
        .join("\n");
    const blockedLines = report.missing.slice(0, 10).map((item) => `missing=${item}`).join("\n");
    const nextLines = report.nextActions.slice(0, 8).map((item) => `next=${item}`).join("\n");
    return [
        "proofloop-agent-era-maturity",
        `repo=${report.repoName}`,
        `currentLevel=${report.currentLevel}`,
        `currentStage=${report.currentStage}`,
        `targetLevel=${report.targetLevel}`,
        `score=${report.score}`,
        levelLines,
        capabilityLines,
        blockedLines || "missing=none",
        nextLines || "next=none",
        "",
    ].join("\n");
}
function buildCapabilities(signals) {
    const scriptsText = Object.entries(signals.scripts).map(([name, command]) => `${name} ${command}`).join("\n");
    const text = `${signals.text}\n${scriptsText}`;
    const hasDeterministicScript = hasScript(signals, /\b(test|build|lint|typecheck|check|verify)\b/i);
    const hasE2eScript = hasScript(signals, /\b(e2e|playwright|cypress|puppeteer|selenium|webdriver|browser|live-smoke)\b/i);
    const proofloopSource = hasFile(signals, /^src\/(proofloopHooks|proofloopToolUse|scaffoldConstants|gate)\.ts$/);
    const hostedSource = hasFile(signals, /^src\/hosted\.ts$/) || hasFile(signals, /^api\/hosted\//);
    const hasModelSweepImplementation = hasScript(signals, /\b(model[-:]?sweep|model[-:]?comparison|cost[-:]?ledger|openrouter)\b/i)
        || hasFile(signals, /(model[-]?sweep|modelComparison|model-comparison|costLedger|cost-ledger|openrouter)/i);
    return [
        capability({
            id: "deterministic_gates",
            level: 1,
            title: "Deterministic gates",
            status: signals.config.gateChecks > 0 || hasDeterministicScript ? "met" : "missing",
            evidence: [
                ...(signals.config.gateChecks > 0 ? [`proofloop.config.json has ${signals.config.gateChecks} gate check(s)`] : []),
                ...matchingScripts(signals, /\b(test|build|lint|typecheck|check|verify)\b/i).slice(0, 5),
            ],
            missing: ["Add build/test/lint/typecheck checks to `proofloop.config.json` or package scripts."],
            recommendation: "Start with deterministic commands that can run without browser state or model judging.",
        }),
        capability({
            id: "ci_backstop",
            level: 2,
            title: "CI proof backstop",
            status: hasFile(signals, /^\.github\/workflows\/[^/]+\.ya?ml$/) ? "met" : "missing",
            evidence: matchingFiles(signals, /^\.github\/workflows\/[^/]+\.ya?ml$/).slice(0, 5),
            missing: ["Install a CI workflow so proof gates run from a clean checkout."],
            recommendation: "Run `npx proofloop ci install github` or wire the same gate into your existing CI.",
        }),
        capability({
            id: "agent_instructions",
            level: 2,
            title: "Agent instructions",
            status: hasAgentDocs(signals) ? "met" : "missing",
            evidence: matchingFiles(signals, /^(AGENTS\.md|CLAUDE\.md|\.cursor\/rules\/|\.windsurf\/rules\/|docs\/agent-os\/README\.md)/).slice(0, 8),
            missing: ["Add agent-friendly setup docs that tell Codex/Claude/Cursor what proof command decides done."],
            recommendation: "Run `npx proofloop init --agent auto --live` and keep instructions CLI-first.",
        }),
        capability({
            id: "proof_guardrails",
            level: 2,
            title: "Proof guardrails",
            status: signals.config.immutable > 0 || signals.config.protectedPaths > 0 || proofloopSource ? "met" : signals.config.exists ? "partial" : "missing",
            evidence: [
                ...(signals.config.immutable > 0 ? [`immutable paths: ${signals.config.immutable}`] : []),
                ...(signals.config.protectedPaths > 0 ? [`protected paths: ${signals.config.protectedPaths}`] : []),
                ...matchingFiles(signals, /^src\/(proofloopHooks|proofloopToolUse|scaffoldConstants|gate)\.ts$/).slice(0, 5),
            ],
            missing: ["Protect proof/verifier state from the worker that is being evaluated."],
            recommendation: "Use protected paths, CI, and tool hooks so a repair pass cannot grade its own homework.",
        }),
        capability({
            id: "tool_ui_contracts",
            level: 3,
            title: "Tool and UI contracts",
            status: hasUiContracts(signals) || hasFile(signals, /^src\/proofloopToolUse\.ts$/) ? "met" : hasE2eScript ? "partial" : "missing",
            evidence: [
                ...matchingFiles(signals, /(^src\/proofloopToolUse\.ts$|data-testid|data-proofloop)/).slice(0, 8),
                ...matchingTextEvidence(text, [/data-testid/i, /data-proofloop/i, /expected-tool-use/i]),
            ],
            missing: ["Add stable UI selectors and expected-tool-use contracts for proof-critical actions."],
            recommendation: "Use `data-testid`/`data-proofloop` on critical controls and declare required/forbidden tool calls.",
        }),
        capability({
            id: "live_browser_verification",
            level: 3,
            title: "Live browser verification",
            status: hasE2eScript || hasFile(signals, /(playwright\.config|cypress\.config|proofloop\/browser\/|scripts\/hosted-worker\.mjs$)/) ? "met" : "missing",
            evidence: [
                ...matchingScripts(signals, /\b(e2e|playwright|cypress|puppeteer|selenium|webdriver|browser|live-smoke)\b/i).slice(0, 6),
                ...matchingFiles(signals, /(playwright\.config|cypress\.config|proofloop\/browser\/|scripts\/hosted-worker\.mjs$)/).slice(0, 6),
            ],
            missing: ["Add a Playwright/Cypress/live-smoke path that clicks the real user workflow."],
            recommendation: "Keep live UI responsiveness tests separate from headless benchmark capability tests.",
        }),
        capability({
            id: "artifact_receipts",
            level: 3,
            title: "Artifacts and receipts",
            status: hasFile(signals, /^src\/(receipts|contextReport|project)\.ts$/) || textIncludes(text, /\b(scorecard|receipt|screenshot|video|trace|dashboard)\b/i) ? "met" : "missing",
            evidence: [
                ...matchingFiles(signals, /^src\/(receipts|contextReport|project)\.ts$/).slice(0, 6),
                ...matchingTextEvidence(text, [/scorecard/i, /receipt/i, /screenshot/i, /video/i, /trace/i]).slice(0, 8),
            ],
            missing: ["Persist proof receipts, screenshots, video, traces, scorecards, or dashboards."],
            recommendation: "A maturity report should be an artifact, not just a transcript summary.",
        }),
        capability({
            id: "permission_auth_boundary",
            level: 4,
            title: "Permission and auth boundary",
            status: hostedSource || textIncludes(text, /\b(consent|domain permission|well-known|dns token|authorized to test)\b/i) ? "met" : "missing",
            evidence: [
                ...matchingFiles(signals, /^api\/hosted\/|^src\/hosted\.ts$/).slice(0, 6),
                ...matchingTextEvidence(text, [/consent/i, /domain permission/i, /well-known/i, /authorized to test/i]).slice(0, 6),
            ],
            missing: ["Require consent, domain ownership, and safe auth/session handoff before probing live targets."],
            recommendation: "A hosted proof service must not become a scanner for arbitrary apps.",
        }),
        capability({
            id: "durable_runner",
            level: 4,
            title: "Durable runner",
            status: hasFile(signals, /^src\/runner\.ts$/) || textIncludes(text, /\b(append-only|resume|stale lock|single-flight|runner plan)\b/i) ? "met" : "missing",
            evidence: [
                ...matchingFiles(signals, /^src\/runner\.ts$|^tests\/runner\.test\.ts$/).slice(0, 4),
                ...matchingTextEvidence(text, [/append-only/i, /resume/i, /stale lock/i, /runner plan/i]).slice(0, 6),
            ],
            missing: ["Add a resumable runner with append-only state instead of one-shot scripts only."],
            recommendation: "Long-running agents need a control loop that can resume after crashes and report blockers.",
        }),
        capability({
            id: "budget_model_cost",
            level: 4,
            title: "Budget, model, and cost tracking",
            status: textIncludes(text, /\b(budget|modelBudget|estimatedCostUsd|cost ledger|cost\/pass|model route)\b/i) ? "met" : "missing",
            evidence: matchingTextEvidence(text, [/budget/i, /modelBudget/i, /estimatedCostUsd/i, /cost ledger/i, /cost\/pass/i]).slice(0, 8),
            missing: ["Track model route, estimated spend, cost/pass, and budget kill switches."],
            recommendation: "Use cheap model exploration, but record model version and judge contract for each receipt.",
        }),
        capability({
            id: "external_worker_dashboard",
            level: 4,
            title: "External worker and dashboard",
            status: hasFile(signals, /^\.github\/workflows\/hosted-proofloop\.ya?ml$/) && hasFile(signals, /^api\/hosted\/status\.js$/) ? "met" : hostedSource ? "partial" : "missing",
            evidence: [
                ...matchingFiles(signals, /^\.github\/workflows\/hosted-proofloop\.ya?ml$|^api\/hosted\/(submit|status|health)\.js$|^scripts\/hosted-worker\.mjs$/).slice(0, 8),
            ],
            missing: ["Move long-running browser/model work outside request limits and expose run status plus replay links."],
            recommendation: "Use a managed worker for Playwright/model calls and a public/private dashboard for receipts.",
        }),
        capability({
            id: "official_benchmark_adapters",
            level: 5,
            title: "Official benchmark adapters",
            status: hasOfficialScorer(signals) ? "met" : hasBenchmarkEvidence(signals) ? "partial" : "missing",
            evidence: [
                ...matchingScripts(signals, /\b(official|scorer|score|benchmark)\b/i).slice(0, 8),
                ...matchingTextEvidence(text, [/SpreadsheetBench/i, /WorkstreamBench/i, /FinAuditing/i, /Finch/i, /BankerToolBench/i]).slice(0, 8),
            ],
            missing: ["Configure upstream scorer paths or explicitly recorded equivalent judge contracts for claimed benchmark scores."],
            recommendation: "Keep product-path proof, proxy benchmark proof, and official scorer output as separate receipts.",
        }),
        capability({
            id: "model_sweep_costing",
            level: 5,
            title: "Model sweep and cost leaderboard",
            status: hasModelSweepImplementation
                ? "met"
                : textIncludes(text, /\b(model sweep|model-comparison|model comparison|cost-ledger|cost ledger|openrouter|modelBudget|estimatedCostUsd|model route|cost\/pass|budget)\b/i)
                    ? "partial"
                    : "missing",
            evidence: [
                ...matchingScripts(signals, /\b(model[-:]?sweep|model[-:]?comparison|cost[-:]?ledger|openrouter)\b/i),
                ...matchingFiles(signals, /(model[-]?sweep|modelComparison|model-comparison|costLedger|cost-ledger|openrouter)/i),
                ...matchingTextEvidence(text, [/modelBudget/i, /estimatedCostUsd/i, /cost ledger/i]).slice(0, 5),
            ].slice(0, 8),
            missing: ["Run multiple models on the same proxy tasks and publish pass rate, failure type, latency, and cost/pass."],
            recommendation: "Budgeted model sweeps should be resumable and should pin provider/model versions in receipts.",
        }),
        capability({
            id: "memory_session_mining",
            level: 5,
            title: "Memory and session mining",
            status: hasMemoryCommand(text) ? "met" : hasFile(signals, /^docs\/agent-os\/memory\.md$/) || textIncludes(text, /\b(memory|session mining|prior failures)\b/i) ? "partial" : "missing",
            evidence: [
                ...matchingFiles(signals, /^docs\/agent-os\/memory\.md$/).slice(0, 3),
                ...matchingTextEvidence(text, [/memory search/i, /session mining/i, /prior failures/i, /\.proofloop\/memory/i]).slice(0, 8),
            ],
            missing: ["Mine prior failures into rules, recalls, and regression prompts instead of relying on stale transcripts."],
            recommendation: "Memory is mature when it changes future gates or setup instructions, not when it is just stored.",
        }),
        capability({
            id: "governance_approval",
            level: 5,
            title: "Governance and approval ledger",
            status: textIncludes(text, /\b(approval|authorized|consent|protectedPaths|immutable|domain permission|manual-review)\b/i) ? "met" : "missing",
            evidence: [
                ...matchingTextEvidence(text, [/approval/i, /authorized/i, /consent/i, /protectedPaths/i, /immutable/i, /manual-review/i]).slice(0, 8),
            ],
            missing: ["Record who approved protected changes, live target testing, and scorer substitutions."],
            recommendation: "The proof loop can propose changes; promotion should require an outside approval signal.",
        }),
    ];
}
function capability(args) {
    const evidence = unique(args.evidence).filter(Boolean);
    return {
        ...args,
        evidence,
        missing: args.status === "met" ? [] : args.missing,
    };
}
function buildLevelAssessments(capabilities) {
    const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
    return LEVELS.map((level) => {
        const required = level.requiredCapabilityIds.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
        const status = required.length === 0
            ? "met"
            : required.every((entry) => entry.status === "met")
                ? "met"
                : required.some((entry) => entry.status !== "missing")
                    ? "partial"
                    : "missing";
        return { ...level, status };
    });
}
function currentCompletedLevel(levels) {
    let current = 0;
    for (const level of levels.filter((entry) => entry.level > 0).sort((a, b) => a.level - b.level)) {
        if (level.status !== "met")
            break;
        current = level.level;
    }
    return current;
}
function maturityScore(capabilities) {
    const points = capabilities.reduce((sum, capability) => sum + (capability.status === "met" ? 1 : capability.status === "partial" ? 0.5 : 0), 0);
    return Math.round((points / Math.max(1, capabilities.length)) * 100);
}
function buildNextActions(capabilities, currentLevel, targetLevel) {
    const notMet = capabilities
        .filter((capability) => capability.level > currentLevel && capability.level <= targetLevel && capability.status !== "met")
        .sort((a, b) => a.level - b.level || statusRank(b.status) - statusRank(a.status));
    return unique(notMet.map((capability) => capability.recommendation)).slice(0, 8);
}
function renderMaturityMarkdown(report) {
    const levels = report.levelAssessments
        .map((level) => `| ${level.level} | ${level.title} | ${level.status} | ${level.description} |`)
        .join("\n");
    const capabilities = report.capabilities
        .map((capability) => `| ${capability.level} | ${capability.title} | ${capability.status} | ${capability.evidence.slice(0, 3).join("<br>") || "none"} |`)
        .join("\n");
    const missing = report.missing.length > 0 ? report.missing.map((item) => `- ${item}`).join("\n") : "- None for the selected target level.";
    const actions = report.nextActions.length > 0 ? report.nextActions.map((item) => `- ${item}`).join("\n") : "- No next action for the selected target level.";
    return [
        "# ProofLoop Agent-Era Maturity Report",
        "",
        `Generated: ${report.generatedAt}`,
        `Repo: ${report.repoName}`,
        `Root: ${report.root}`,
        "",
        `Current stage: **Level ${report.currentLevel} - ${report.currentStage}**`,
        `Target stage: **Level ${report.targetLevel}**`,
        `Score: **${report.score}/100**`,
        "",
        "## Level Ladder",
        "",
        "| Level | Stage | Status | What it means |",
        "|---:|---|---|---|",
        levels,
        "",
        "## Capability Evidence",
        "",
        "| Level | Capability | Status | Evidence |",
        "|---:|---|---|---|",
        capabilities,
        "",
        "## Missing / Not Done",
        "",
        missing,
        "",
        "## Next Actions",
        "",
        actions,
        "",
        "## Timeline Progression",
        "",
        "```mermaid",
        report.timelineMermaid,
        "```",
        "",
        "## Projection Chart",
        "",
        "```mermaid",
        report.projectionMermaid,
        "```",
        "",
        "Honesty boundary: this report is a deterministic maturity scan. Official benchmark claims still require upstream scorers, official-format artifacts, or an explicitly recorded equivalent judge contract.",
        "",
    ].join("\n");
}
function renderTimelineMermaid() {
    return [
        "flowchart LR",
        "  A[\"Prompt-era demo\"] --> B[\"Deterministic gates\"]",
        "  B --> C[\"Agent docs + proof guardrails\"]",
        "  C --> D[\"Live browser receipts\"]",
        "  D --> E[\"Long-running runner\"]",
        "  E --> F[\"Benchmarks + memory + governance\"]",
        "  A -. \"fake done / hallucinated receipts\" .-> G[\"Need proof gate\"]",
        "  C -. \"unsafe edits / weakened verifier\" .-> H[\"Need protected proof state\"]",
        "  D -. \"UI works locally, fails in prod\" .-> I[\"Need live browser proof\"]",
        "  E -. \"runaway loops / stale context / spend\" .-> J[\"Need budget, resume, trace\"]",
        "  F -. \"proxy score mistaken for official\" .-> K[\"Need scorer boundary\"]",
    ].join("\n");
}
function renderProjectionMermaid(currentLevel, targetLevel) {
    const lines = [
        "xychart-beta",
        "  title \"Agent-era maturity projection\"",
        "  x-axis [\"Now\", \"Next\", \"Target\"]",
        `  y-axis \"Level\" 0 --> 5`,
        `  line [${currentLevel}, ${Math.min(5, currentLevel + 1)}, ${targetLevel}]`,
    ];
    return lines.join("\n");
}
function readRepoSignals(root) {
    const pkg = readPackageJson(root);
    const files = collectRepoFiles(root);
    const scripts = pkg.scripts ?? {};
    const dependencyNames = unique([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const text = collectSearchText(root, files, pkg);
    return {
        root,
        repoName: pkg.name?.trim() || (0, node_path_1.basename)(root),
        files,
        scripts,
        dependencyNames,
        text,
        config: readProofloopConfig(root),
    };
}
function readPackageJson(root) {
    const path = (0, node_path_1.join)(root, "package.json");
    if (!(0, node_fs_1.existsSync)(path))
        return {};
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function readProofloopConfig(root) {
    const path = (0, node_path_1.join)(root, "proofloop.config.json");
    if (!(0, node_fs_1.existsSync)(path))
        return { exists: false, gateChecks: 0, immutable: 0, protectedPaths: 0 };
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        return {
            exists: true,
            gateChecks: Array.isArray(parsed.gate?.checks) ? parsed.gate.checks.length : 0,
            immutable: Array.isArray(parsed.immutable) ? parsed.immutable.length : 0,
            protectedPaths: Array.isArray(parsed.protectedPaths) ? parsed.protectedPaths.length : 0,
        };
    }
    catch {
        return { exists: true, gateChecks: 0, immutable: 0, protectedPaths: 0 };
    }
}
function collectRepoFiles(root) {
    const out = [];
    const skip = new Set([".git", "node_modules", "dist", ".next", "coverage", "build", ".vercel", ".serena"]);
    const visit = (dir, prefix) => {
        if (out.length >= MAX_FILES)
            return;
        let entries;
        try {
            entries = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (out.length >= MAX_FILES)
                return;
            if (skip.has(entry.name))
                continue;
            const abs = (0, node_path_1.join)(dir, entry.name);
            const rel = slash(prefix ? `${prefix}/${entry.name}` : entry.name);
            if (entry.isDirectory()) {
                visit(abs, rel);
            }
            else {
                out.push(rel);
            }
        }
    };
    visit(root, "");
    return out;
}
function collectSearchText(root, files, pkg) {
    const chunks = [JSON.stringify(pkg)];
    const important = files.filter((file) => shouldReadForSignals(file)).slice(0, 260);
    for (const file of important) {
        if (chunks.join("\n").length >= MAX_TEXT_BYTES)
            break;
        const path = (0, node_path_1.join)(root, file);
        try {
            const stat = (0, node_fs_1.statSync)(path);
            if (stat.size > 180_000)
                continue;
            chunks.push(`${file}\n${(0, node_fs_1.readFileSync)(path, "utf8").slice(0, 24_000)}`);
        }
        catch {
            continue;
        }
    }
    return chunks.join("\n").slice(0, MAX_TEXT_BYTES);
}
function shouldReadForSignals(file) {
    if (/^(README|AGENTS|CLAUDE)\.md$/i.test(file))
        return true;
    if (/^docs\/agent-os\/[^/]+\.md$/i.test(file))
        return true;
    if (/^api\/hosted\/[^/]+\.js$/i.test(file))
        return true;
    if (/^src\/[^/]+\.(ts|tsx|js|jsx|mjs)$/i.test(file))
        return true;
    if (/^scripts\/[^/]+\.(mjs|js|ts)$/i.test(file))
        return true;
    if (/^public\/index\.html$/i.test(file))
        return true;
    if (/^tests\/[^/]+\.(ts|tsx|js)$/i.test(file))
        return true;
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file))
        return true;
    if (/proofloop|benchmark|scorer|playwright|cypress|memory|trace|receipt/i.test(file))
        return true;
    return false;
}
function hasScript(signals, pattern) {
    return Object.entries(signals.scripts).some(([name, command]) => pattern.test(`${name} ${command}`));
}
function matchingScripts(signals, pattern) {
    return Object.entries(signals.scripts)
        .filter(([name, command]) => pattern.test(`${name} ${command}`))
        .map(([name, command]) => `script: ${name} -> ${command}`);
}
function hasFile(signals, pattern) {
    return signals.files.some((file) => pattern.test(file));
}
function matchingFiles(signals, pattern) {
    return signals.files.filter((file) => pattern.test(file)).map((file) => `file: ${file}`);
}
function hasAgentDocs(signals) {
    return hasFile(signals, /^(AGENTS\.md|CLAUDE\.md|\.cursor\/rules\/|\.windsurf\/rules\/|docs\/agent-os\/README\.md)/);
}
function hasUiContracts(signals) {
    return textIncludes(signals.text, /data-testid|data-proofloop|expected-tool-use/i);
}
function hasOfficialScorer(signals) {
    return hasScript(signals, /\b(official|scorer|score)\b/i) && textIncludes(`${Object.keys(signals.scripts).join("\n")}\n${signals.text}`, /\b(official|upstream|scorer|judge contract)\b/i);
}
function hasBenchmarkEvidence(signals) {
    return hasScript(signals, /\b(benchmark|bench|score|scorer)\b/i)
        || textIncludes(signals.text, /SpreadsheetBench|WorkstreamBench|FinAuditing|FinMR|Finch|BankerToolBench|benchmark proxy/i);
}
function hasMemoryCommand(text) {
    return /\bproofloop\s+memory\s+search\b/i.test(text) || /\bmemory\s+search\b/i.test(text) && /\bcli|command|npx proofloop\b/i.test(text);
}
function matchingTextEvidence(text, patterns) {
    const evidence = [];
    for (const pattern of patterns) {
        if (pattern.test(text))
            evidence.push(`text: ${pattern.source.replace(/\\/g, "")}`);
    }
    return evidence;
}
function textIncludes(text, pattern) {
    return pattern.test(text);
}
function normalizeTargetLevel(value) {
    if (value === undefined || !Number.isFinite(value))
        return 5;
    return Math.max(0, Math.min(5, Math.trunc(value)));
}
function statusRank(status) {
    return status === "met" ? 2 : status === "partial" ? 1 : 0;
}
function withoutMarkdown(report) {
    const { reportMarkdown: _reportMarkdown, ...rest } = report;
    return rest;
}
function unique(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}
function slash(value) {
    return value.replace(/\\/g, "/");
}
