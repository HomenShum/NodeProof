"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSoloTrustReceipt = createSoloTrustReceipt;
exports.verifySoloTrustReceipt = verifySoloTrustReceipt;
exports.readSoloTrustReceipt = readSoloTrustReceipt;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function createSoloTrustReceipt(options) {
    const environment = options.environment ?? process.env;
    const issuerKind = options.issuerKind ?? (environment.PROOFLOOP_TRUST_ISSUER_KIND === "hosted-worker" ? "hosted-worker" : "github-actions");
    if (!options.allowLocalTest && issuerKind === "github-actions" && environment.GITHUB_ACTIONS !== "true") {
        throw new Error("Solo trust attestation requires GitHub Actions or an explicit hosted-worker issuer.");
    }
    if (!options.allowLocalTest && issuerKind === "hosted-worker" && environment.PROOFLOOP_HOSTED_WORKER !== "true") {
        throw new Error("Solo trust attestation requires PROOFLOOP_HOSTED_WORKER=true for the hosted-worker issuer.");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(options.keyId))
        throw new Error("Solo trust keyId is invalid.");
    const envelopeBytes = readRequired(options.envelopePath);
    const gateBytes = readRequired(options.gateReceiptPath);
    const envelope = parseRecord(envelopeBytes, "interop envelope");
    const gate = parseRecord(gateBytes, "NodeProof gate receipt");
    if (envelope.schema !== "proofloop-solo-interop-v1")
        throw new Error("Solo trust envelope schema is unsupported.");
    if (derivedGateStatus(gate) !== "passed")
        throw new Error("Solo trust attestation refuses a non-passing NodeProof gate.");
    const goal = record(envelope.goal);
    const repository = record(envelope.repository);
    const claim = record(envelope.claim);
    const candidateCommit = requiredString(repository.candidateCommit, "repository.candidateCommit");
    const gateCandidate = optionalNestedString(gate, [
        ["candidateCommit"],
        ["repository", "candidateCommit"],
        ["envelope", "repository", "candidateCommit"],
    ]);
    if (gateCandidate && gateCandidate !== candidateCommit)
        throw new Error("Solo trust gate candidate commit does not match the envelope.");
    const payload = {
        schema: "proofloop-solo-trust-payload-v1",
        issuedAt: options.now ?? new Date().toISOString(),
        programId: requiredString(envelope.programId, "programId"),
        goalId: requiredString(goal.goalId, "goal.goalId"),
        candidateCommit,
        claimTier: requiredString(claim.tier, "claim.tier"),
        boundary: requiredString(claim.boundary, "claim.boundary"),
        envelopeSha256: sha256(envelopeBytes),
        gateReceiptSha256: sha256(gateBytes),
        gateStatus: "passed",
        issuer: {
            kind: issuerKind,
            repository: requiredIssuer(environment.GITHUB_REPOSITORY ?? environment.PROOFLOOP_TRUST_REPOSITORY, "repository", options.allowLocalTest),
            workflow: requiredIssuer(environment.GITHUB_WORKFLOW ?? environment.PROOFLOOP_TRUST_WORKFLOW, "workflow", options.allowLocalTest),
            runId: requiredIssuer(environment.GITHUB_RUN_ID ?? environment.PROOFLOOP_TRUST_RUN_ID, "runId", options.allowLocalTest),
            runAttempt: environment.GITHUB_RUN_ATTEMPT ?? environment.PROOFLOOP_TRUST_RUN_ATTEMPT ?? "1",
            actor: environment.GITHUB_ACTOR ?? environment.PROOFLOOP_TRUST_ACTOR ?? "independent-verifier",
        },
    };
    const privateKey = (0, node_crypto_1.createPrivateKey)(normalizePem(options.privateKeyPem));
    if (privateKey.asymmetricKeyType !== "ed25519")
        throw new Error("Solo trust signing key must be Ed25519.");
    const signature = (0, node_crypto_1.sign)(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");
    const receipt = {
        schema: "proofloop-solo-trust-root-receipt-v1",
        algorithm: "Ed25519",
        keyId: options.keyId,
        payload,
        signature,
    };
    if (options.outPath) {
        const outPath = (0, node_path_1.resolve)(options.outPath);
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(outPath), { recursive: true });
        (0, node_fs_1.writeFileSync)(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    }
    return receipt;
}
function verifySoloTrustReceipt(receipt, options) {
    const errors = [];
    if (receipt.schema !== "proofloop-solo-trust-root-receipt-v1")
        errors.push("unsupported trust receipt schema");
    if (receipt.algorithm !== "Ed25519")
        errors.push("unsupported trust receipt algorithm");
    if (options.expectedKeyId && receipt.keyId !== options.expectedKeyId)
        errors.push("trust keyId mismatch");
    if (receipt.payload?.gateStatus !== "passed")
        errors.push("trust payload gate is not passed");
    if (options.expectedCandidateCommit && receipt.payload?.candidateCommit !== options.expectedCandidateCommit)
        errors.push("candidate commit mismatch");
    if (options.expectedRepository && receipt.payload?.issuer?.repository !== options.expectedRepository)
        errors.push("issuer repository mismatch");
    if (options.expectedIssuerKind && receipt.payload?.issuer?.kind !== options.expectedIssuerKind)
        errors.push("issuer kind mismatch");
    if (!/^[a-f0-9]{64}$/.test(receipt.payload?.envelopeSha256 ?? ""))
        errors.push("invalid envelope digest");
    if (!/^[a-f0-9]{64}$/.test(receipt.payload?.gateReceiptSha256 ?? ""))
        errors.push("invalid gate digest");
    try {
        const publicKey = (0, node_crypto_1.createPublicKey)(normalizePem(options.publicKeyPem));
        if (publicKey.asymmetricKeyType !== "ed25519")
            errors.push("verification key must be Ed25519");
        else if (!(0, node_crypto_1.verify)(null, Buffer.from(canonicalJson(receipt.payload)), publicKey, Buffer.from(receipt.signature, "base64")))
            errors.push("trust signature is invalid");
    }
    catch (error) {
        errors.push("trust verification failed: " + (error instanceof Error ? error.message : String(error)));
    }
    return { ok: errors.length === 0, errors };
}
function readSoloTrustReceipt(path) {
    return JSON.parse(readRequired(path));
}
function readRequired(path) {
    const resolved = (0, node_path_1.resolve)(path);
    if (!(0, node_fs_1.existsSync)(resolved))
        throw new Error("Required trust input is missing: " + resolved);
    return (0, node_fs_1.readFileSync)(resolved, "utf8");
}
function parseRecord(text, label) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(label + " is not valid JSON.");
    }
    const value = record(parsed);
    if (Object.keys(value).length === 0)
        throw new Error(label + " must be a JSON object.");
    return value;
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function requiredString(value, field) {
    if (typeof value !== "string" || !value)
        throw new Error("Solo trust input is missing " + field + ".");
    return value;
}
function requiredIssuer(value, field, allowLocalTest = false) {
    if (value)
        return value;
    if (allowLocalTest)
        return "local-" + field;
    throw new Error("Solo trust issuer is missing " + field + ".");
}
function derivedGateStatus(gate) {
    const candidates = [gate.status, gate.derivedStatus, record(gate.verdict).status, record(gate.gate).status];
    return candidates.find((value) => typeof value === "string");
}
function optionalNestedString(root, paths) {
    for (const path of paths) {
        let value = root;
        for (const part of path)
            value = record(value)[part];
        if (typeof value === "string")
            return value;
    }
    return undefined;
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function normalizePem(value) {
    return value.includes("\\n") && !value.includes("\n") ? value.replace(/\\n/g, "\n") : value;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return "[" + value.map(canonicalJson).join(",") + "]";
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return "{" + entries.map(([key, entry]) => JSON.stringify(key) + ":" + canonicalJson(entry)).join(",") + "}";
    }
    return JSON.stringify(value);
}
