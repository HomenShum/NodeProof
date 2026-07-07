const { githubAuthConfig, method, readSession, sendJson } = require("./_shared.js");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const config = githubAuthConfig();
  const user = readSession(req, config);
  sendJson(res, 200, {
    ok: true,
    provider: "github",
    authConfigured: config.configured,
    authenticated: Boolean(user),
    user,
  });
};
