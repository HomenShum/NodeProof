const {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STATE_COOKIE,
  clearCookie,
  createSessionValue,
  githubAuthConfig,
  method,
  parseCookies,
  publicOrigin,
  redirect,
  requestUrl,
  serializeCookie,
} = require("./_shared.js");

async function exchangeCodeForToken(config, code, redirectUri) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "proofloop-live",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error || "github_token_exchange_failed");
  }
  return body.access_token;
}

async function fetchGithubUser(accessToken) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "proofloop-live",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("github_user_fetch_failed");
  return response.json();
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const config = githubAuthConfig();
  if (!config.configured) {
    redirect(res, "/?auth=github_unconfigured");
    return;
  }

  const url = requestUrl(req);
  if (url.searchParams.get("error")) {
    redirect(res, "/?auth=github_denied");
    return;
  }

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = parseCookies(req)[STATE_COOKIE] || "";
  if (!code || !state || !cookieState || state !== cookieState) {
    res.setHeader("set-cookie", clearCookie(req, STATE_COOKIE));
    redirect(res, "/?auth=github_state_mismatch");
    return;
  }

  try {
    const redirectUri = `${publicOrigin(req)}/api/auth/github/callback`;
    const accessToken = await exchangeCodeForToken(config, code, redirectUri);
    const profile = await fetchGithubUser(accessToken);
    const sessionValue = createSessionValue(profile, config.cookieSecret);
    res.setHeader("set-cookie", [
      clearCookie(req, STATE_COOKIE),
      serializeCookie(req, SESSION_COOKIE, sessionValue, SESSION_MAX_AGE_SECONDS),
    ]);
    redirect(res, "/?github=connected");
  } catch {
    res.setHeader("set-cookie", clearCookie(req, STATE_COOKIE));
    redirect(res, "/?auth=github_failed");
  }
};
