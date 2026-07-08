"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROOFLOOP_PROVIDER_IDS = void 0;
exports.setupProofloopProvider = setupProofloopProvider;
exports.setupProofloopProviders = setupProofloopProviders;
exports.proofloopProviderReceiptPath = proofloopProviderReceiptPath;
exports.parseProofloopProviderId = parseProofloopProviderId;
const node_fs_1 = require("node:fs");
const node_net_1 = require("node:net");
const node_path_1 = require("node:path");
exports.PROOFLOOP_PROVIDER_IDS = ["butterbase", "neo4j", "rocketride", "daytona", "cognee", "nebius"];
async function setupProofloopProvider(providerId, options = {}) {
    const env = options.env ?? process.env;
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const required = requiredEnvForProvider(providerId, env);
    const optional = optionalEnvForProvider(providerId);
    const present = [...required, ...optional].filter((name) => Boolean(env[name]?.trim()));
    const missing = required.filter((name) => !env[name]?.trim());
    const checks = [];
    if (missing.length > 0) {
        checks.push({
            id: "required-env",
            status: "needs_credentials",
            detail: `Missing required env: ${missing.join(", ")}`,
        });
    }
    else {
        checks.push({ id: "required-env", status: "ready", detail: `Required env present: ${required.join(", ") || "none"}` });
        checks.push(await liveProviderCheck(providerId, env, fetchImpl, timeoutMs));
    }
    const status = aggregateStatus(checks);
    const receipt = {
        schema: "proofloop-provider-setup-v1",
        providerId,
        generatedAt,
        status,
        env: { required, optional, present, missing },
        checks,
        nextCommands: nextCommands(providerId, status),
    };
    writeProviderReceipt(options.root ?? process.cwd(), receipt);
    return receipt;
}
async function setupProofloopProviders(providerIds = [...exports.PROOFLOOP_PROVIDER_IDS], options = {}) {
    const receipts = [];
    for (const providerId of providerIds)
        receipts.push(await setupProofloopProvider(providerId, options));
    return receipts;
}
function proofloopProviderReceiptPath(root, providerId) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), ".proofloop", "setup", "providers", `${providerId}.json`);
}
function parseProofloopProviderId(value) {
    if (exports.PROOFLOOP_PROVIDER_IDS.includes(value))
        return value;
    throw new Error(`Unknown provider ${value}. Expected one of: ${exports.PROOFLOOP_PROVIDER_IDS.join(", ")}`);
}
function requiredEnvForProvider(providerId, env) {
    if (providerId === "butterbase")
        return ["BUTTERBASE_API_URL"];
    if (providerId === "neo4j")
        return ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"];
    if (providerId === "rocketride")
        return ["ROCKETRIDE_API_KEY", env.ROCKETRIDE_WORKFLOW_URL ? "ROCKETRIDE_WORKFLOW_URL" : "ROCKETRIDE_API_URL"];
    if (providerId === "daytona")
        return ["DAYTONA_API_KEY"];
    if (providerId === "cognee")
        return [env.COGNEE_API_URL ? "COGNEE_API_URL" : "COGNEE_LOCAL_PATH"];
    return ["NEBIUS_API_KEY"];
}
function optionalEnvForProvider(providerId) {
    if (providerId === "butterbase")
        return ["BUTTERBASE_APP_ID", "BUTTERBASE_API_KEY", "BUTTERBASE_CALLBACK_KEY"];
    if (providerId === "neo4j")
        return ["NEO4J_DATABASE"];
    if (providerId === "rocketride")
        return ["ROCKETRIDE_WORKFLOW_URL", "ROCKETRIDE_API_URL"];
    if (providerId === "daytona")
        return ["DAYTONA_API_URL"];
    if (providerId === "cognee")
        return ["COGNEE_API_URL", "COGNEE_LOCAL_PATH", "COGNEE_PYTHON"];
    return ["NEBIUS_BASE_URL", "NEBIUS_CONTROL_BASE_URL", "NEBIUS_ENDPOINTS_URL"];
}
async function liveProviderCheck(providerId, env, fetchImpl, timeoutMs) {
    try {
        if (providerId === "neo4j")
            return await neo4jTcpCheck(env, timeoutMs);
        if (providerId === "cognee" && env.COGNEE_LOCAL_PATH && !env.COGNEE_API_URL) {
            return {
                id: "local-provider",
                status: (0, node_fs_1.existsSync)(env.COGNEE_LOCAL_PATH) ? "ready" : "blocked",
                detail: (0, node_fs_1.existsSync)(env.COGNEE_LOCAL_PATH) ? `Cognee local path exists: ${env.COGNEE_LOCAL_PATH}` : `Cognee local path not found: ${env.COGNEE_LOCAL_PATH}`,
            };
        }
        const url = providerHealthUrl(providerId, env);
        if (!url)
            return { id: "live-provider", status: "blocked", detail: `${providerId} has no health URL configured.` };
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "GET",
            headers: providerHeaders(providerId, env),
        }, timeoutMs);
        const reachable = response.status < 500;
        return {
            id: "live-provider",
            status: reachable ? "ready" : "blocked",
            detail: `${providerId} health endpoint ${redactUrl(url, env)} returned HTTP ${response.status}.`,
        };
    }
    catch (error) {
        return {
            id: "live-provider",
            status: "blocked",
            detail: `${providerId} live check failed: ${sanitizeProviderError(error, env)}`,
        };
    }
}
function providerHealthUrl(providerId, env) {
    if (providerId === "butterbase")
        return trimTrailingSlash(env.BUTTERBASE_API_URL ?? "");
    if (providerId === "rocketride")
        return env.ROCKETRIDE_WORKFLOW_URL?.trim() || trimTrailingSlash(env.ROCKETRIDE_API_URL ?? "");
    if (providerId === "daytona")
        return trimTrailingSlash(env.DAYTONA_API_URL ?? "https://api.daytona.io");
    if (providerId === "cognee")
        return trimTrailingSlash(env.COGNEE_API_URL ?? "");
    if (providerId === "nebius")
        return `${trimTrailingSlash(env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1")}/models`;
    return undefined;
}
function providerHeaders(providerId, env) {
    const headers = {};
    if (providerId === "butterbase" && env.BUTTERBASE_API_KEY)
        headers.Authorization = `Bearer ${env.BUTTERBASE_API_KEY}`;
    if (providerId === "rocketride" && env.ROCKETRIDE_API_KEY)
        headers.Authorization = `Bearer ${env.ROCKETRIDE_API_KEY}`;
    if (providerId === "daytona" && env.DAYTONA_API_KEY)
        headers.Authorization = `Bearer ${env.DAYTONA_API_KEY}`;
    if (providerId === "nebius" && env.NEBIUS_API_KEY)
        headers.Authorization = `Bearer ${env.NEBIUS_API_KEY}`;
    return headers;
}
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function neo4jTcpCheck(env, timeoutMs) {
    const uri = env.NEO4J_URI ?? "";
    const parsed = parseHostPort(uri);
    if (!parsed)
        return { id: "live-provider", status: "blocked", detail: `NEO4J_URI is not a supported bolt/neo4j URI: ${uri}` };
    return await new Promise((resolveCheck) => {
        const socket = new node_net_1.Socket();
        const finish = (status, detail) => {
            socket.destroy();
            resolveCheck({ id: "live-provider", status, detail });
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish("ready", `Neo4j TCP endpoint reachable at ${parsed.host}:${parsed.port}.`));
        socket.once("timeout", () => finish("blocked", `Neo4j TCP endpoint timed out at ${parsed.host}:${parsed.port}.`));
        socket.once("error", (error) => finish("blocked", `Neo4j TCP endpoint failed at ${parsed.host}:${parsed.port}: ${error.message}`));
        socket.connect(parsed.port, parsed.host);
    });
}
function parseHostPort(uri) {
    try {
        const url = new URL(uri);
        if (!["bolt:", "neo4j:", "neo4j+s:", "bolt+s:"].includes(url.protocol))
            return null;
        return { host: url.hostname, port: Number(url.port || 7687) };
    }
    catch {
        return null;
    }
}
function aggregateStatus(checks) {
    if (checks.some((check) => check.status === "blocked"))
        return "blocked";
    if (checks.some((check) => check.status === "needs_credentials"))
        return "needs_credentials";
    return "ready";
}
function nextCommands(providerId, status) {
    const retry = `npx proofloop providers setup ${providerId}`;
    if (status === "ready")
        return [retry, "npx proofloop gate"];
    return [retry, `Add the missing ${providerId} credentials to your local environment, then rerun the setup command.`];
}
function writeProviderReceipt(root, receipt) {
    const path = proofloopProviderReceiptPath(root, receipt.providerId);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
function sanitizeProviderError(error, env) {
    let message = error instanceof Error ? error.message : String(error);
    for (const value of Object.values(env)) {
        if (value && value.length >= 8)
            message = message.split(value).join("[redacted]");
    }
    return message;
}
function redactUrl(url, env) {
    let value = url;
    for (const secret of Object.values(env)) {
        if (secret && secret.length >= 8)
            value = value.split(secret).join("[redacted]");
    }
    return value;
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
