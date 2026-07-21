import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  PROOFLOOP_RECEIPT_SCHEMA,
  createInlineProofReceiptPayload,
  type ProofReceiptEnvelope,
  validateProofReceiptEnvelope,
} from "./proofReceipt";

type JsonRecord = Record<string, any>;

export interface EaseProofVerification {
  ok: boolean;
  easeCertified: boolean;
  errors: string[];
  warnings: string[];
  manifestPath: string;
  browserManifestPath?: string;
  checkedScreenshots: number;
  checkedReplayArtifacts: number;
  envelope?: ProofReceiptEnvelope;
  outputPath?: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path: string, label: string, errors: string[]): JsonRecord | undefined {
  if (!existsSync(path)) {
    errors.push(`${label} is missing: ${path}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  } catch (error) {
    errors.push(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function verifyEmittedDigest(value: JsonRecord, key: string, label: string, errors: string[]): void {
  const emitted = value[key];
  if (typeof emitted !== "string" || !/^[a-f0-9]{64}$/.test(emitted)) {
    errors.push(`${label} ${key} is missing or invalid`);
    return;
  }
  const covered = { ...value };
  delete covered[key];
  if (sha256(JSON.stringify(covered)) !== emitted) errors.push(`${label} ${key} does not match content`);
}

export function verifyEaseProof(options: { root: string; manifestPath: string; outputPath?: string }): EaseProofVerification {
  const root = resolve(options.root);
  const manifestPath = isAbsolute(options.manifestPath) ? options.manifestPath : resolve(root, options.manifestPath);
  const evidenceRoot = dirname(manifestPath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifest = readJson(manifestPath, "EaseProof manifest", errors);
  let browserManifest: JsonRecord | undefined;
  let checkedScreenshots = 0;
  let checkedReplayArtifacts = 0;

  if (manifest) {
    if (manifest.schemaVersion !== "nodekit.ease-proof-run/v1") errors.push("EaseProof manifest schemaVersion must be nodekit.ease-proof-run/v1");
    verifyEmittedDigest(manifest, "receiptDigest", "EaseProof manifest", errors);
    if (!Array.isArray(manifest.base?.phases) || manifest.base.phases.length === 0) errors.push("EaseProof phase timer ledger is missing");
    else for (const phase of manifest.base.phases) {
      if (!Number.isFinite(phase.durationMs) || phase.durationMs < 0) errors.push(`EaseProof phase ${phase.name ?? "unknown"} has invalid durationMs`);
      if (phase.exitCode !== undefined && phase.exitCode !== 0) errors.push(`EaseProof phase ${phase.name ?? "unknown"} did not exit 0`);
    }

    const browserManifestPath = resolve(evidenceRoot, "browser", "screenshot-manifest.json");
    browserManifest = readJson(browserManifestPath, "browser screenshot manifest", errors);
    if (browserManifest) {
      verifyEmittedDigest(browserManifest, "manifestSha256", "browser screenshot manifest", errors);
      if (manifest.base?.browserManifestDigest !== browserManifest.manifestSha256) errors.push("factory and browser manifest digests do not match");
      const screenshots = Array.isArray(browserManifest.screenshots) ? browserManifest.screenshots : [];
      if (screenshots.length === 0) errors.push("browser screenshot manifest contains no screenshots");
      for (const screenshot of screenshots) {
        const relativePath = screenshot.path;
        if (typeof relativePath !== "string" || relativePath.includes("..") || isAbsolute(relativePath)) {
          errors.push("screenshot path is unsafe");
          continue;
        }
        const pngPath = resolve(evidenceRoot, relativePath);
        if (!existsSync(pngPath)) {
          errors.push(`screenshot is missing: ${relativePath}`);
          continue;
        }
        checkedScreenshots += 1;
        if (sha256(readFileSync(pngPath)) !== screenshot.pngSha256) errors.push(`screenshot digest mismatch: ${relativePath}`);
        if (screenshot.generatedCandidateCommit !== manifest.base?.candidateCommit) errors.push(`screenshot candidate mismatch: ${relativePath}`);
        if (screenshot.applicationHash !== manifest.base?.applicationHash || screenshot.configHash !== manifest.base?.configHash) errors.push(`screenshot application identity mismatch: ${relativePath}`);
        if (screenshot.nodekitSourceHash !== manifest.nodekitSourceHash) errors.push(`screenshot NodeKit source mismatch: ${relativePath}`);
        if (screenshot.consoleErrors !== 0 || screenshot.failedRequests !== 0 || screenshot.horizontalOverflowPx !== 0 || screenshot.mojibakeDetected !== false) {
          errors.push(`screenshot browser checks failed: ${relativePath}`);
        }
      }

      const replayArtifacts = Array.isArray(browserManifest.evidenceArtifacts) ? browserManifest.evidenceArtifacts : [];
      const requiredReplayIds = new Set(["playwright-trace", "browser-video"]);
      for (const artifact of replayArtifacts) {
        const relativePath = artifact.path;
        if (typeof relativePath !== "string" || relativePath.includes("..") || isAbsolute(relativePath)) {
          errors.push("browser replay artifact path is unsafe");
          continue;
        }
        const artifactPath = resolve(evidenceRoot, relativePath);
        if (!existsSync(artifactPath)) {
          errors.push(`browser replay artifact is missing: ${relativePath}`);
          continue;
        }
        const bytes = readFileSync(artifactPath);
        checkedReplayArtifacts += 1;
        if (sha256(bytes) !== artifact.sha256) errors.push(`browser replay artifact digest mismatch: ${relativePath}`);
        if (bytes.byteLength !== artifact.byteSize) errors.push(`browser replay artifact size mismatch: ${relativePath}`);
        requiredReplayIds.delete(String(artifact.id));
      }
      for (const id of requiredReplayIds) errors.push(`required browser replay artifact is missing: ${id}`);

      const journeyAssertions = browserManifest.journeyAssertions;
      for (const assertion of ["proposalVisible", "approvalApplied", "receiptVisible", "receiptSurvivedReload"]) {
        if (journeyAssertions?.[assertion] !== true) errors.push(`browser journey assertion failed: ${assertion}`);
      }
      if (!Number.isInteger(browserManifest.serverProcess?.pid) || typeof browserManifest.serverProcess?.command !== "string") {
        errors.push("browser server process identity is missing");
      }
    }

    const candidateArchive = resolve(evidenceRoot, "candidate.tar.gz");
    if (!existsSync(candidateArchive)) errors.push("generated candidate archive is missing");

    const easeCertified = manifest.submissionReady === true
      && Array.isArray(manifest.submissionBlockers)
      && manifest.submissionBlockers.length === 0
      && browserManifest?.certified === true;
    if (!easeCertified) warnings.push("Evidence integrity may pass, but NodeKit Ease is not certified and submission remains blocked.");

    const manifestBytes = readFileSync(manifestPath);
    const browserBytes = existsSync(browserManifestPath) ? readFileSync(browserManifestPath) : Buffer.from("");
    const archiveBytes = existsSync(candidateArchive) ? readFileSync(candidateArchive) : Buffer.from("");
    const receiptId = `ease-${String(manifest.runId ?? "unknown")}`;
    const envelope: ProofReceiptEnvelope = {
      schema: PROOFLOOP_RECEIPT_SCHEMA,
      schemaVersion: 1,
      receiptId,
      kind: "nodekit-ease-integrity",
      createdAt: new Date().toISOString(),
      producer: { id: "proofloop", version: "0.3.0", configHash: manifest.nodekitSourceHash },
      subject: {
        type: "run",
        id: String(manifest.runId ?? "unknown"),
        runId: String(manifest.runId ?? "unknown"),
        repository: { candidateCommit: manifest.base?.candidateCommit, dirty: false },
      },
      claim: {
        text: easeCertified
          ? "The supplied NodeKit EaseProof evidence is internally bound and all submission gates are represented as passed."
          : "The supplied NodeKit EaseProof evidence is internally bound; this receipt does not certify ease, human usability, deployment, or submission readiness.",
        boundary: "proxy",
        tier: easeCertified ? "certification_ready" : "local_ready",
      },
      verdict: {
        status: errors.length === 0 ? "passed" : "failed",
        authority: "authoritative",
        decisionMethod: "deterministic_gate",
        decisiveCheckIds: ["ease-integrity"],
        summary: errors.length === 0 ? "Local EaseProof hashes and identities verified." : "EaseProof integrity verification failed.",
      },
      checks: [{
        id: "ease-integrity",
        status: errors.length === 0 ? "passed" : "failed",
        role: "decisive",
        method: "deterministic",
        summary: `${checkedScreenshots} screenshot(s), ${checkedReplayArtifacts} replay artifact(s), and the candidate/timer manifests were checked; Ease certification=${easeCertified}.`,
        evidenceRefs: ["ease-manifest", "browser-manifest", "candidate-archive", "playwright-trace", "browser-video"],
      }],
      evidence: [
        { id: "ease-manifest", kind: "ease-manifest", path: relative(evidenceRoot, manifestPath).replaceAll("\\", "/") || "manifest.json", sha256: sha256(manifestBytes), hashMethod: "raw-bytes-sha256" },
        { id: "browser-manifest", kind: "screenshot-manifest", path: relative(evidenceRoot, browserManifestPath).replaceAll("\\", "/"), sha256: sha256(browserBytes), hashMethod: "raw-bytes-sha256" },
        { id: "candidate-archive", kind: "generated-candidate", path: relative(evidenceRoot, candidateArchive).replaceAll("\\", "/"), sha256: sha256(archiveBytes), hashMethod: "raw-bytes-sha256" },
        ...((browserManifest?.evidenceArtifacts ?? []) as JsonRecord[]).map((artifact) => ({
          id: String(artifact.id),
          kind: String(artifact.id),
          path: String(artifact.path),
          sha256: String(artifact.sha256),
          hashMethod: "raw-bytes-sha256" as const,
        })),
      ],
      payload: createInlineProofReceiptPayload("nodekit.ease-verification/v1", { easeCertified, errors, warnings, checkedScreenshots, runId: manifest.runId }, 1),
      timing: { startedAt: manifest.startedAt, completedAt: manifest.generatedAt, durationMs: manifest.durationMs },
      privacy: { visibility: "private", redacted: true, externalEgress: false },
      extensions: { easeCertified, submissionBlockers: manifest.submissionBlockers ?? [] },
    };
    const envelopeValidation = validateProofReceiptEnvelope(envelope);
    for (const issue of envelopeValidation.errors) errors.push(`generated envelope ${issue.path}: ${issue.message}`);
    let outputPath: string | undefined;
    if (options.outputPath) {
      outputPath = isAbsolute(options.outputPath) ? options.outputPath : resolve(root, options.outputPath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    }
    return { ok: errors.length === 0, easeCertified, errors, warnings, manifestPath, browserManifestPath, checkedScreenshots, checkedReplayArtifacts, envelope, ...(outputPath ? { outputPath } : {}) };
  }
  return { ok: false, easeCertified: false, errors, warnings, manifestPath, checkedScreenshots, checkedReplayArtifacts };
}

export function runEaseProofVerify(options: { root: string; manifestPath: string; outputPath?: string; json?: boolean }): number {
  const result = verifyEaseProof(options);
  const rendered = options.json ? JSON.stringify(result, null, 2) : [
    `proofloop ease verify: ${result.ok ? "integrity-passed" : "failed"}`,
    `easeCertified=${result.easeCertified}`,
    `checkedScreenshots=${result.checkedScreenshots}`,
    `checkedReplayArtifacts=${result.checkedReplayArtifacts}`,
    ...result.errors.map((entry) => `FAIL ${entry}`),
    ...result.warnings.map((entry) => `WARN ${entry}`),
    ...(result.outputPath ? [`receipt=${result.outputPath}`] : []),
  ].join("\n");
  (result.ok ? console.log : console.error)(rendered);
  return result.ok ? 0 : 1;
}
