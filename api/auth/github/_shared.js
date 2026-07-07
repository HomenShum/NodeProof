const crypto = require("node:crypto");

const STATE_COOKIE = "proofloop_oauth_state";
const SESSION_COOKIE = "proofloop_session";
const DEFAULT_SCOPE = "read:user user:email";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const STATE_MAX_AGE_SECONDS = 60 * 10;

function githubAuthConfig() {
  const clientId = process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
  const clientSecret = process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || "";
  const cookieSecret =
    process.env.PROOFLOOP_AUTH_COOKIE_SECRET ||
    process.env.PROOFLOOP_GITHUB_OAUTH_COOKIE_SECRET ||
    clientSecret;
  return {
    clientId,
    clientSecret,
    cookieSecret,
    scope: process.env.PROOFLOOP_GITHUB_OAUTH_SCOPE || DEFAULT_SCOPE,
    configured: Boolean(clientId && clientSecret && cookieSecret),
  };
}

function header(req, key) {
  const headers = req.headers || {};
  const lower = key.toLowerCase();
  return headers[lower] || headers[key] || "";
}

function publicOrigin(req) {
  const envUrl = process.env.PROOFLOOP_PUBLIC_URL || process.env.VERCEL_URL || "";
  const host = header(req, "x-forwarded-host") || header(req, "host");
  const proto = String(header(req, "x-forwarded-proto") || "").split(",")[0] || (isLocalHost(host) ? "http" : "https");
  if (host) return `${proto}://${host}`;
  if (envUrl) return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  return "https://proofloop.live";
}

function requestUrl(req) {
  return new URL(req.url || "/", publicOrigin(req));
}

function parseCookies(req) {
  return String(header(req, "cookie") || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const equals = entry.indexOf("=");
      if (equals === -1) return cookies;
      const name = entry.slice(0, equals);
      const value = entry.slice(equals + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function isLocalHost(host) {
  return /^localhost(?::\d+)?$/i.test(host || "") || /^127\./.test(host || "") || /^\[?::1\]?(?::\d+)?$/.test(host || "");
}

function cookieFlags(req, maxAge) {
  const flags = [`Path=/`, `SameSite=Lax`, `Max-Age=${maxAge}`, "HttpOnly"];
  if (!isLocalHost(header(req, "host"))) flags.push("Secure");
  return flags.join("; ");
}

function serializeCookie(req, name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; ${cookieFlags(req, maxAge)}`;
}

function clearCookie(req, name) {
  return serializeCookie(req, name, "", 0);
}

function randomState() {
  return crypto.randomBytes(24).toString("base64url");
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createSessionValue(profile, secret) {
  const payload = Buffer.from(
    JSON.stringify({
      provider: "github",
      login: String(profile.login || ""),
      id: profile.id,
      avatarUrl: profile.avatar_url || null,
      createdAt: new Date().toISOString(),
    }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

function readSession(req, config = githubAuthConfig()) {
  if (!config.cookieSecret) return null;
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw || !raw.includes(".")) return null;
  const [payload, signature] = raw.split(".", 2);
  if (!payload || !signature || !safeEqual(signature, signPayload(payload, config.cookieSecret))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.provider !== "github" || !decoded.login) return null;
    return {
      login: decoded.login,
      id: decoded.id,
      avatarUrl: decoded.avatarUrl || null,
    };
  } catch {
    return null;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.end("");
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

module.exports = {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STATE_COOKIE,
  STATE_MAX_AGE_SECONDS,
  clearCookie,
  createSessionValue,
  githubAuthConfig,
  method,
  parseCookies,
  publicOrigin,
  randomState,
  readSession,
  redirect,
  requestUrl,
  sendJson,
  serializeCookie,
};
