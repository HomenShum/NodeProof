# `proofloop.receipt/v1`

`proofloop.receipt/v1` is the canonical transport envelope for ProofLoop evidence. It wraps existing
gate, Solo, hosted, UI-QA, evaluation, runner, maturity, and app-specific receipts without changing
or deleting their schemas.

The envelope separates three things that older receipts often mixed together:

1. The original payload and its content hash.
2. Checks and evidence observed while verifying that payload.
3. The top-level verdict and exactly who is allowed to decide it.

The JSON Schema ships at `schemas/proofloop-receipt-v1.schema.json`. The public TypeScript API is
exported from `proofloop` through `src/proofReceipt.ts`.

## Authority invariant

Wrapped payloads never transfer verdict authority implicitly.

An authoritative envelope must satisfy all of these rules:

- `verdict.decisionMethod` is `deterministic_gate` or `official_scorer`.
- `verdict.decisiveCheckIds` names at least one check.
- Every named check has `role: decisive`.
- Every decisive check uses `method: deterministic` or `official_scorer`.
- Every official-scorer check identifies the scorer by name, version, and immutable SHA-256 digest.
- Every decisive check names locally verifiable, content-hashed evidence.
- An authoritative `passed` verdict has no non-passing decisive check.
- An authoritative `failed`, `blocked`, or `error` verdict has a decisive check with the same state.

Model judges, human reviews, and external claims remain useful evidence, but they are advisory. If a
human approval or signed upstream receipt is required for certification, a deterministic verifier
checks that approval or signature and records its own decisive result.

The CLI fails closed on missing files, path traversal, payload or evidence hash mismatch, missing
decisive checks, and authority violations.

## Commands

```bash
# Locate the installed schema.
npx proofloop receipt schema

# Print the schema JSON.
npx proofloop receipt schema --json

# Verify structure, authority semantics, inline hashes, and referenced local bytes.
npx proofloop receipt envelope verify --file proof/receipt.json
npx proofloop receipt envelope verify --file proof/receipt.json --json
```

The existing app-specific command remains unchanged:

```bash
npx proofloop receipt verify \
  --file docs/eval/nodeagent-ingestion-orchestrator.json \
  --kind nodeagent-ingestion
```

That verifier may become a decisive check in a new envelope; the app-specific payload does not need
to be rewritten.

## Public API

```ts
import {
  createInlineProofReceiptPayload,
  createInlineProofReceiptResource,
  validateProofReceiptEnvelope,
  verifyProofReceiptEnvelopeFile,
  type ProofReceiptEnvelope,
} from "proofloop";

const legacyGate = {
  schema: "proofloop-gate-v1",
  status: "passed",
  checks: [{ name: "tests", pass: true, exitCode: 0 }],
};

const commandEvidence = createInlineProofReceiptResource({
  id: "tests-output",
  kind: "command-result",
  inline: { command: "npm test", exitCode: 0 },
});

const receipt: ProofReceiptEnvelope = {
  schema: "proofloop.receipt/v1",
  schemaVersion: 1,
  receiptId: "receipt-tests-pass",
  kind: "gate",
  createdAt: new Date().toISOString(),
  producer: { id: "proofloop", version: "0.3.0" },
  subject: { type: "repository", id: "my-repository" },
  verdict: {
    status: "passed",
    authority: "authoritative",
    decisionMethod: "deterministic_gate",
    decisiveCheckIds: ["tests"],
    summary: "The configured test command exited successfully.",
  },
  checks: [{
    id: "tests",
    status: "passed",
    role: "decisive",
    method: "deterministic",
    summary: "npm test exited 0.",
    evidenceRefs: [commandEvidence.id],
    exitCode: 0,
  }],
  evidence: [commandEvidence],
  payload: createInlineProofReceiptPayload("proofloop-gate-v1", legacyGate, 1),
};

const result = validateProofReceiptEnvelope(receipt);
```

Inline JSON uses sorted-key canonical JSON before SHA-256 hashing. Referenced payloads and local
evidence use raw-byte SHA-256 and paths relative to the receipt file. This avoids ambiguous hashes
caused by whitespace or platform-specific absolute paths.

## Migration mapping

| Existing payload | Envelope kind | Initial authority | Decision method | Mapping rule |
|---|---|---|---|---|
| `proofloop-gate-v1` | `gate` | `authoritative` | `deterministic_gate` | Map configured command exit codes to decisive checks and hash their output or gate state. |
| `proofloop-solo-interop-v1` raw export | `solo-interop` | `advisory` | `external_claim` | Preserve `sourceVerdict.authority: advisory`; use no decisive checks. |
| NodeProof-derived Solo gate | `solo-gate` | `authoritative` | `deterministic_gate` | Wrap the NodeProof gate result, not the imported Solo pass claim. |
| `proofloop-hosted-run-v1`, bundle, or worker plan | `hosted-run-plan` | `informational` | `none` | A request, permission packet, queue item, or worker plan is not a completed proof run. |
| Hosted live worker receipt | `hosted-run` | `authoritative` only after verification | `deterministic_gate` | Use the success-contract checks and locally hashed screenshot, trace, scorecard, and output evidence. |
| `agentic-ui-qa-gate-v1` | `ui-qa` | `authoritative` for boolean gates | `deterministic_gate` | Only live-signal, open-P0, regression, and configured floor checks are decisive. Vision/model critique stays advisory. |
| BetterPR QA packet | `ui-handoff` | `informational` | `none` | The packet presents screenshots, video, and review links; reference a separate authoritative receipt. |
| Deterministic app eval | `evaluation` | `authoritative` | `deterministic_gate` | Map deterministic rubric checks to decisive checks. |
| Official upstream scorer | `evaluation` | `authoritative` | `official_scorer` | Record scorer name, version, digest, score, threshold, and immutable scorer output. |
| LLM-as-judge output | `evaluation` | `advisory` | `model_judge` | It may explain or prioritize findings but cannot decide an authoritative pass. |
| NodeAgent ingestion receipt | `app-receipt` | `authoritative` after verifier | `deterministic_gate` | Run the existing `nodeagent-ingestion` verifier and record that verifier result as the decisive check. |

## Adoption rule

Preserve every existing schema while consumers migrate. Emit the old payload exactly as before,
then either embed it under `payload.data` or reference the original file under `payload.ref`.

Consumers should migrate in this order:

1. Read both legacy payloads and `proofloop.receipt/v1`.
2. Emit the envelope alongside the existing receipt.
3. Add cross-repository conformance fixtures.
4. Switch transport and dashboards to the envelope.
5. Retire a legacy transport only after all consumers are proven compatible.

The envelope is deliberately not a universal domain schema. Domain-specific data remains in the
versioned payload. ProofLoop owns transport integrity and verdict authority; domain tools and
official scorers retain ownership of their semantics.
