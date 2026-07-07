"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductivityProofPack = buildProductivityProofPack;
exports.writeProductivityProofPack = writeProductivityProofPack;
exports.formatProductivityDense = formatProductivityDense;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const gate_1 = require("./gate");
const BLS_SOURCE_URL = "https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm";
const DORA_SOURCE_URL = "https://dora.dev/guides/dora-metrics-four-keys/";
const PRODUCTIVITY_CAVEAT = "ProofLoop reports wage-equivalent verified capacity, not literal wages generated. No proof means no productivity claim.";
const HOURS_PER_WORK_YEAR = 2080;
const CHART_SCHEMA = "https://vega.github.io/schema/vega-lite/v5.json";
const SOURCE_CONFIDENCE = {
    measured: 0.95,
    historical: 0.85,
    benchmark: 0.75,
    research: 0.65,
    estimated: 0.45,
};
function buildProductivityProofPack(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const runId = options.runId ?? `productivity-${compactTimestamp(generatedAt)}`;
    const workflowId = options.workflowId ?? readPackageName(root) ?? (0, node_path_1.basename)(root);
    const baselineSource = options.baselineSource ?? "estimated";
    const confidence = clamp01(options.confidence ?? SOURCE_CONFIDENCE[baselineSource]);
    const gate = readGateState(root);
    const proofVerdict = proofVerdictFromGate(gate);
    const deterministicGateAdded = options.deterministicGateAdded ?? Boolean(gate && gate.status !== "no_gate");
    const liveBrowserVerified = options.liveBrowserVerified ?? false;
    const regressionAdded = options.regressionAdded ?? false;
    const rates = defaultWageRates(generatedAt);
    const baselineEvidence = baselineRows({ root, runId, baselineSource, confidence });
    const actualEvidence = actualRows({ root, runId, confidence });
    const proofEvidence = proofRows({ root, gate, confidence });
    const valueEvidence = valueRows({ root, runId, confidence });
    const baseline = {
        source: baselineSource,
        devHours: nonNegative(options.devHours),
        qaHours: nonNegative(options.qaHours),
        researchHours: nonNegative(options.researchHours),
        designerHours: nonNegative(options.designerHours),
        confidence,
        evidence: baselineEvidence,
    };
    const humanReviewHours = nonNegative(options.humanReviewHours);
    const actual = {
        humanReviewHours,
        modelCostUsd: money(options.modelCostUsd),
        browserCostUsd: money(options.browserCostUsd),
        ciCostUsd: money(options.ciCostUsd),
        evidence: actualEvidence,
    };
    const gross = roleValueUsd(baseline.devHours, rates, "software_developer")
        + roleValueUsd(baseline.qaHours, rates, "qa_tester")
        + roleValueUsd(baseline.researchHours, rates, "researcher")
        + roleValueUsd(baseline.designerHours, rates, "designer");
    const humanReviewCost = humanReviewHours * hourlyRate(rates, "software_developer");
    const totalCost = humanReviewCost + actual.modelCostUsd + actual.browserCostUsd + actual.ciCostUsd;
    const net = Math.max(0, gross - totalCost);
    const proofMultiplier = proofVerdict === "pass" ? 1 : proofVerdict === "partial" ? 0.5 : 0;
    const confidenceAdjusted = net * confidence * proofMultiplier;
    const costPerPassedProof = proofVerdict === "pass" ? totalCost : null;
    const ledger = {
        schema: "proofloop-productivity-ledger-v1",
        runId,
        workflowId,
        generatedAt,
        baseline,
        wageRates: rates,
        actual,
        proof: {
            verdict: proofVerdict,
            regressionAdded,
            liveBrowserVerified,
            deterministicGateAdded,
            evidence: proofEvidence,
        },
        value: {
            grossWageEquivalentUsd: dollars(gross),
            humanReviewCostUsd: dollars(humanReviewCost),
            totalRunCostUsd: dollars(totalCost),
            netWageEquivalentUsd: dollars(net),
            confidenceAdjustedUsd: dollars(confidenceAdjusted),
            costPerPassedProofUsd: costPerPassedProof === null ? null : dollars(costPerPassedProof),
            evidence: valueEvidence,
        },
        dimensions: {
            timeSavedHours: hours(Math.max(0, baseline.devHours + baseline.qaHours + baseline.researchHours + baseline.designerHours - humanReviewHours)),
            verifiedTaskCompletion: proofVerdict === "pass" ? 1 : proofVerdict === "partial" ? 0.5 : 0,
            regressionProtection: regressionAdded ? 1 : deterministicGateAdded ? 0.5 : 0,
            costPerPassedProofUsd: costPerPassedProof === null ? null : dollars(costPerPassedProof),
            deliveryReliability: reliabilityScore({ proofVerdict, liveBrowserVerified, deterministicGateAdded, regressionAdded }),
        },
        caveat: PRODUCTIVITY_CAVEAT,
    };
    const wageResearch = {
        schema: "proofloop-wage-research-v1",
        generatedAt,
        rates,
        notes: [
            "Default wage rates are a business-friendly translation layer, not a customer-specific ROI guarantee.",
            "Override defaults with measured or historical team data when available.",
        ],
    };
    const baselineEstimates = {
        schema: "proofloop-baseline-estimates-v1",
        runId,
        workflowId,
        source: baselineSource,
        confidence,
        rows: baselineEvidence,
    };
    const charts = buildProductivityCharts(ledger);
    return {
        ledger,
        wageResearch,
        baselineEstimates,
        scorecardMarkdown: renderProductivityScorecard(ledger),
        charts,
    };
}
function writeProductivityProofPack(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const pack = buildProductivityProofPack(options);
    const runDir = (0, node_path_1.resolve)(root, options.outDir ?? (0, node_path_1.join)(".proofloop", "runs", pack.ledger.runId));
    const chartsDir = (0, node_path_1.join)(runDir, "charts");
    (0, node_fs_1.mkdirSync)(chartsDir, { recursive: true });
    const files = {
        ledger: (0, node_path_1.join)(runDir, "productivity-ledger.json"),
        wageResearch: (0, node_path_1.join)(runDir, "wage-research.json"),
        baselineEstimates: (0, node_path_1.join)(runDir, "baseline-estimates.json"),
        scorecard: (0, node_path_1.join)(runDir, "productivity-scorecard.md"),
        charts: [],
    };
    writeJson(files.ledger, pack.ledger);
    writeJson(files.wageResearch, pack.wageResearch);
    writeJson(files.baselineEstimates, pack.baselineEstimates);
    (0, node_fs_1.writeFileSync)(files.scorecard, pack.scorecardMarkdown, "utf8");
    for (const [name, chart] of Object.entries(pack.charts)) {
        const path = (0, node_path_1.join)(chartsDir, name);
        writeJson(path, chart);
        files.charts.push(path);
    }
    return { pack, runDir, files };
}
function formatProductivityDense(pack, runDir) {
    const ledger = pack.ledger;
    return [
        "proofloop-productivity-pack",
        `runId=${ledger.runId}`,
        `workflowId=${ledger.workflowId}`,
        `baseline=${ledger.baseline.source} confidence=${ledger.baseline.confidence}`,
        `proof=${ledger.proof.verdict} deterministicGate=${ledger.proof.deterministicGateAdded} liveBrowser=${ledger.proof.liveBrowserVerified} regression=${ledger.proof.regressionAdded}`,
        `grossUsd=${ledger.value.grossWageEquivalentUsd}`,
        `totalCostUsd=${ledger.value.totalRunCostUsd}`,
        `netUsd=${ledger.value.netWageEquivalentUsd}`,
        `confidenceAdjustedUsd=${ledger.value.confidenceAdjustedUsd}`,
        `costPerPassedProofUsd=${ledger.value.costPerPassedProofUsd ?? "n/a"}`,
        `timeSavedHours=${ledger.dimensions.timeSavedHours}`,
        ...(runDir ? [`runDir=${runDir}`] : []),
        `caveat=${ledger.caveat}`,
        "",
    ].join("\n");
}
function defaultWageRates(generatedAt) {
    return [
        wageRate({
            role: "software_developer",
            annualUsd: 133_080,
            sourceField: "May 2024 median annual wage for software developers",
            generatedAt,
        }),
        wageRate({
            role: "qa_tester",
            annualUsd: 102_610,
            sourceField: "May 2024 median annual wage for software quality assurance analysts and testers",
            generatedAt,
        }),
    ];
}
function wageRate(args) {
    const hourlyUsd = dollars(args.annualUsd / HOURS_PER_WORK_YEAR);
    return {
        role: args.role,
        hourlyUsd,
        sourceName: "U.S. Bureau of Labor Statistics Occupational Outlook Handbook",
        sourceUrl: BLS_SOURCE_URL,
        geography: "United States national median",
        evidence: {
            sourceFile: "src/productivity.ts",
            sourceField: args.sourceField,
            confidence: 0.7,
            method: "annual wage divided by 2,080 work hours",
            citation: BLS_SOURCE_URL,
        },
    };
}
function baselineRows(args) {
    return [
        {
            sourceFile: "cli-options",
            sourceField: `baselineSource=${args.baselineSource}; runId=${args.runId}; root=${args.root}`,
            confidence: args.confidence,
            method: "operator-supplied or default baseline hours",
            citation: "Use measured team history when available; otherwise this row is an estimate and must stay labeled.",
        },
    ];
}
function actualRows(args) {
    return [
        {
            sourceFile: "cli-options",
            sourceField: `actual cost inputs for ${args.runId} under ${args.root}`,
            confidence: args.confidence,
            method: "operator-supplied human review, model, browser, and CI costs",
            citation: "No external citation; values must come from run logs or operator accounting.",
        },
    ];
}
function proofRows(args) {
    const gatePath = (0, gate_1.gateStatePath)(args.root);
    if (!args.gate) {
        return [{
                sourceFile: gatePath,
                sourceField: "missing",
                confidence: 0,
                method: "fail-closed proof lookup",
                citation: "ProofLoop gate receipt missing; no proof claim allowed.",
            }];
    }
    return [{
            sourceFile: gatePath,
            sourceField: `status=${args.gate.status}; source=${args.gate.source}; checks=${args.gate.checks.length}`,
            confidence: args.gate.status === "passed" ? args.confidence : 0,
            method: "read persisted ProofLoop gate receipt",
            citation: "Local deterministic gate receipt.",
        }];
}
function valueRows(args) {
    return [
        {
            sourceFile: "src/productivity.ts",
            sourceField: `gross wage-equivalent minus human/model/browser/CI cost for ${args.runId} in ${args.root}`,
            confidence: args.confidence,
            method: "deterministic arithmetic with proof multiplier; failed or blocked proof produces zero confidence-adjusted value",
            citation: `${BLS_SOURCE_URL}; ${DORA_SOURCE_URL}`,
        },
    ];
}
function buildProductivityCharts(ledger) {
    return {
        "wage-equivalent-value.vl.json": wageEquivalentChart(ledger),
        "cost-per-passed-proof.vl.json": costPerPassedProofChart(ledger),
        "time-to-proof-waterfall.vl.json": timeToProofChart(ledger),
        "regression-reuse-value.vl.json": regressionReuseChart(ledger),
        "delivery-impact.vl.json": deliveryImpactChart(ledger),
    };
}
function wageEquivalentChart(ledger) {
    const rows = [
        roleChartRow(ledger, "software_developer", ledger.baseline.devHours),
        roleChartRow(ledger, "qa_tester", ledger.baseline.qaHours),
        roleChartRow(ledger, "researcher", ledger.baseline.researchHours),
        roleChartRow(ledger, "designer", ledger.baseline.designerHours),
    ].filter((row) => Number(row.valueUsd) > 0);
    return barChart("Wage-equivalent capacity produced", rows, "role", "valueUsd");
}
function costPerPassedProofChart(ledger) {
    return barChart("Cost per passed proof", [{
            route: "current-run",
            verdict: ledger.proof.verdict,
            valueUsd: ledger.value.costPerPassedProofUsd ?? ledger.value.totalRunCostUsd,
            sourceFile: "productivity-ledger.json",
            sourceField: "value.costPerPassedProofUsd",
            confidence: ledger.baseline.confidence,
            method: "total run cost if proof passed; otherwise total cost spent without a passed proof",
            citation: "Local productivity ledger.",
        }], "route", "valueUsd", "verdict");
}
function timeToProofChart(ledger) {
    const baselineHours = ledger.baseline.devHours + ledger.baseline.qaHours + ledger.baseline.researchHours + ledger.baseline.designerHours;
    return barChart("Time-to-proof waterfall", [
        chartRow("Manual expected", baselineHours, "baseline.devHours+qaHours+researchHours+designerHours", "baseline estimate"),
        chartRow("ProofLoop human review", ledger.actual.humanReviewHours, "actual.humanReviewHours", "actual run accounting"),
        chartRow("Verified saved", ledger.dimensions.timeSavedHours, "dimensions.timeSavedHours", "computed difference"),
    ], "stage", "hours");
}
function regressionReuseChart(ledger) {
    return barChart("Regression reuse value", [
        chartRow("First live proof", ledger.actual.modelCostUsd + ledger.actual.browserCostUsd + ledger.actual.ciCostUsd, "actual model/browser/CI cost", "current run cost"),
        chartRow("Future deterministic check", ledger.proof.regressionAdded ? ledger.actual.ciCostUsd : ledger.actual.ciCostUsd + ledger.actual.browserCostUsd, "proof.regressionAdded", "regression reuse estimate"),
    ], "stage", "valueUsd");
}
function deliveryImpactChart(ledger) {
    return barChart("DORA-adjacent delivery impact", [
        chartRow("Verified completion", ledger.dimensions.verifiedTaskCompletion, "dimensions.verifiedTaskCompletion", "ProofLoop proof receipt"),
        chartRow("Regression protection", ledger.dimensions.regressionProtection, "dimensions.regressionProtection", "deterministic gate and regression signal"),
        chartRow("Delivery reliability", ledger.dimensions.deliveryReliability, "dimensions.deliveryReliability", "DORA-adjacent composite"),
    ], "dimension", "score");
}
function barChart(title, values, xField, yField, colorField) {
    return {
        $schema: CHART_SCHEMA,
        title,
        data: { values },
        mark: { type: "bar", tooltip: true },
        encoding: {
            x: { field: xField, type: "nominal", sort: null },
            y: { field: yField, type: "quantitative" },
            ...(colorField ? { color: { field: colorField, type: "nominal" } } : {}),
            tooltip: [
                { field: xField, type: "nominal" },
                { field: yField, type: "quantitative" },
                { field: "sourceFile", type: "nominal" },
                { field: "sourceField", type: "nominal" },
                { field: "confidence", type: "quantitative" },
                { field: "method", type: "nominal" },
                { field: "citation", type: "nominal" },
            ],
        },
    };
}
function roleChartRow(ledger, role, hoursValue) {
    const rate = ledger.wageRates.find((entry) => entry.role === role);
    return {
        role,
        hours: hours(hoursValue),
        valueUsd: rate ? dollars(hoursValue * rate.hourlyUsd) : 0,
        sourceFile: rate?.evidence.sourceFile ?? "productivity-ledger.json",
        sourceField: rate?.evidence.sourceField ?? `baseline.${role}Hours without configured wage source`,
        confidence: rate ? ledger.baseline.confidence : 0,
        method: rate ? "baseline hours multiplied by cited hourly wage" : "no cited wage source configured",
        citation: rate?.sourceUrl ?? "missing citation; value intentionally zero",
    };
}
function chartRow(label, value, sourceField, method) {
    return {
        stage: label,
        dimension: label,
        hours: hours(value),
        valueUsd: dollars(value),
        score: dollars(value),
        sourceFile: "productivity-ledger.json",
        sourceField,
        confidence: 0.7,
        method,
        citation: "Local productivity ledger.",
    };
}
function renderProductivityScorecard(ledger) {
    const rows = [
        ["Proof verdict", ledger.proof.verdict],
        ["Baseline source", `${ledger.baseline.source} (${ledger.baseline.confidence})`],
        ["Gross wage-equivalent value", `$${ledger.value.grossWageEquivalentUsd}`],
        ["Total run cost", `$${ledger.value.totalRunCostUsd}`],
        ["Net wage-equivalent value", `$${ledger.value.netWageEquivalentUsd}`],
        ["Confidence-adjusted value", `$${ledger.value.confidenceAdjustedUsd}`],
        ["Cost per passed proof", ledger.value.costPerPassedProofUsd === null ? "n/a" : `$${ledger.value.costPerPassedProofUsd}`],
        ["Time saved", `${ledger.dimensions.timeSavedHours} hours`],
    ];
    return [
        "# ProofLoop Productivity Scorecard",
        "",
        `Run: ${ledger.runId}`,
        `Workflow: ${ledger.workflowId}`,
        `Generated: ${ledger.generatedAt}`,
        "",
        "| Metric | Value |",
        "|---|---|",
        ...rows.map(([name, value]) => `| ${name} | ${value} |`),
        "",
        "## Evidence",
        "",
        ...ledger.baseline.evidence.map(formatEvidence),
        ...ledger.actual.evidence.map(formatEvidence),
        ...ledger.proof.evidence.map(formatEvidence),
        ...ledger.value.evidence.map(formatEvidence),
        "",
        `Caveat: ${ledger.caveat}`,
        "",
    ].join("\n");
}
function formatEvidence(row) {
    return `- ${row.sourceFile} :: ${row.sourceField} (${row.method}; confidence ${row.confidence}; citation: ${row.citation})`;
}
function proofVerdictFromGate(gate) {
    if (!gate)
        return "blocked";
    if (gate.status === "passed")
        return "pass";
    if (gate.status === "failed")
        return "fail";
    return "blocked";
}
function roleValueUsd(hoursValue, rates, role) {
    return hoursValue * hourlyRate(rates, role);
}
function hourlyRate(rates, role) {
    return rates.find((rate) => rate.role === role)?.hourlyUsd ?? 0;
}
function reliabilityScore(args) {
    const proof = args.proofVerdict === "pass" ? 0.45 : args.proofVerdict === "partial" ? 0.2 : 0;
    const live = args.liveBrowserVerified ? 0.2 : 0;
    const gate = args.deterministicGateAdded ? 0.2 : 0;
    const regression = args.regressionAdded ? 0.15 : 0;
    return dollars(proof + live + gate + regression);
}
function readPackageName(root) {
    const path = (0, node_path_1.join)(root, "package.json");
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
    }
    catch {
        return undefined;
    }
}
function readGateState(root) {
    const path = (0, gate_1.gateStatePath)(root);
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
        return parsed && parsed.schema === "proofloop-gate-v1" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function writeJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function compactTimestamp(value) {
    return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/[^0-9TZ]/g, "");
}
function nonNegative(value) {
    return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : hours(value);
}
function money(value) {
    return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : dollars(value);
}
function dollars(value) {
    return Math.round(value * 100) / 100;
}
function hours(value) {
    return Math.round(value * 100) / 100;
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, dollars(value)));
}
