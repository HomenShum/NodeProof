"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProofloopTarget = runProofloopTarget;
exports.writeProofloopTargetPlan = writeProofloopTargetPlan;
exports.buildProofloopTargetPlan = buildProofloopTargetPlan;
exports.classifyBenchmarkFamilies = classifyBenchmarkFamilies;
exports.formatProofloopTargetPlanDense = formatProofloopTargetPlanDense;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const layeredPlan_1 = require("./layeredPlan");
const DEFAULT_TARGET_PLAN_PATH = (0, node_path_1.join)(".proofloop", "target", "latest-target-plan.json");
const DEFAULT_TARGET_RUNNER_PLAN_PATH = (0, node_path_1.join)(".proofloop", "runner", "target.plan.json");
const MAX_TEXT_BYTES = 96 * 1024;
const MAX_FILE_SIGNALS = 350;
const DEFAULT_TIMEOUT_MS = 10_000;
const BENCHMARK_RULES = [
    {
        id: "bankertoolbench",
        title: "BankerToolBench / accounting workflow proxy",
        keywords: ["accounting", "reconcile", "journal", "trial balance", "ar aging", "ap aging", "ledger", "invoice", "banker", "finance"],
        scriptPattern: /\b(banker|accounting|ledger|trial[-:]?balance|journal|reconcile)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use for accounting-agent workflows such as reconciliation, journal entries, trial balance, AR/AP aging, and banker-style finance tasks."],
    },
    {
        id: "spreadsheetbench-v1",
        title: "SpreadsheetBench V1",
        keywords: ["spreadsheet", "workbook", "worksheet", "excel", "xlsx", "formula", "cell", "csv", "pivot", "chart"],
        scriptPattern: /\b(spreadsheet|spreadsheetbench|excel|xlsx|workbook|sheet)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use when the app edits, reasons over, or scores spreadsheet workbooks; official V1 score still needs the official scorer path."],
    },
    {
        id: "spreadsheetbench-v2",
        title: "SpreadsheetBench V2 bundle/scorer path",
        keywords: ["spreadsheet", "workbook", "worksheet", "excel", "xlsx", "formula", "cell", "bundle", "scorer", "pivot", "chart"],
        scriptPattern: /\b(spreadsheetbench[-:]?v2|spreadsheet[-:]?v2|excel|xlsx|workbook|sheet)\b/i,
        strongAt: 5,
        mediumAt: 3,
        notes: ["Use for bundle-oriented spreadsheet tasks; official output requires the upstream V2 bundle and scorer contract."],
    },
    {
        id: "finauditing",
        title: "FinAuditing / FinMR official-format predictions",
        keywords: ["audit", "auditing", "financial statement", "materiality", "workpaper", "finmr", "controls", "compliance", "assertion", "evidence"],
        scriptPattern: /\b(finaudit|finauditing|finmr|audit|workpaper|controls)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use when the app evaluates audit workpapers, controls, financial statements, or FinMR-style judged answers."],
    },
    {
        id: "finch",
        title: "Finch official-output artifacts",
        keywords: ["finch", "filing", "10-k", "10-q", "sec", "portfolio", "valuation", "earnings", "market", "financial analysis"],
        scriptPattern: /\b(finch|filing|sec|valuation|earnings|portfolio)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use for finance QA, filings, portfolio, and market-analysis tasks; official judging credentials or an equivalent judge contract must be recorded."],
    },
    {
        id: "workstreambench",
        title: "WorkstreamBench upstream bundle/scorer/rubric",
        keywords: ["workflow", "workstream", "slack", "gmail", "calendar", "notion", "ticket", "crm", "support", "email", "task"],
        scriptPattern: /\b(workstream|slack|gmail|calendar|notion|ticket|crm|support|email)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use when the app performs cross-tool workflow work such as email, calendar, support, CRM, Slack, or Notion tasks."],
    },
    {
        id: "proximitty-underwriting",
        title: "Underwriting memo / Proximitty-style workflow",
        keywords: ["underwriting", "underwriter", "loan", "insurance", "risk", "borrower", "policy", "premium", "claim", "decision memo"],
        scriptPattern: /\b(proximitty|underwriting|underwriter|loan|insurance|risk|borrower)\b/i,
        strongAt: 3,
        mediumAt: 2,
        notes: ["Use for intake -> extraction -> rules -> decision-memo underwriting workflows on synthetic or permissioned data."],
    },
    {
        id: "research-copilot",
        title: "Research copilot / banker research proxy",
        keywords: ["research", "company", "comps", "market", "diligence", "analyst", "memo", "rogo", "ask david", "jpm", "banker"],
        scriptPattern: /\b(research|company|comps|diligence|rogo|david|banker|analyst)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use for company research, comps, diligence, and banker-copilot task families."],
    },
    {
        id: "nodeagent-memory-ingestion",
        title: "NodeAgent document ingestion and memory receipts",
        keywords: ["memory", "ingestion", "document", "chunk", "embedding", "knowledge graph", "vector", "rag", "retrieval", "session"],
        scriptPattern: /\b(memory|ingestion|document|embedding|knowledge[-:]?graph|rag|retrieval)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use for document -> memory pipelines. ProofLoop can verify app-produced receipts but does not own the ingestion worker internals."],
    },
    {
        id: "live-browser-smoke",
        title: "Live browser responsiveness and UI proof",
        keywords: ["browser", "playwright", "cypress", "puppeteer", "selenium", "react", "next", "vite", "button", "form", "login", "signup", "room", "chat"],
        scriptPattern: /\b(browser|playwright|cypress|puppeteer|selenium|webdriver|e2e|ui|smoke)\b/i,
        strongAt: 4,
        mediumAt: 2,
        notes: ["Use to certify that the real user path renders, clicks, submits, and stays responsive. This is separate from headless benchmark capability tests."],
    },
];
async function runProofloopTarget(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    try {
        const result = await writeProofloopTargetPlan(options);
        if (options.json) {
            log(JSON.stringify({ ...result.plan, planPath: result.planPath, runnerPlanPath: result.runnerPlanPath ?? null }, null, 2));
        }
        else {
            log(formatProofloopTargetPlanDense(result.plan, result.planPath, result.runnerPlanPath));
        }
        return result;
    }
    catch (error) {
        logError(`proofloop target: ${error instanceof Error ? error.message : String(error)}`);
        return {
            exitCode: 2,
            plan: emptyTargetPlan((0, node_path_1.resolve)(options.root), options.url),
            planPath: (0, node_path_1.resolve)(options.root, options.outPath ?? DEFAULT_TARGET_PLAN_PATH),
        };
    }
}
async function writeProofloopTargetPlan(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const codebaseSignals = (0, node_fs_1.existsSync)((0, node_path_1.join)(root, "package.json")) ? readCodebaseSignals(root) : undefined;
    const urlSignals = options.url ? await readUrlSignals(options.url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS) : undefined;
    if (!codebaseSignals && !urlSignals)
        throw new Error("expected --url <url> or a repo with package.json");
    const plan = buildProofloopTargetPlan({
        root,
        codebaseSignals,
        urlSignals,
    });
    const planPath = (0, node_path_1.resolve)(root, options.outPath ?? DEFAULT_TARGET_PLAN_PATH);
    writeJson(planPath, plan);
    let runnerPlanPath;
    if (options.writeRunnerPlan && plan.runnerPlan) {
        runnerPlanPath = (0, node_path_1.resolve)(root, DEFAULT_TARGET_RUNNER_PLAN_PATH);
        writeJson(runnerPlanPath, plan.runnerPlan);
    }
    return { exitCode: 0, plan, planPath, ...(runnerPlanPath ? { runnerPlanPath } : {}) };
}
function buildProofloopTargetPlan(args) {
    const root = (0, node_path_1.resolve)(args.root);
    const scripts = args.codebaseSignals?.scripts ?? {};
    const mergedText = [
        args.codebaseSignals?.text ?? "",
        args.urlSignals?.text ?? "",
    ].join("\n");
    const mergedEvidence = [
        ...(args.codebaseSignals?.evidence ?? []),
        ...(args.urlSignals?.evidence ?? []),
    ];
    const recommendations = classifyBenchmarkFamilies(mergedText, scripts, args.urlSignals !== undefined, mergedEvidence);
    const runnerPlan = buildTargetRunnerPlan(root, recommendations, scripts, args.urlSignals?.url);
    const configuredAdapters = recommendations.filter((entry) => entry.adapterStatus === "configured").length;
    const blockedFamilies = recommendations.filter((entry) => entry.adapterStatus !== "configured").length;
    const blocked = buildBlockedList(recommendations, args.urlSignals, scripts);
    const targetKind = args.urlSignals && args.codebaseSignals ? "hybrid" : args.urlSignals ? "live-url" : "codebase";
    const officialScoreReady = recommendations.length > 0 && recommendations.every((entry) => entry.officialScoreStatus === "configured_command");
    return {
        schema: "proofloop-target-plan-v1",
        generatedAt: args.generatedAt ?? new Date().toISOString(),
        target: {
            kind: targetKind,
            ...(args.codebaseSignals ? { root, packageName: args.codebaseSignals.packageName } : {}),
            ...(args.urlSignals ? { url: args.urlSignals.url } : {}),
            ...(args.urlSignals?.status !== undefined ? { httpStatus: args.urlSignals.status } : {}),
            ...(args.urlSignals?.title ? { title: args.urlSignals.title } : {}),
        },
        summary: {
            recommendedFamilies: recommendations.length,
            configuredAdapters,
            blockedFamilies,
            liveUrlReachable: args.urlSignals ? args.urlSignals.ok : null,
            officialScoreReady,
            runnerPlanReady: runnerPlan.tasks.length > 0,
        },
        recommendations,
        ...(runnerPlan.tasks.length > 0 ? { runnerPlan } : {}),
        blocked,
        nextActions: buildNextActions(recommendations, args.urlSignals, runnerPlan.tasks.length > 0),
        honesty: "This is benchmark-family targeting and runnable-plan discovery, not an official benchmark score. Official claims require the configured upstream scorer or an explicitly recorded equivalent judge contract.",
    };
}
function classifyBenchmarkFamilies(textInput, scripts = {}, hasLiveUrl = false, seedEvidence = []) {
    const text = normalizeText(textInput);
    const scriptText = Object.entries(scripts).map(([name, command]) => `${name} ${command}`).join("\n");
    const haystack = `${text}\n${normalizeText(scriptText)}`;
    const recommendations = [];
    for (const rule of BENCHMARK_RULES) {
        const keywordEvidence = matchedKeywordEvidence(rule.keywords, haystack);
        const configuredScripts = matchingScripts(rule, scripts);
        const shouldIncludeLiveSmoke = rule.id === "live-browser-smoke" && hasLiveUrl;
        if (keywordEvidence.length === 0 && configuredScripts.length === 0 && !shouldIncludeLiveSmoke)
            continue;
        const evidence = uniqueEvidence([
            ...keywordEvidence,
            ...configuredScripts.map((script) => `configured script: ${script.name} -> ${script.command}`),
            ...seedEvidence.filter((entry) => rule.keywords.some((keyword) => normalizeText(entry).includes(normalizeText(keyword)))).slice(0, 4),
            ...(shouldIncludeLiveSmoke ? ["live URL supplied"] : []),
        ]);
        const signalCount = keywordEvidence.length + configuredScripts.length * 2 + (shouldIncludeLiveSmoke ? 1 : 0);
        const fit = signalCount >= rule.strongAt ? "strong" : signalCount >= rule.mediumAt ? "medium" : "weak";
        const adapterStatus = configuredScripts.length > 0 ? "configured" : "candidate";
        recommendations.push({
            id: rule.id,
            title: rule.title,
            fit,
            confidence: confidenceFor(signalCount, rule.strongAt),
            adapterStatus,
            officialScoreStatus: configuredScripts.length > 0 ? "configured_command" : rule.id === "live-browser-smoke" ? "not_bundled" : "requires_adapter",
            evidence: evidence.slice(0, 10),
            configuredScripts,
            notes: rule.notes,
        });
    }
    if (recommendations.length === 0) {
        recommendations.push({
            id: "custom-harness-required",
            title: "Custom app-specific harness required",
            fit: "weak",
            confidence: 0.15,
            adapterStatus: "blocked",
            officialScoreStatus: "requires_adapter",
            evidence: ["No known benchmark-family keywords or scripts matched."],
            configuredScripts: [],
            notes: ["Add a deterministic proofloop.config.json gate, a Playwright user flow, or a benchmark adapter script before claiming benchmark coverage."],
        });
    }
    return recommendations.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}
