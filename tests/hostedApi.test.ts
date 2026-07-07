import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const submit = require("../api/hosted/submit.js") as (req: unknown, res: FakeResponse) => Promise<void>;
const health = require("../api/hosted/health.js") as (req: unknown, res: FakeResponse) => Promise<void>;

class FakeResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";

  setHeader(key: string, value: string): void {
    this.headers[key.toLowerCase()] = value;
  }

  end(value = ""): void {
    this.body += value;
  }
}

function jsonRequest(method: string, body: unknown): Readable & { method: string; url: string } {
  const req = new Readable({ read() {} }) as Readable & { method: string; url: string };
  req.method = method;
  req.url = "/api/hosted/submit";
  req.push(JSON.stringify(body));
  req.push(null);
  return req;
}

describe("hosted API routes", () => {
  it("reports hosted service health without requiring a dispatch token", async () => {
    const res = new FakeResponse();
    await health({ method: "GET", url: "/api/hosted/health" }, res);
    const body = JSON.parse(res.body) as { ok: boolean; runner: string; workflow: string };

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.runner).toBe("github-actions");
    expect(body.workflow).toBe("hosted-proofloop.yml");
  });

  it("blocks arbitrary URLs before dispatch when domain permission is missing", async () => {
    const res = new FakeResponse();
    await submit(
      jsonRequest("POST", {
        targetUrl: "https://example.com",
        appType: "chat-agent",
        modelBudgetUsd: 1,
        requestedBenchmarkFamilies: ["live-browser-smoke"],
        consent: {
          accepted: true,
          ownsOrAuthorized: true,
          allowBrowserAutomation: true,
          allowRecording: true,
        },
      }),
      res,
    );
    const body = JSON.parse(res.body) as { ok: boolean; validation: { blockers: string[] } };

    expect(res.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.validation.blockers).toContain("domain_permission_verification_pending");
  });
});
