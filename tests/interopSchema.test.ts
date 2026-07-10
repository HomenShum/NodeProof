import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA_DIGEST = "15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9";

describe("proofloop-solo-interop-v1 schema", () => {
  it("has a line-ending-independent canonical digest and keeps NodeProof authoritative", () => {
    const path = join(process.cwd(), "schemas", "proofloop-solo-interop-v1.schema.json");
    const schema = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const digest = createHash("sha256").update(JSON.stringify(schema)).digest("hex");

    expect(digest).toBe(SCHEMA_DIGEST);
    expect(JSON.stringify(schema)).toContain("NodeProof derives the authoritative verdict");
    expect(JSON.stringify(schema)).toContain('"authority":{"const":"advisory"}');
  });
});
