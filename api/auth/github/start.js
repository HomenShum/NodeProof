const {
  STATE_COOKIE,
  STATE_MAX_AGE_SECONDS,
  githubAuthConfig,
  method,
  publicOrigin,
  randomState,
  redirect,
  serializeCookie,
} = require("./_shared.js");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const config = githubAuthConfig();
  if (!config.configured) {
    redirect(res, "/?auth=github_unconfigured");
    return;
  }

  const state = randomState();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${publicOrigin(req)}/api/auth/github/callback`);
  authorizeUrl.searchParams.set("scope", config.scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  res.setHeader("set-cookie", serializeCookie(req, STATE_COOKIE, state, STATE_MAX_AGE_SECONDS));
  redirect(res, authorizeUrl.toString());
};
