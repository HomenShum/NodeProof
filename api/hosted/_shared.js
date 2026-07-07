const dns = require("node:dns").promises;
const { buildHostedRunBundle, validateHostedRunRequest, verifyHostedDomainPermission } = require("../../dist/hosted.js");

const OWNER = process.env.PROOFLOOP_GITHUB_OWNER || "HomenShum";
const REPO = process.env.PROOFLOOP_GITHUB_REPO || "proofloop";
const WORKFLOW = process.env.PROOFLOOP_HOSTED_WORKFLOW || "hosted-proofloop.yml";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) {
        reject(new Error("request_body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json_body"));
      }
    });
    req.on("error", reject);
  });
}

function method(req, res, allowed) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    sendJson(res, 405, { ok: false, error: "method_not_allowed", allowed });
    return false;
  }
  return true;
}

function hostedOptionsFromBody(body) {
  return {
    targetUrl: String(body.targetUrl || body.url || ""),
    appType: body.appType || "agent-app",
    intendedAudience: body.intendedAudience || body.audience,
    primaryGoal: body.primaryGoal || body.goal,
    authMode: body.authMode || (body.authNotes ? "manual-login" : "none"),
    authNotes: body.authNotes || "",
    budgetUsd: Number(body.modelBudgetUsd ?? body.budgetUsd ?? 0),
    families: Array.isArray(body.requestedBenchmarkFamilies)
      ? body.requestedBenchmarkFamilies
      : Array.isArray(body.families)
        ? body.families
        : String(body.families || "").split(",").filter(Boolean),
    consentAccepted: body.consent?.accepted === true || body.consentAccepted === true,
    ownsOrAuthorized: body.consent?.ownsOrAuthorized === true || body.ownsOrAuthorized === true,
    allowBrowserAutomation: body.consent?.allowBrowserAutomation === true || body.allowBrowserAutomation === true,
    allowRecording: body.consent?.allowRecording === true || body.allowRecording === true,
    contactEmail: body.contactEmail || body.email,
    visibility: body.visibility === "public" ? "public" : "private",
  };
}

async function verifiedHostAllowlist(request) {
  const permission = verifyHostedDomainPermission(request);
  if (permission.status === "verified") return { allowlistedHosts: [], permission };
  const host = new URL(request.targetUrl).hostname.toLowerCase();
  const token = permission.token;
  if (await wellKnownHasToken(host, token)) {
    return {
      allowlistedHosts: [host],
      permission: { ...permission, status: "verified", method: "well-known-token", evidence: [`verified https://${host}/.well-known/proofloop-domain-verification.txt`], blockers: [] },
    };
  }
  if (await dnsHasToken(host, token)) {
    return {
      allowlistedHosts: [host],
      permission: { ...permission, status: "verified", method: "dns-token", evidence: [`verified DNS TXT _proofloop.${host}`], blockers: [] },
    };
  }
  return { allowlistedHosts: [], permission };
}

async function wellKnownHasToken(host, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`https://${host}/.well-known/proofloop-domain-verification.txt`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "ProofLoop-Domain-Verification/1.0" },
    });
    if (!response.ok) return false;
    const text = await response.text();
    return text.trim().split(/\s+/).includes(token);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function dnsHasToken(host, token) {
  try {
    const records = await dns.resolveTxt(`_proofloop.${host}`);
    return records.flat().some((entry) => entry.trim() === token);
  } catch {
    return false;
  }
}

async function dispatchHostedWorkflow(bundle) {
  const token = process.env.PROOFLOOP_GITHUB_TOKEN;
  if (!token) {
    return { ok: false, status: 503, error: "runner_dispatch_not_configured" };
  }
  const body = {
    ref: process.env.PROOFLOOP_GITHUB_REF || "main",
    inputs: {
      run_id: bundle.runId,
      request_json: JSON.stringify(bundle.request),
    },
  };
  const response = await githubFetch(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.status === 204) return { ok: true, status: 202 };
  const text = await response.text();
  return { ok: false, status: response.status, error: "workflow_dispatch_failed", detail: text.slice(0, 1000) };
}

async function githubFetch(path, init = {}) {
  const token = process.env.PROOFLOOP_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "proofloop-live",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
}

async function findHostedWorkflowRun(runId) {
  const response = await githubFetch(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50`);
  if (!response.ok) return { ok: false, status: response.status, error: await response.text() };
  const data = await response.json();
  const run = (data.workflow_runs || []).find((item) => item.display_title === `ProofLoop hosted ${runId}`);
  if (!run) return { ok: true, run: null, artifacts: [] };
  const artifactResponse = await githubFetch(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/artifacts?per_page=50`);
  const artifactData = artifactResponse.ok ? await artifactResponse.json() : { artifacts: [] };
  return { ok: true, run, artifacts: artifactData.artifacts || [] };
}

function hostedUrls(runId) {
  return {
    status: `/api/hosted/status?runId=${encodeURIComponent(runId)}`,
    actionsWorkflow: `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`,
  };
}

module.exports = {
  OWNER,
  REPO,
  WORKFLOW,
  buildHostedRunBundle,
  dispatchHostedWorkflow,
  findHostedWorkflowRun,
  hostedOptionsFromBody,
  hostedUrls,
  method,
  readJsonBody,
  sendJson,
  validateHostedRunRequest,
  verifiedHostAllowlist,
};
