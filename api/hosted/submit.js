const {
  buildHostedRunBundle,
  dispatchHostedWorkflow,
  hostedOptionsFromBody,
  hostedUrls,
  method,
  readJsonBody,
  sendJson,
  validateHostedRunRequest,
  verifiedHostAllowlist,
} = require("./_shared.js");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const body = await readJsonBody(req);
    const preliminary = buildHostedRunBundle(hostedOptionsFromBody(body));
    const domainProof = await verifiedHostAllowlist(preliminary.request);
    const bundle = buildHostedRunBundle({
      ...hostedOptionsFromBody(body),
      generatedAt: preliminary.request.createdAt,
      allowlistedHosts: domainProof.allowlistedHosts,
    });
    if (domainProof.permission.status === "verified" && domainProof.permission.method !== "allowlist") {
      bundle.permission = domainProof.permission;
    }
    const validation = validateHostedRunRequest(bundle.request, { allowlistedHosts: domainProof.allowlistedHosts });
    if (validation.warnings.includes("auth_notes_may_contain_secret_material_do_not_store_raw_passwords")) {
      validation.blockers.push("auth_notes_must_not_contain_raw_secrets");
      validation.ok = false;
    }
    if (!validation.ok) {
      sendJson(res, 400, {
        ok: false,
        status: "blocked",
        runId: bundle.runId,
        validation,
        permission: bundle.permission,
        urls: hostedUrls(bundle.runId),
        bundle,
      });
      return;
    }

    const dispatch = await dispatchHostedWorkflow(bundle);
    if (!dispatch.ok) {
      sendJson(res, dispatch.status || 503, {
        ok: false,
        status: "dispatch_failed",
        runId: bundle.runId,
        dispatch,
        urls: hostedUrls(bundle.runId),
        bundle,
      });
      return;
    }

    sendJson(res, 202, {
      ok: true,
      status: "queued",
      runId: bundle.runId,
      permission: bundle.permission,
      artifactContract: bundle.artifactContract,
      urls: hostedUrls(bundle.runId),
      bundle,
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "hosted_submit_failed" });
  }
};
