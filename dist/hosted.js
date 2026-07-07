"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOSTED_SCHEMA_VERSION = void 0;
exports.createHostedRunRequest = createHostedRunRequest;
exports.validateHostedRunRequest = validateHostedRunRequest;
exports.verifyHostedDomainPermission = verifyHostedDomainPermission;
exports.buildHostedSuccessContract = buildHostedSuccessContract;
exports.composeHostedBenchmarkProxyTasks = composeHostedBenchmarkProxyTasks;
exports.buildHostedRunBundle = buildHostedRunBundle;
exports.buildHostedRunBundleFromRequest = buildHostedRunBundleFromRequest;
exports.readHostedBundleReference = readHostedBundleReference;
exports.buildHostedWorkerPlan = buildHostedWorkerPlan;
exports.writeHostedWorkerPlan = writeHostedWorkerPlan;
exports.writeHostedRunBundle = writeHostedRunBundle;
exports.renderHostedRunbook = renderHostedRunbook;
exports.renderHostedDashboardHtml = renderHostedDashboardHtml;
exports.readHostedRunBundle = readHostedRunBundle;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const targetPlan_1 = require("./targetPlan");
exports.HOSTED_SCHEMA_VERSION = "proofloop-hosted-run-v1";
const DEFAULT_ALLOWLIST = ["noderoom.live", "www.noderoom.live", "proofloop.live", "www.proofloop.live"];
function createHostedRunRequest(options) {
    const targetUrl = normalizeHttpUrl(options.targetUrl);
    const budget = finiteNonNegative(options.budgetUsd) ? options.budgetUsd : 0;
    return {
        schema: exports.HOSTED_SCHEMA_VERSION,
        createdAt: options.generatedAt ?? new Date().toISOString(),
        targetUrl,
        appType: options.appType ?? "agent-app",
        intendedAudience: (options.intendedAudience ?? "product team evaluating an agent app").trim(),
        primaryGoal: (options.primaryGoal ?? "Prove the intended user can complete the core agent workflow in production.").trim(),
        authMode: options.authMode ?? "none",
        authNotes: (options.authNotes ?? "").trim(),
        modelBudgetUsd: Number(budget.toFixed(2)),
        requestedBenchmarkFamilies: normalizeFamilies(options.families ?? []),
        consent: {
            accepted: options.consentAccepted === true,
            ownsOrAuthorized: options.ownsOrAuthorized === true,
            allowBrowserAutomation: options.allowBrowserAutomation === true,
            allowRecording: options.allowRecording === true,
            ...(options.contactEmail ? { contactEmail: options.contactEmail.trim() } : {}),
        },
        visibility: options.visibility ?? "private",
    };
}
function validateHostedRunRequest(request, options = {}) {
    const blockers = [];
    const warnings = [];
    const url = new URL(request.targetUrl);
    if (url.protocol !== "https:" && !isLocalhost(url.hostname))
        blockers.push("target_url_must_be_https_for_hosted_runs");
    if (isPrivateNetworkHost(url.hostname) && !isLocalhost(url.hostname))
        blockers.push("private_network_targets_are_not_allowed_from_hosted_runs");
    if (!request.consent.accepted)
        blockers.push("consent_checkbox_required");
    if (!request.consent.ownsOrAuthorized)
        blockers.push("ownership_or_authorization_required");
    if (!request.consent.allowBrowserAutomation)
        blockers.push("browser_automation_consent_required");
    if (!request.consent.allowRecording)
        blockers.push("artifact_recording_consent_required");
    if (!finiteNonNegative(request.modelBudgetUsd))
        blockers.push("model_budget_must_be_non_negative");
    if (request.modelBudgetUsd > 100)
        warnings.push("budget_above_default_guardrail_requires_manual_review");
    if (containsSecretLikeText(request.authNotes))
        warnings.push("auth_notes_may_contain_secret_material_do_not_store_raw_passwords");
    const permission = verifyHostedDomainPermission(request, options);
    if (permission.status !== "verified")
        blockers.push(...permission.blockers);
    return { ok: blockers.length === 0, blockers, warnings };
}
function verifyHostedDomainPermission(request, options = {}) {
    const host = new URL(request.targetUrl).hostname.toLowerCase();
    const allowlistedHosts = new Set([...DEFAULT_ALLOWLIST, ...(options.allowlistedHosts ?? [])].map((item) => item.toLowerCase()));
    const token = hostedDomainToken(host);
    if (allowlistedHosts.has(host) || isLocalhost(host)) {
        return {
            status: "verified",
            host,
            method: "allowlist",
            token,
            evidence: [`${host} is allowlisted for dogfood or owned-product runs.`],
            blockers: [],
        };
    }
    return {
        status: "pending",
        host,
        method: "well-known-token",
        token,
        evidence: [
            `Serve https://${host}/.well-known/proofloop-domain-verification.txt containing ${token}.`,
            `Or publish DNS TXT _proofloop.${host}=${token}.`,
        ],
        blockers: ["domain_permission_verification_pending"],
    };
}
function buildHostedSuccessContract(request) {
    const host = new URL(request.targetUrl).hostname.toLowerCase();
    const base = contractPreset(request.appType);
    const nodeRoomDogfood = host === "noderoom.live" || host === "www.noderoom.live";
    return {
        schema: "proofloop-hosted-success-contract-v1",
        contractId: `contract-${safeId(host)}-${safeId(request.appType)}`,
        targetUrl: request.targetUrl,
        appType: request.appType,
        success: {
            minimumAdaptiveSteps: 3,
            forbiddenUrlIncludes: ["mode=memory"],
            visibleTextAny: unique([...(nodeRoomDogfood ? ["live convex"] : []), ...base.visibleTextAny]),
            visibleTestIdAny: unique([...(nodeRoomDogfood ? ["chat-composer", "work-surface"] : []), ...base.visibleTestIdAny]),
            urlIncludesAny: unique([...(nodeRoomDogfood ? ["?room="] : []), ...base.urlIncludesAny]),
            requireNoBrowserProblems: true,
            requireVisualProof: true,
        },
        benchmarkProxyTasks: composeHostedBenchmarkProxyTasks(request),
    };
}
function composeHostedBenchmarkProxyTasks(request) {
    const families = new Set([
        "live-browser-smoke",
        ...familiesForAppType(request.appType),
        ...request.requestedBenchmarkFamilies,
    ].map((item) => item.trim()).filter(Boolean));
    return Array.from(families).sort().flatMap((family) => tasksForFamily(family, request));
}
function buildHostedRunBundle(options) {
    const request = createHostedRunRequest(options);
    return buildHostedRunBundleFromRequest(request, { allowlistedHosts: options.allowlistedHosts });
}
function buildHostedRunBundleFromRequest(request, options = {}) {
    const permission = verifyHostedDomainPermission(request, { allowlistedHosts: options.allowlistedHosts });
    const contract = buildHostedSuccessContract(request);
    const syntheticText = [
        request.targetUrl,
        request.appType,
        request.intendedAudience,
        request.primaryGoal,
        contract.benchmarkProxyTasks.map((task) => `${task.family} ${task.title} ${task.prompt}`).join("\n"),
    ].join("\n");
    const targetPlan = (0, targetPlan_1.buildProofloopTargetPlan)({
        root: process.cwd(),
        urlSignals: {
            url: request.targetUrl,
            ok: true,
            text: syntheticText,
            evidence: [`hosted intake appType: ${request.appType}`, `primary goal: ${request.primaryGoal}`],
        },
        generatedAt: request.createdAt,
    });
    const runId = hostedRunId(request);
    const artifactRoot = `.proofloop/hosted/runs/${runId}`;
    const bundle = {
        schema: "proofloop-hosted-run-bundle-v1",
        runId,
        generatedAt: request.createdAt,
        request,
        permission,
        contract,
        recommendations: targetPlan.recommendations,
        runner: {
            mode: "external-managed-worker",
            reason: "The website enqueues and displays state. Long-running Playwright, model calls, retries, videos, and trace capture run in a managed worker outside normal Vercel request limits.",
            queuePath: `.proofloop/hosted/queue/${runId}.json`,
            artifactRoot,
            resumeCommand: `npx proofloop hosted run --request .proofloop/hosted/queue/${runId}.json`,
            nodeRoomDogfoodCommand: `npm run proofloop -- run agentic-qa-live`,
        },
        artifactContract: {
            receipt: `${artifactRoot}/live-receipt.json`,
            screenshot: `${artifactRoot}/visual-proof.png`,
            video: `${artifactRoot}/video.webm`,
            trace: `${artifactRoot}/adaptive-trace.json`,
            scorecard: `${artifactRoot}/scorecard.md`,
            dashboard: `${artifactRoot}/dashboard.html`,
        },
    };
    return { ...bundle, dashboardHtml: renderHostedDashboardHtml(bundle) };
}
function readHostedBundleReference(path, options = {}) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const absolutePath = (0, node_path_1.resolve)(root, path);
    const parsed = JSON.parse((0, node_fs_1.readFileSync)(absolutePath, "utf8"));
    if (parsed.schema === "proofloop-hosted-run-bundle-v1")
        return readHostedRunBundle(absolutePath);
    if (parsed.bundlePath)
        return readHostedRunBundle((0, node_path_1.resolve)(root, parsed.bundlePath));
    if (parsed.requestPath) {
        const request = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, parsed.requestPath), "utf8"));
        return buildHostedRunBundleFromRequest(request);
    }
    if (parsed.schema === exports.HOSTED_SCHEMA_VERSION)
        return buildHostedRunBundleFromRequest(parsed);
    throw new Error(`Unsupported hosted run reference: ${path}`);
}
function buildHostedWorkerPlan(bundle, options = {}) {
    const validation = validateHostedRunRequest(bundle.request, {
        allowlistedHosts: bundle.permission.status === "verified" ? [bundle.permission.host] : [],
    });
    const ready = validation.ok;
    const nodeRoomDogfood = /^(www\.)?noderoom\.live$/i.test(new URL(bundle.request.targetUrl).hostname);
    return {
        schema: "proofloop-hosted-worker-plan-v1",
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        runId: bundle.runId,
        status: ready ? "ready_for_managed_worker" : "blocked",
        blockers: validation.blockers,
        warnings: validation.warnings,
        targetUrl: bundle.request.targetUrl,
        appType: bundle.request.appType,
        permission: bundle.permission,
        successContract: bundle.contract.success,
        benchmarkProxyTasks: bundle.contract.benchmarkProxyTasks,
        artifactContract: bundle.artifactContract,
        worker: {
            mode: "external-managed-worker",
            requiredCapabilities: [
                "long-running Playwright browser context with video and screenshot capture",
                "model router with per-task cost ledger and budget kill switch",
                "artifact storage for receipt, screenshot, video, trace, scorecard, and dashboard",
                "domain-permission guard before any navigation or benchmark probing",
                "auth/session handoff that stores no raw passwords in browser-side intake",
            ],
            queuePath: bundle.runner.queuePath,
            artifactRoot: bundle.runner.artifactRoot,
            ...(nodeRoomDogfood ? { nodeRoomDogfoodCommand: bundle.runner.nodeRoomDogfoodCommand } : {}),
        },
        nextActions: ready
            ? [
                "Start the managed worker outside the Vercel request lifecycle.",
                "Open the target with Playwright using the selected auth/session mode.",
                "Run the generic success contract before benchmark proxy tasks.",
                "Execute benchmark proxy tasks under the model budget and append per-model cost/performance receipts.",
                "Publish private dashboard artifacts by default; public replay links require explicit visibility=public.",
            ]
            : [
                "Resolve every blocker before starting browser automation.",
                ...bundle.permission.evidence,
            ],
    };
}
function writeHostedWorkerPlan(options) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const bundle = readHostedBundleReference(options.requestFile, { root });
    const plan = buildHostedWorkerPlan(bundle, { generatedAt: options.generatedAt });
    const file = writeJson((0, node_path_1.resolve)(root, options.outFile ?? (0, node_path_1.join)(bundle.runner.artifactRoot, "worker-plan.json")), plan);
    return { bundle, plan, file };
}
function writeHostedRunBundle(options) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const bundle = buildHostedRunBundle(options);
    const outDir = (0, node_path_1.resolve)(root, options.outDir ?? (0, node_path_1.join)(".proofloop", "hosted", "requests", bundle.runId));
    const files = [
        writeJson((0, node_path_1.join)(outDir, "request.json"), bundle.request),
        writeJson((0, node_path_1.join)(outDir, "domain-permission.json"), bundle.permission),
        writeJson((0, node_path_1.join)(outDir, "success-contract.json"), bundle.contract),
        writeJson((0, node_path_1.join)(outDir, "run-bundle.json"), { ...bundle, dashboardHtml: undefined }),
        writeText((0, node_path_1.join)(outDir, "dashboard.html"), bundle.dashboardHtml),
        writeText((0, node_path_1.join)(outDir, "runbook.md"), renderHostedRunbook(bundle)),
    ];
    const queuePath = (0, node_path_1.resolve)(root, bundle.runner.queuePath);
    files.push(writeJson(queuePath, { runId: bundle.runId, requestPath: relativeLike(root, (0, node_path_1.join)(outDir, "request.json")), bundlePath: relativeLike(root, (0, node_path_1.join)(outDir, "run-bundle.json")) }));
    return { bundle, files };
}
function renderHostedRunbook(bundle) {
    return [
        `# ProofLoop Hosted Run ${bundle.runId}`,
        "",
        `Target: ${bundle.request.targetUrl}`,
        `App type: ${bundle.request.appType}`,
        `Permission: ${bundle.permission.status}`,
        `Budget: $${bundle.request.modelBudgetUsd.toFixed(2)}`,
        "",
        "## Runner Boundary",
        "",
        bundle.runner.reason,
        "",
        "## Resume",
        "",
        `- ${bundle.runner.resumeCommand}`,
        `- Dogfood on NodeRoom: ${bundle.runner.nodeRoomDogfoodCommand}`,
        "",
        "## Benchmark Proxy Tasks",
        "",
        ...bundle.contract.benchmarkProxyTasks.map((task) => `- ${task.family}/${task.id}: ${task.title}`),
        "",
        "## Artifacts",
        "",
        ...Object.entries(bundle.artifactContract).map(([key, value]) => `- ${key}: \`${value}\``),
        "",
    ].join("\n");
}
function renderHostedDashboardHtml(bundle) {
    const tasks = bundle.contract.benchmarkProxyTasks
        .map((task) => `<tr><td><code>${escapeHtml(task.family)}</code></td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.officialBoundary)}</td></tr>`)
        .join("");
    const gates = [
        ["domain permission", bundle.permission.status],
        ["consent", bundle.request.consent.accepted ? "accepted" : "blocked"],
        ["browser automation", bundle.request.consent.allowBrowserAutomation ? "accepted" : "blocked"],
        ["recording", bundle.request.consent.allowRecording ? "accepted" : "blocked"],
    ];
    return [
        "<!doctype html>",
        "<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        `<title>ProofLoop Hosted Run ${escapeHtml(bundle.runId)}</title>`,
        "<style>body{margin:0;background:#0b0b0d;color:#f2f1ed;font-family:Inter,system-ui,sans-serif}.wrap{max-width:980px;margin:0 auto;padding:32px 22px}code{background:#17181b;border:1px solid rgba(255,255,255,.12);border-radius:5px;padding:.1rem .35rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.card{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:16px;background:#131417}table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border-bottom:1px solid rgba(255,255,255,.1);padding:10px;text-align:left}.ok{color:#8fd694}.warn{color:#e5b778}a{color:#e59579}</style>",
        "</head><body><main class=\"wrap\">",
        "<p><a href=\"/\">Proof Loop</a></p>",
        `<h1>${escapeHtml(bundle.request.appType)} proof run</h1>`,
        `<p>Target: <code>${escapeHtml(bundle.request.targetUrl)}</code></p>`,
        "<section class=\"grid\">",
        ...gates.map(([label, value]) => `<div class=\"card\"><strong>${escapeHtml(label)}</strong><br><span class=\"${value === "accepted" || value === "verified" ? "ok" : "warn"}\">${escapeHtml(value)}</span></div>`),
        `<div class=\"card\"><strong>budget</strong><br>$${bundle.request.modelBudgetUsd.toFixed(2)}</div>`,
        `<div class=\"card\"><strong>worker</strong><br>${escapeHtml(bundle.runner.mode)}</div>`,
        "</section>",
        "<h2>Benchmark proxy tasks</h2>",
        `<table><thead><tr><th>Family</th><th>Task</th><th>Boundary</th></tr></thead><tbody>${tasks}</tbody></table>`,
        "<h2>Artifacts</h2>",
        `<pre>${escapeHtml(JSON.stringify(bundle.artifactContract, null, 2))}</pre>`,
        "</main></body></html>",
    ].join("");
}
function contractPreset(appType) {
    if (appType === "chat-agent")
        return { visibleTextAny: ["response", "message", "assistant"], visibleTestIdAny: ["chat-composer", "message-composer"], urlIncludesAny: [] };
    if (appType === "workflow-agent")
        return { visibleTextAny: ["complete", "done", "task", "workflow"], visibleTestIdAny: ["run-status", "task-result"], urlIncludesAny: [] };
    if (appType === "spreadsheet-agent")
        return { visibleTextAny: ["sheet", "cell", "formula", "workbook"], visibleTestIdAny: ["sheet-grid", "workbook"], urlIncludesAny: [] };
    if (appType === "research-copilot")
        return { visibleTextAny: ["source", "citation", "research", "memo"], visibleTestIdAny: ["citation", "source-panel"], urlIncludesAny: [] };
    if (appType === "underwriting-agent")
        return { visibleTextAny: ["risk", "memo", "decision", "underwriting"], visibleTestIdAny: ["decision-memo", "risk-panel"], urlIncludesAny: [] };
    if (appType === "accounting-agent")
        return { visibleTextAny: ["ledger", "trial balance", "reconciliation", "journal"], visibleTestIdAny: ["ledger", "sheet-grid"], urlIncludesAny: [] };
    if (appType === "document-memory")
        return { visibleTextAny: ["document", "memory", "chunk", "source"], visibleTestIdAny: ["upload", "source-panel"], urlIncludesAny: [] };
    return { visibleTextAny: ["complete", "done", "result"], visibleTestIdAny: ["chat-composer", "run-status", "result"], urlIncludesAny: [] };
}
function familiesForAppType(appType) {
    if (appType === "accounting-agent")
        return ["bankertoolbench", "spreadsheetbench-v1"];
    if (appType === "spreadsheet-agent")
        return ["spreadsheetbench-v1", "spreadsheetbench-v2"];
    if (appType === "research-copilot")
        return ["research-copilot", "finch"];
    if (appType === "underwriting-agent")
        return ["proximitty-underwriting"];
    if (appType === "workflow-agent")
        return ["workstreambench"];
    if (appType === "document-memory")
        return ["nodeagent-memory-ingestion"];
    if (appType === "chat-agent")
        return ["live-browser-smoke", "workstreambench"];
    return ["live-browser-smoke"];
}
function tasksForFamily(family, request) {
    const audience = request.intendedAudience;
    const boundary = family === "live-browser-smoke" || family === "research-copilot" || family === "proximitty-underwriting" || family === "nodeagent-memory-ingestion"
        ? "proxy_product_path"
        : "official_scorer_required";
    const make = (id, title, prompt, successSignal) => ({
        id,
        family,
        title,
        audience,
        prompt,
        successSignal,
        officialBoundary: boundary,
    });
    if (family === "bankertoolbench") {
        return [
            make("ledger-reconcile", "Reconcile ledger evidence", "Upload or enter accounting evidence, ask the agent to reconcile mismatches, and verify cited differences.", "reconciled totals, exception list, and visible evidence"),
            make("journal-entry", "Prepare journal entry", "Ask the app to draft a journal entry from a transaction scenario and expose approval/evidence state.", "journal lines and review state are visible"),
        ];
    }
    if (family === "spreadsheetbench-v1" || family === "spreadsheetbench-v2") {
        return [
            make("formula-edit", "Spreadsheet formula edit", "Ask the app to modify a workbook formula or computed table value through the UI.", "changed cell/formula and proof receipt are visible"),
            make("chart-or-format", "Spreadsheet chart/format task", "Ask the app to create or update chart/table formatting, then capture the visual result.", "visual artifact or workbook state is visible"),
        ];
    }
    if (family === "workstreambench") {
        return [make("cross-tool-workflow", "Cross-tool workflow task", "Ask the app to complete a multi-step workflow using its available tools and show status for each step.", "workflow status and final result are visible")];
    }
    if (family === "finch" || family === "research-copilot") {
        return [make("company-research", "Company research with citations", "Ask a company or market research question and require citations or source evidence in the UI.", "answer, sources, and confidence/evidence are visible")];
    }
    if (family === "finauditing") {
        return [make("audit-workpaper", "Audit workpaper review", "Ask the app to inspect a financial assertion and produce a workpaper-style finding.", "assertion, evidence, and finding status are visible")];
    }
    if (family === "proximitty-underwriting") {
        return [make("underwriting-memo", "Underwriting memo", "Run intake to extraction to rules to a decision memo on synthetic or permissioned data.", "decision memo and cited risk factors are visible")];
    }
    if (family === "nodeagent-memory-ingestion") {
        return [make("document-memory-recall", "Document ingestion and recall", "Upload or reference documents, wait for memory processing, then ask a recall question.", "source-grounded answer and ingestion receipt are visible")];
    }
    return [make("first-user-path", "Live first-user path", "Open the production app, complete the primary user path, and capture the visible result.", "URL/state changes and result UI are visible")];
}
function normalizeFamilies(values) {
    return unique(values.flatMap((value) => value.split(",")).map((value) => safeId(value)).filter(Boolean));
}
function normalizeHttpUrl(raw) {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("target URL must start with http:// or https://");
    return url.toString();
}
function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isLocalhost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
function isPrivateNetworkHost(hostname) {
    return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname) || hostname === "localhost";
}
function containsSecretLikeText(value) {
    return /\b(password|secret|api[_ -]?key|token)\b\s*[:=]/i.test(value);
}
function hostedDomainToken(host) {
    return `proofloop-domain-${safeId(host)}-verify`;
}
function hostedRunId(request) {
    const host = safeId(new URL(request.targetUrl).hostname);
    const timestamp = request.createdAt.replace(/[^0-9TZ]/g, "").slice(0, 15);
    return `hosted-${host}-${timestamp}`;
}
function safeId(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function unique(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return path;
}
function writeText(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, value, "utf8");
    return path;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function relativeLike(root, path) {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedPath = path.replace(/\\/g, "/");
    return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;
}
function readHostedRunBundle(path) {
    const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    return { ...parsed, dashboardHtml: parsed.dashboardHtml ?? renderHostedDashboardHtml(parsed) };
}
