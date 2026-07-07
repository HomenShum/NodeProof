const { OWNER, REPO, WORKFLOW, method, sendJson } = require("./_shared.js");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  sendJson(res, 200, {
    ok: true,
    service: "proofloop-hosted",
    runner: "github-actions",
    owner: OWNER,
    repo: REPO,
    workflow: WORKFLOW,
    dispatchConfigured: Boolean(process.env.PROOFLOOP_GITHUB_TOKEN),
  });
};
