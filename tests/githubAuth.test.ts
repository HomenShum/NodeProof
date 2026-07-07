import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const start = require("../api/auth/github/start.js") as (req: FakeRequest, res: FakeResponse) => Promise<void>;
const callback = require("../api/auth/github/callback.js") as (req: FakeRequest, res: FakeResponse) => Promise<void>;
const status = require("../api/auth/github/status.js") as (req: FakeRequest, res: FakeResponse) => Promise<void>;

type HeaderValue = string | string[];

class FakeResponse {
  statusCode = 200;
  headers: Record<string, HeaderValue> = {};
  body = "";

  setHeader(key: string, value: HeaderValue): void {
    this.headers[key.toLowerCase()] = value;
  }

  end(value = ""): void {
    this.body += value;
  }
}

type FakeRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
};

function request(url: string, headers: Record<string, string> = {}): FakeRequest {
  return {
    method: "GET",
    url,
    headers: {
      host: "www.proofloop.live",
      "x-forwarded-proto": "https",
      ...headers,
    },
  };
}

function configureGithubAuth(): void {
  process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_ID = "client-id";
  process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.PROOFLOOP_AUTH_COOKIE_SECRET = "cookie-secret";
}

function clearGithubAuth(): void {
  delete process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_ID;
  delete process.env.PROOFLOOP_GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env.PROOFLOOP_AUTH_COOKIE_SECRET;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
}

function cookiesFromSetCookie(header: HeaderValue | undefined): string {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values.map((entry) => entry.split(";", 1)[0]).join("; ");
}

describe("GitHub SSO API routes", () => {
  beforeEach(() => {
    clearGithubAuth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearGithubAuth();
  });

  it("fails closed when GitHub OAuth is not configured", async () => {
    const res = new FakeResponse();
    await start(request("/api/auth/github/start"), res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/?auth=github_unconfigured");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("starts GitHub OAuth with a state cookie when configured", async () => {
    configureGithubAuth();
    const res = new FakeResponse();
    await start(request("/api/auth/github/start"), res);

    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://www.proofloop.live/api/auth/github/callback");
    expect(location.searchParams.get("scope")).toContain("read:user");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(String(res.headers["set-cookie"])).toContain("proofloop_oauth_state=");
    expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
  });

  it("creates a signed GitHub session that status can read", async () => {
    configureGithubAuth();
    const state = "state-123";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return new Response(JSON.stringify({ access_token: "github-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://api.github.com/user") {
          return new Response(JSON.stringify({ login: "hshum2018", id: 5891, avatar_url: "https://avatar.example/h.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const callbackRes = new FakeResponse();
    await callback(
      request(`/api/auth/github/callback?code=code-123&state=${state}`, {
        cookie: `proofloop_oauth_state=${state}`,
      }),
      callbackRes,
    );

    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers.location).toBe("/?github=connected");
    const cookie = cookiesFromSetCookie(callbackRes.headers["set-cookie"]);
    expect(cookie).toContain("proofloop_session=");

    const statusRes = new FakeResponse();
    await status(request("/api/auth/github/status", { cookie }), statusRes);
    const body = JSON.parse(statusRes.body) as { authConfigured: boolean; authenticated: boolean; user: { login: string } };

    expect(statusRes.statusCode).toBe(200);
    expect(body.authConfigured).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.user.login).toBe("hshum2018");
  });

  it("rejects callbacks without the matching OAuth state cookie", async () => {
    configureGithubAuth();
    const res = new FakeResponse();
    await callback(request("/api/auth/github/callback?code=code-123&state=bad"), res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/?auth=github_state_mismatch");
    expect(String(res.headers["set-cookie"])).toContain("proofloop_oauth_state=");
  });
});
