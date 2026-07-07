const { findHostedWorkflowRun, hostedUrls, method, sendJson } = require("./_shared.js");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const url = new URL(req.url || "/", "https://proofloop.live");
  const runId = url.searchParams.get("runId") || "";
  if (!/^hosted-[a-z0-9-]+-\d{8}T\d{6}$/.test(runId)) {
    sendJson(res, 400, { ok: false, error: "invalid_run_id" });
    return;
  }
  const result = await findHostedWorkflowRun(runId);
  if (!result.ok) {
    sendJson(res, result.status || 502, { ok: false, error: "github_status_failed", detail: result.error });
    return;
  }
  if (!result.run) {
    sendJson(res, 200, {
      ok: true,
      runId,
      status: "queued_or_not_found_yet",
      conclusion: null,
      urls: hostedUrls(runId),
      artifacts: [],
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    runId,
    status: result.run.status,
    conclusion: result.run.conclusion,
    htmlUrl: result.run.html_url,
    startedAt: result.run.run_started_at,
    updatedAt: result.run.updated_at,
    urls: hostedUrls(runId),
    artifacts: result.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      expired: artifact.expired,
      createdAt: artifact.created_at,
      archiveDownloadUrl: artifact.archive_download_url,
    })),
  });
};