function formatProofloopTargetPlanDense(plan, planPath, runnerPlanPath) {
    const lines = [
        "proofloop-target-plan",
        `target=${plan.target.kind}${plan.target.url ? ` url=${plan.target.url}` : ""}${plan.target.packageName ? ` package=${plan.target.packageName}` : ""}`,
        `families=${plan.summary.recommendedFamilies} configured=${plan.summary.configuredAdapters} blocked=${plan.summary.blockedFamilies} liveReachable=${String(plan.summary.liveUrlReachable)}`,
        `officialScoreReady=${String(plan.summary.officialScoreReady)} runnerPlanReady=${String(plan.summary.runnerPlanReady)}`,
        `plan=${planPath}`,
        ...(runnerPlanPath ? [`runnerPlan=${runnerPlanPath}`] : []),
    ];
    for (const rec of plan.recommendations.slice(0, 8)) {
        lines.push(`family=${rec.id} fit=${rec.fit} confidence=${rec.confidence.toFixed(2)} adapter=${rec.adapterStatus} scorer=${rec.officialScoreStatus}`);
        for (const evidence of rec.evidence.slice(0, 3))
            lines.push(`  evidence=${evidence}`);
    }
    for (const blocked of plan.blocked.slice(0, 8))
        lines.push(`blocked=${blocked}`);
    for (const action of plan.nextActions.slice(0, 6))
        lines.push(`next=${action}`);
    return `${lines.join("\n")}\n`;
}
function readCodebaseSignals(root) {
    const pkg = readPackageJson(root);
    const packageText = JSON.stringify({
        name: pkg.name,
        description: pkg.description,
        keywords: pkg.keywords,
        scripts: pkg.scripts,
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {}),
    });
    const readmeText = readFirstExisting(root, ["README.md", "readme.md", "docs/README.md"]);
    const fileSignals = collectFileSignals(root);
    const scripts = pkg.scripts ?? {};
    return {
        root,
        ...(pkg.name ? { packageName: pkg.name } : {}),
        scripts,
        text: `${packageText}\n${readmeText}\n${fileSignals.join("\n")}`.slice(0, MAX_TEXT_BYTES),
        evidence: [
            ...(pkg.name ? [`package name: ${pkg.name}`] : []),
            ...Object.keys(scripts).map((name) => `script: ${name} -> ${scripts[name]}`).slice(0, 40),
            ...fileSignals.slice(0, 80).map((file) => `file: ${file}`),
        ],
    };
}
async function readUrlSignals(rawUrl, timeoutMs) {
    const url = normalizeUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: { "user-agent": "proofloop-target-planner/0.3" },
        });
        const html = await response.text();
        const title = extractTitle(html);
        const text = htmlToText(html).slice(0, MAX_TEXT_BYTES);
        return {
            url,
            ok: response.ok,
            status: response.status,
            ...(title ? { title } : {}),
            text,
            evidence: [
                `url status: ${response.status}`,
                ...(title ? [`title: ${title}`] : []),
                ...extractUiEvidence(html),
            ],
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
function buildTargetRunnerPlan(root, recommendations, scripts, url) {
    const tasks = [];
    if ((0, node_fs_1.existsSync)((0, node_path_1.join)(root, "package.json"))) {
        tasks.push(...(0, layeredPlan_1.buildProofloopLayeredRunnerPlan)(root, { goal: "proofloop target verification" }).tasks);
    }
    if (url) {
        tasks.push({
            id: "target.url-reachable",
            command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`fetch(${JSON.stringify(url)}).then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})`)}`,
            estimatedCostUsd: 0,
            timeoutMs: 30_000,
        });
    }
    for (const recommendation of recommendations) {
        for (const script of recommendation.configuredScripts) {
            addTask(tasks, {
                id: `benchmark.${toTaskId(recommendation.id)}.${toTaskId(script.name)}`,
                command: `npm run ${quoteNpmScriptName(script.name)}`,
                env: {
                    PROOFLOOP_BENCHMARK_FAMILY: recommendation.id,
                    PROOFLOOP_TARGET_OFFICIAL_SCORE_STATUS: recommendation.officialScoreStatus,
                },
                estimatedCostUsd: 0,
                timeoutMs: 60 * 60_000,
            });
        }
    }
    for (const [name, command] of Object.entries(scripts)) {
        if (!/\b(official|scorer|score|benchmark)\b/i.test(`${name} ${command}`))
            continue;
        const alreadyIncluded = tasks.some((task) => task.command === `npm run ${quoteNpmScriptName(name)}`);
        if (alreadyIncluded)
            continue;
        addTask(tasks, {
            id: `benchmark.custom.${toTaskId(name)}`,
            command: `npm run ${quoteNpmScriptName(name)}`,
            estimatedCostUsd: 0,
            timeoutMs: 60 * 60_000,
        });
    }
    return { schema: "proofloop-runner-plan-v1", tasks };
}
function buildBlockedList(recommendations, urlSignals, scripts) {
    const blocked = [];
    const candidateFamilies = recommendations.filter((entry) => entry.adapterStatus !== "configured" && entry.id !== "custom-harness-required");
    if (candidateFamilies.length > 0) {
        blocked.push(`No runnable benchmark adapter scripts found for: ${candidateFamilies.map((entry) => entry.id).join(", ")}.`);
    }
    if (urlSignals && !hasBrowserScript(scripts)) {
        blocked.push("Live URL was fetched, but no Playwright/Cypress/browser script is configured to click through the real user flow.");
    }
    if (recommendations.some((entry) => entry.officialScoreStatus !== "configured_command" && entry.id !== "live-browser-smoke")) {
        blocked.push("Official benchmark scoring is not ready until the upstream scorer, artifact format, or explicitly recorded equivalent judge contract is configured.");
    }
    if (recommendations.some((entry) => entry.id === "custom-harness-required")) {
        blocked.push("No known benchmark family matched; add an app-specific harness before claiming benchmark coverage.");
    }
    return blocked;
}
function buildNextActions(recommendations, urlSignals, runnerPlanReady) {
    const actions = [];
    if (recommendations.some((entry) => entry.adapterStatus === "configured")) {
        actions.push("Run `npx proofloop runner run --plan .proofloop/runner/target.plan.json --budget-usd <cap>` after reviewing generated tasks.");
    }
    if (recommendations.some((entry) => entry.adapterStatus !== "configured")) {
        actions.push("Add benchmark adapter scripts for candidate families, then rerun `npx proofloop target --write-runner-plan`.");
    }
    if (urlSignals) {
        actions.push("Add a deterministic browser user-flow script for the live URL; keep it separate from headless benchmark capability tasks.");
    }
    if (!runnerPlanReady) {
        actions.push("Create `proofloop.config.json` checks or package scripts so ProofLoop has commands it can actually supervise.");
    }
    actions.push("Keep product-path proof, proxy benchmark proof, and official scorer output in separate receipts.");
    return actions;
}
function matchingScripts(rule, scripts) {
    return Object.entries(scripts)
        .filter(([name, command]) => rule.scriptPattern.test(`${name} ${command}`))
        .map(([name, command]) => ({ name, command }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
function matchedKeywordEvidence(keywords, haystack) {
    return keywords
        .filter((keyword) => haystack.includes(normalizeText(keyword)))
        .map((keyword) => `keyword: ${keyword}`);
}
function confidenceFor(signalCount, strongAt) {
    return Math.max(0.1, Math.min(0.99, signalCount / (strongAt + 2)));
}
function readPackageJson(root) {
    return JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));
}
function readFirstExisting(root, candidates) {
    for (const candidate of candidates) {
        const path = (0, node_path_1.join)(root, candidate);
        if ((0, node_fs_1.existsSync)(path))
            return (0, node_fs_1.readFileSync)(path, "utf8").slice(0, MAX_TEXT_BYTES);
    }
    return "";
}
function collectFileSignals(root) {
    const out = [];
    const skip = new Set([".git", ".proofloop", ".vercel", "dist", "node_modules", "coverage", ".next", "build"]);
    const visit = (dir, prefix) => {
        if (out.length >= MAX_FILE_SIGNALS)
            return;
        let entries;
        try {
            entries = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= MAX_FILE_SIGNALS)
                return;
            if (entry.name.startsWith(".") && skip.has(entry.name))
                continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!skip.has(entry.name))
                    visit((0, node_path_1.join)(dir, entry.name), rel);
            }
            else {
                out.push(rel);
            }
        }
    };
    visit(root, "");
    return out;
}
function extractTitle(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeHtml(match[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 160) : undefined;
}
function extractUiEvidence(html) {
    const evidence = [];
    const buttons = (html.match(/<button\b/gi) ?? []).length;
    const forms = (html.match(/<form\b/gi) ?? []).length;
    const inputs = (html.match(/<input\b/gi) ?? []).length;
    const links = (html.match(/<a\b/gi) ?? []).length;
    if (buttons)
        evidence.push(`html buttons: ${buttons}`);
    if (forms)
        evidence.push(`html forms: ${forms}`);
    if (inputs)
        evidence.push(`html inputs: ${inputs}`);
    if (links)
        evidence.push(`html links: ${links}`);
    return evidence;
}
function htmlToText(html) {
    return decodeHtml(html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function decodeHtml(value) {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function normalizeUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!/^https?:\/\//i.test(trimmed))
        throw new Error("--url must start with http:// or https://");
    return new URL(trimmed).toString();
}
function normalizeText(value) {
    return value.toLowerCase().replace(/[_-]+/g, " ");
}
function uniqueEvidence(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}
function hasBrowserScript(scripts) {
    return Object.entries(scripts).some(([name, command]) => /\b(browser|playwright|cypress|puppeteer|selenium|webdriver|e2e)\b/i.test(`${name} ${command}`));
}
function addTask(tasks, task) {
    const existing = new Set(tasks.map((entry) => entry.id));
    if (!existing.has(task.id)) {
        tasks.push(task);
        return;
    }
    let suffix = 2;
    let id = `${task.id}-${suffix}`;
    while (existing.has(id)) {
        suffix += 1;
        id = `${task.id}-${suffix}`;
    }
    tasks.push({ ...task, id });
}
function toTaskId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}
function quoteNpmScriptName(name) {
    return /^[A-Za-z0-9:_-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function emptyTargetPlan(root, url) {
    return {
        schema: "proofloop-target-plan-v1",
        generatedAt: new Date().toISOString(),
        target: { kind: url ? "live-url" : "codebase", root, ...(url ? { url } : {}) },
        summary: {
            recommendedFamilies: 0,
            configuredAdapters: 0,
            blockedFamilies: 0,
            liveUrlReachable: null,
            officialScoreReady: false,
            runnerPlanReady: false,
        },
        recommendations: [],
        blocked: ["target planning failed before a receipt could be produced"],
        nextActions: ["Fix the CLI input or local repo setup, then rerun `npx proofloop target`."],
        honesty: "No benchmark proof was produced.",
    };
}
