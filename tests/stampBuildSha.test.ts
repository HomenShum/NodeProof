import { describe, expect, it } from "vitest";
import { stamp } from "../scripts/stamp-build-sha.mjs";

const HEAD = "<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n";

describe("stamp-build-sha", () => {
  it("injects exactly one meta tag with the given sha", () => {
    const sha = "e45f90f692c59f4f86dd8a4343d42b9e1c03bd0d";
    const out = stamp(sha, HEAD);
    const matches = out.match(/<meta name="proofloop-build-sha"[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain(`content="${sha}"`);
    expect(matches[0]).toContain('data-provenance="commit"');
  });

  it("marks an unresolved sha as unavailable provenance", () => {
    const out = stamp("unavailable", HEAD);
    expect(out).toContain('content="unavailable" data-provenance="unavailable"');
  });

  it("is idempotent: re-stamping never duplicates the tag", () => {
    const once = stamp("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", HEAD);
    const twice = stamp("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", once);
    const matches = twice.match(/<meta name="proofloop-build-sha"[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain('content="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"');
  });
});
