import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProofloopRunnerPlan, ProofloopRunnerTaskPlan } from "./runner";
import { readSoloTrustReceipt, verifySoloTrustReceipt, type SoloTrustIssuerKind } from "./soloTrust";

export const SOLO_INTEROP_SCHEMA = "proofloop-solo-interop-v1" as const;
export const SOLO_INTEROP_SCHEMA_VERSION = 1 as const;
export const SOLO_INTEROP_SCHEMA_DIGEST = "15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9";
export const SOLO_INTEROP_SCHEMA_FILE_SHA256 = "92f6f24a56f6e31e5d521f09b625d8714370ffa68ea094d340710c715fc901f2";
export const SOLO_INTEROP_STATE_ROOT = ".proofloop/interop/solo";

const STATUS_SCHEMA = "nodeproof-solo-interop-status-v1" as const;
const RUNNER_PLAN_FILE = "runner.plan.json";
const LATEST_ENVELOPE_FILE = "latest-envelope.json";
const LATEST_RECEIPT_FILE = "latest-receipt.json";
const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type UnknownRecord = Record<string, unknown>;

export type SoloGoalStatus = "not_started" | "running" | "blocked" | "completed" | "failed";
export type SoloClaimTier = "local_ready" | "team_ready" | "certification_ready";
export type SoloClaimBoundary = "product_path" | "proxy" | "official";
export type NodeProofSoloStatus = "passed" | "blocked" | "failed" | "incomplete" | "rejected";

export interface SoloInteropReceiptReference {
  id: string;
  kind: string;
  path: string;
  sha256: string;
  producer: string;
  createdAt: string;
  visibility: "private" | "team" | "public";
  required: boolean;
  verifier?: string;
}

export interface SoloInteropHandoffTask {
  id: string;
  milestone: "R" | "A" | "L" | "P" | "H";
  command: string;
  cwd?: string;
  estimatedCostUsd: number;
  timeoutMs?: number;
  dependsOn?: string[];
  requiredReceiptIds?: string[];
}

export interface SoloInteropEnvelope {
  schema: typeof SOLO_INTEROP_SCHEMA;
  schemaVersion: typeof SOLO_INTEROP_SCHEMA_VERSION;
  contract: {
    owner: "NodeProof";
    schemaId: typeof SOLO_INTEROP_SCHEMA;
    schemaDigest: string;
  };
  programId: string;
  goal: {
    goalId: string;
    parentGoalId?: string;
    loopId: string;
    text: string;
    currentMilestone: "R" | "A" | "L" | "P" | "H";
    status: SoloGoalStatus;
    resumeCommand?: string;
  };
  repository: {
    repoUrl: string;
    baseCommit: string;
    candidateCommit: string;
    branch: string;
    dirty: boolean;
    worktreeId?: string;
  };
  actor: {
    actorId: string;
    role: "owner" | "contributor" | "reviewer" | "verifier" | "agent";
    agentHost: string;
    sessionId?: string;
  };
  claim: {
    text: string;
    tier: SoloClaimTier;
    boundary: SoloClaimBoundary;
  };
  receipts: SoloInteropReceiptReference[];
  budget: {
    maxUsd: number;
    spentUsd: number;
    maxRuntimeMs?: number;
    maxModelCalls?: number;
  };
  sourceVerdict: {
    authority: "advisory";
    status: "advisory_pass" | "advisory_fail" | "blocked" | "incomplete" | "unknown";
    path?: string;
    sha256?: string;
    reason?: string;
  };
  blockers?: Array<{
    kind: "approval" | "secret" | "install" | "budget" | "missing_receipt" | "verification" | "conflict";
    message: string;
    nextAction: string;
  }>;
  evaluation?: {
    candidateProducedAt?: string;
    evaluatorAccessedAt?: string;
    scorer?: {
      kind: "deterministic" | "official" | "equivalent_judge";
      name: string;
      version: string;
      digest?: string;
    };
  };
  handoff?: {
    mode: "advisory";
    tasks: SoloInteropHandoffTask[];
  };
  timestamps: {
    createdAt: string;
    exportedAt: string;
  };
  extensions?: UnknownRecord;
}

export interface SoloInteropValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface SoloInteropEvidenceResult {
  id: string;
  kind: string;
  path: string;
  required: boolean;
  expectedSha256: string;
  actualSha256?: string;
  status: "verified" | "missing" | "tampered" | "invalid";
}

export interface SoloInteropValidation {
  ok: boolean;
  envelope?: SoloInteropEnvelope;
  issues: SoloInteropValidationIssue[];
  evidence: SoloInteropEvidenceResult[];
  orderedTasks: SoloInteropHandoffTask[];
  currentCandidateCommit?: string;
  localCanonicalSchemaDigest?: string;
  localSchemaFileSha256?: string;
}

export interface NodeProofSoloReceipt {
  schema: typeof STATUS_SCHEMA;
  authority: "NodeProof";
  status: NodeProofSoloStatus;
  accepted: boolean;
  envelopeSha256: string;
  contractSchemaDigest: string;
  localCanonicalSchemaDigest?: string;
  localSchemaFileSha256?: string;
  evaluatedAt: string;
  programId?: string;
  goalId?: string;
  candidateCommit?: string;
  currentCandidateCommit?: string;
  claim?: {
    tier: SoloClaimTier;
    boundary: SoloClaimBoundary;
    text: string;
  };
  sourceVerdict?: {
    authority: "advisory";
    status: SoloInteropEnvelope["sourceVerdict"]["status"];
  };
  evidence: SoloInteropEvidenceResult[];
  issues: SoloInteropValidationIssue[];
  blockers: Array<{ kind: string; message: string; nextAction: string }>;
  nextActions: string[];
  runnerPlanPath?: string;
  runnerPlanSha256?: string;
}

export interface SoloInteropOperationResult {
  receipt: NodeProofSoloReceipt;
  envelopePath: string;
  receiptPath: string;
  runnerPlanPath?: string;
}

export interface ValidateSoloInteropOptions {
  root: string;
}

export interface IngestSoloInteropOptions extends ValidateSoloInteropOptions {
  filePath: string;
  writeRunnerPlan?: boolean;
  now?: () => Date;
}

export interface RunSoloInteropCliOptions {
  root: string;
  subcommand?: string;
  filePath?: string;
  writeRunnerPlan?: boolean;
  json?: boolean;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export function soloInteropRoot(root: string): string {
  return resolve(root, SOLO_INTEROP_STATE_ROOT);
}

export function soloInteropEnvelopePath(root: string): string {
  return join(soloInteropRoot(root), LATEST_ENVELOPE_FILE);
}

export function soloInteropReceiptPath(root: string): string {
  return join(soloInteropRoot(root), LATEST_RECEIPT_FILE);
}

export function soloInteropRunnerPlanPath(root: string): string {
  return join(soloInteropRoot(root), RUNNER_PLAN_FILE);
}

export function validateSoloInteropEnvelope(input: unknown, options: ValidateSoloInteropOptions): SoloInteropValidation {
  const root = resolve(options.root);
  const issues: SoloInteropValidationIssue[] = [];
  const schemaDiagnostics = validateLocalSchema(issues);
  validateEnvelopeShape(input, issues);
  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues, evidence: [], orderedTasks: [], ...schemaDiagnostics };
  }

  const envelope = input as SoloInteropEnvelope;
  const evidence = verifyReceiptReferences(root, envelope, issues);
  const currentCandidateCommit = validateCandidateCommit(root, envelope, issues);
  validateDuplicateIds(envelope, issues);
  validateBudgetAndBlockers(envelope, issues);
  validateTimelineAndScorer(envelope, issues);
  validateSourceVerdict(root, envelope, issues);
  const orderedTasks = validateAndOrderHandoff(envelope, evidence, issues);
  validateClaim(root, envelope, evidence, issues);

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    envelope,
    issues,
    evidence,
    orderedTasks,
    ...schemaDiagnostics,
    ...(currentCandidateCommit ? { currentCandidateCommit } : {}),
  };
}

export function compileSoloHandoffRunnerPlan(validation: SoloInteropValidation): ProofloopRunnerPlan {
  if (!validation.ok || !validation.envelope) {
    throw new Error("cannot compile a runner plan from an invalid Solo envelope");
  }
  if (validation.orderedTasks.length === 0) {
    throw new Error("Solo envelope has no handoff tasks to compile");
  }
  const tasks: ProofloopRunnerTaskPlan[] = validation.orderedTasks.map((task) => ({
    id: task.id,
    command: task.command,
    ...(task.cwd ? { cwd: task.cwd } : {}),
    estimatedCostUsd: task.estimatedCostUsd,
    ...(task.timeoutMs !== undefined ? { timeoutMs: task.timeoutMs } : {}),
  }));
  return { schema: "proofloop-runner-plan-v1", tasks };
}

export function ingestSoloInterop(options: IngestSoloInteropOptions): SoloInteropOperationResult {
  const root = resolve(options.root);
  const inputPath = isAbsolute(options.filePath) ? options.filePath : resolve(root, options.filePath);
  const raw = readBoundedFile(inputPath);
  const envelopeSha256 = sha256(raw);
  const evaluatedAt = (options.now ?? (() => new Date()))().toISOString();
  const parsed = parseEnvelope(raw);
  const validation = parsed.issue
    ? invalidParseValidation(parsed.issue)
    : validateSoloInteropEnvelope(parsed.value, { root });

  let runnerPlanPath: string | undefined;
  let runnerPlanSha256: string | undefined;
  if (options.writeRunnerPlan === true) {
    try {
      const plan = compileSoloHandoffRunnerPlan(validation);
      const rendered = `${JSON.stringify(plan, null, 2)}\n`;
      runnerPlanPath = soloInteropRunnerPlanPath(root);
      writeInteropFile(root, runnerPlanPath, rendered);
      runnerPlanSha256 = sha256(rendered);
    } catch (error) {
      validation.issues.push({
        severity: "error",
        code: "runner_plan_unavailable",
        path: "handoff.tasks",
        message: error instanceof Error ? error.message : String(error),
      });
      validation.ok = false;
    }
  }

  const receipt = buildNodeProofSoloReceipt(validation, envelopeSha256, evaluatedAt, {
    ...(runnerPlanPath ? { runnerPlanPath: repoRelative(root, runnerPlanPath) } : {}),
    ...(runnerPlanSha256 ? { runnerPlanSha256 } : {}),
  });
  const paths = persistSoloInterop(root, raw, receipt);
  return {
    receipt,
    envelopePath: paths.envelopePath,
    receiptPath: paths.receiptPath,
    ...(runnerPlanPath ? { runnerPlanPath } : {}),
  };
}

export function refreshSoloInteropStatus(rootInput: string, now: () => Date = () => new Date()): SoloInteropOperationResult | undefined {
  const root = resolve(rootInput);
  const envelopePath = soloInteropEnvelopePath(root);
  if (!existsSync(envelopePath)) return undefined;
  assertSafeInteropStateRoot(root, false);
  const raw = readBoundedFile(envelopePath);
  const envelopeSha256 = sha256(raw);
  const parsed = parseEnvelope(raw);
  const validation = parsed.issue
    ? invalidParseValidation(parsed.issue)
    : validateSoloInteropEnvelope(parsed.value, { root });
  const planMetadata = existingRunnerPlanMetadata(root, validation);
  const receipt = buildNodeProofSoloReceipt(validation, envelopeSha256, now().toISOString(), planMetadata);
  const paths = persistSoloReceipt(root, receipt);
  return {
    receipt,
    envelopePath,
    receiptPath: paths.receiptPath,
    ...(planMetadata.runnerPlanPath ? { runnerPlanPath: resolve(root, planMetadata.runnerPlanPath) } : {}),
  };
}

export function runSoloInteropCli(options: RunSoloInteropCliOptions): number {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  try {
    if (options.subcommand === "ingest") {
      if (!options.filePath) {
        logError("proofloop solo ingest: --file <envelope> is required.");
        return 2;
      }
      const result = ingestSoloInterop({
        root: options.root,
        filePath: options.filePath,
        writeRunnerPlan: options.writeRunnerPlan === true,
      });
      emitSoloResult(result, options.json === true, log, logError);
      return result.receipt.accepted ? 0 : 1;
    }

    if (options.subcommand !== "status" && options.subcommand !== "gate" && options.subcommand !== "resume") {
      logError("proofloop solo: expected `ingest`, `status`, `gate`, or `resume`.");
      return 2;
    }

    const result = refreshSoloInteropStatus(options.root);
    if (!result) {
      logError("proofloop solo: no imported envelope found; run `proofloop solo ingest --file <envelope>` first.");
      return 2;
    }

    if (options.subcommand === "resume") {
      const payload = {
        status: result.receipt.status,
        nextActions: result.receipt.nextActions,
        receiptPath: result.receiptPath,
      };
      log(options.json === true ? JSON.stringify(payload, null, 2) : formatSoloResume(result.receipt));
      return 0;
    }

    emitSoloResult(result, options.json === true, log, logError);
    if (options.subcommand === "gate") return result.receipt.status === "passed" ? 0 : 1;
    return 0;
  } catch (error) {
    logError(`proofloop solo: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

export function formatNodeProofSoloReceipt(receipt: NodeProofSoloReceipt): string {
  const lines = [
    `solo=${receipt.status}`,
    `authority=${receipt.authority}`,
    `accepted=${receipt.accepted}`,
    `program=${receipt.programId ?? "unknown"}`,
    `goal=${receipt.goalId ?? "unknown"}`,
    `claim=${receipt.claim ? `${receipt.claim.tier}/${receipt.claim.boundary}` : "unknown"}`,
    `candidate=${receipt.candidateCommit ?? "unknown"}`,
    `evidence=${receipt.evidence.filter((entry) => entry.status === "verified").length}/${receipt.evidence.length}`,
  ];
  if (receipt.issues.length > 0) {
    lines.push("issues:");
    for (const issue of receipt.issues) lines.push(`- ${issue.severity.toUpperCase()} ${issue.code} ${issue.path}: ${issue.message}`);
  }
  if (receipt.nextActions.length > 0) {
    lines.push("next:");
    for (const action of receipt.nextActions) lines.push(`- ${action}`);
  }
  if (receipt.runnerPlanPath) lines.push(`runnerPlan=${receipt.runnerPlanPath}`);
  return `${lines.join("\n")}\n`;
}

function validateEnvelopeShape(input: unknown, issues: SoloInteropValidationIssue[]): void {
  const top = objectValue(input, "$", [
    "schema", "schemaVersion", "contract", "programId", "goal", "repository", "actor", "claim", "receipts", "budget", "sourceVerdict", "timestamps",
  ], [
    "schema", "schemaVersion", "contract", "programId", "goal", "repository", "actor", "claim", "receipts", "budget", "sourceVerdict", "blockers", "evaluation", "handoff", "timestamps", "extensions",
  ], issues);
  if (!top) return;

  constValue(top, "schema", SOLO_INTEROP_SCHEMA, "schema", issues);
  constValue(top, "schemaVersion", SOLO_INTEROP_SCHEMA_VERSION, "schemaVersion", issues);
  stringValue(top, "programId", "programId", issues, { id: true });

  const contract = objectProperty(top, "contract", "contract", ["owner", "schemaId", "schemaDigest"], ["owner", "schemaId", "schemaDigest"], issues);
  if (contract) {
    constValue(contract, "owner", "NodeProof", "contract.owner", issues);
    constValue(contract, "schemaId", SOLO_INTEROP_SCHEMA, "contract.schemaId", issues);
    stringValue(contract, "schemaDigest", "contract.schemaDigest", issues, { sha256: true });
    if (contract.schemaDigest !== SOLO_INTEROP_SCHEMA_DIGEST) {
      error(issues, "schema_digest_mismatch", "contract.schemaDigest", `expected ${SOLO_INTEROP_SCHEMA_DIGEST}`);
    }
  }

  validateGoal(top, issues);
  validateRepository(top, issues);
  validateActor(top, issues);
  validateClaimShape(top, issues);
  validateReceiptsShape(top, issues);
  validateBudgetShape(top, issues);
  validateSourceVerdictShape(top, issues);
  validateBlockersShape(top, issues);
  validateEvaluationShape(top, issues);
  validateHandoffShape(top, issues);
  validateTimestampsShape(top, issues);
  if (top.extensions !== undefined && !isRecord(top.extensions)) {
    error(issues, "invalid_type", "extensions", "must be an object");
  }
}

function validateGoal(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const goal = objectProperty(top, "goal", "goal", ["goalId", "loopId", "text", "currentMilestone", "status"], [
    "goalId", "parentGoalId", "loopId", "text", "currentMilestone", "status", "resumeCommand",
  ], issues);
  if (!goal) return;
  stringValue(goal, "goalId", "goal.goalId", issues, { id: true });
  stringValue(goal, "parentGoalId", "goal.parentGoalId", issues, { id: true, optional: true });
  stringValue(goal, "loopId", "goal.loopId", issues, { id: true });
  stringValue(goal, "text", "goal.text", issues, { min: 1, max: 10000 });
  enumValue(goal, "currentMilestone", "goal.currentMilestone", ["R", "A", "L", "P", "H"], issues);
  enumValue(goal, "status", "goal.status", ["not_started", "running", "blocked", "completed", "failed"], issues);
  stringValue(goal, "resumeCommand", "goal.resumeCommand", issues, { min: 1, max: 4000, optional: true });
}

function validateRepository(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const repository = objectProperty(top, "repository", "repository", ["repoUrl", "baseCommit", "candidateCommit", "branch", "dirty"], [
    "repoUrl", "baseCommit", "candidateCommit", "branch", "dirty", "worktreeId",
  ], issues);
  if (!repository) return;
  stringValue(repository, "repoUrl", "repository.repoUrl", issues, { min: 1, max: 2048 });
  stringValue(repository, "baseCommit", "repository.baseCommit", issues, { gitSha: true });
  stringValue(repository, "candidateCommit", "repository.candidateCommit", issues, { gitSha: true });
  stringValue(repository, "branch", "repository.branch", issues, { min: 1, max: 512 });
  booleanValue(repository, "dirty", "repository.dirty", issues);
  stringValue(repository, "worktreeId", "repository.worktreeId", issues, { id: true, optional: true });
}

function validateActor(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const actor = objectProperty(top, "actor", "actor", ["actorId", "role", "agentHost"], ["actorId", "role", "agentHost", "sessionId"], issues);
  if (!actor) return;
  stringValue(actor, "actorId", "actor.actorId", issues, { id: true });
  enumValue(actor, "role", "actor.role", ["owner", "contributor", "reviewer", "verifier", "agent"], issues);
  stringValue(actor, "agentHost", "actor.agentHost", issues, { min: 1, max: 128 });
  stringValue(actor, "sessionId", "actor.sessionId", issues, { id: true, optional: true });
}

function validateClaimShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const claim = objectProperty(top, "claim", "claim", ["text", "tier", "boundary"], ["text", "tier", "boundary"], issues);
  if (!claim) return;
  stringValue(claim, "text", "claim.text", issues, { min: 1, max: 10000 });
  enumValue(claim, "tier", "claim.tier", ["local_ready", "team_ready", "certification_ready"], issues);
  enumValue(claim, "boundary", "claim.boundary", ["product_path", "proxy", "official"], issues);
}

function validateReceiptsShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const receipts = arrayProperty(top, "receipts", "receipts", issues, 1000);
  if (!receipts) return;
  receipts.forEach((value, index) => {
    const path = `receipts[${index}]`;
    const receipt = objectValue(value, path, ["id", "kind", "path", "sha256", "producer", "createdAt", "visibility", "required"], [
      "id", "kind", "path", "sha256", "producer", "createdAt", "visibility", "required", "verifier",
    ], issues);
    if (!receipt) return;
    stringValue(receipt, "id", `${path}.id`, issues, { id: true });
    stringValue(receipt, "kind", `${path}.kind`, issues, { min: 1, max: 128 });
    stringValue(receipt, "path", `${path}.path`, issues, { relativePath: true });
    stringValue(receipt, "sha256", `${path}.sha256`, issues, { sha256: true });
    stringValue(receipt, "producer", `${path}.producer`, issues, { min: 1, max: 256 });
    stringValue(receipt, "createdAt", `${path}.createdAt`, issues, { dateTime: true });
    enumValue(receipt, "visibility", `${path}.visibility`, ["private", "team", "public"], issues);
    booleanValue(receipt, "required", `${path}.required`, issues);
    stringValue(receipt, "verifier", `${path}.verifier`, issues, { min: 1, max: 256, optional: true });
  });
}

function validateBudgetShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const budget = objectProperty(top, "budget", "budget", ["maxUsd", "spentUsd"], ["maxUsd", "spentUsd", "maxRuntimeMs", "maxModelCalls"], issues);
  if (!budget) return;
  numberValue(budget, "maxUsd", "budget.maxUsd", issues, { min: 0 });
  numberValue(budget, "spentUsd", "budget.spentUsd", issues, { min: 0 });
  numberValue(budget, "maxRuntimeMs", "budget.maxRuntimeMs", issues, { min: 0, integer: true, optional: true });
  numberValue(budget, "maxModelCalls", "budget.maxModelCalls", issues, { min: 0, integer: true, optional: true });
}

function validateSourceVerdictShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const verdict = objectProperty(top, "sourceVerdict", "sourceVerdict", ["authority", "status"], ["authority", "status", "path", "sha256", "reason"], issues);
  if (!verdict) return;
  constValue(verdict, "authority", "advisory", "sourceVerdict.authority", issues);
  enumValue(verdict, "status", "sourceVerdict.status", ["advisory_pass", "advisory_fail", "blocked", "incomplete", "unknown"], issues);
  stringValue(verdict, "path", "sourceVerdict.path", issues, { relativePath: true, optional: true });
  stringValue(verdict, "sha256", "sourceVerdict.sha256", issues, { sha256: true, optional: true });
  stringValue(verdict, "reason", "sourceVerdict.reason", issues, { max: 4000, optional: true });
}

function validateBlockersShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  if (top.blockers === undefined) return;
  const blockers = arrayProperty(top, "blockers", "blockers", issues, 100);
  if (!blockers) return;
  blockers.forEach((value, index) => {
    const path = `blockers[${index}]`;
    const blocker = objectValue(value, path, ["kind", "message", "nextAction"], ["kind", "message", "nextAction"], issues);
    if (!blocker) return;
    enumValue(blocker, "kind", `${path}.kind`, ["approval", "secret", "install", "budget", "missing_receipt", "verification", "conflict"], issues);
    stringValue(blocker, "message", `${path}.message`, issues, { min: 1, max: 4000 });
    stringValue(blocker, "nextAction", `${path}.nextAction`, issues, { min: 1, max: 4000 });
  });
}

function validateEvaluationShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  if (top.evaluation === undefined) return;
  const evaluation = objectProperty(top, "evaluation", "evaluation", [], ["candidateProducedAt", "evaluatorAccessedAt", "scorer"], issues);
  if (!evaluation) return;
  stringValue(evaluation, "candidateProducedAt", "evaluation.candidateProducedAt", issues, { dateTime: true, optional: true });
  stringValue(evaluation, "evaluatorAccessedAt", "evaluation.evaluatorAccessedAt", issues, { dateTime: true, optional: true });
  if (evaluation.scorer === undefined) return;
  const scorer = objectProperty(evaluation, "scorer", "evaluation.scorer", ["kind", "name", "version"], ["kind", "name", "version", "digest"], issues);
  if (!scorer) return;
  enumValue(scorer, "kind", "evaluation.scorer.kind", ["deterministic", "official", "equivalent_judge"], issues);
  stringValue(scorer, "name", "evaluation.scorer.name", issues, { min: 1, max: 256 });
  stringValue(scorer, "version", "evaluation.scorer.version", issues, { min: 1, max: 256 });
  stringValue(scorer, "digest", "evaluation.scorer.digest", issues, { sha256: true, optional: true });
}

function validateHandoffShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  if (top.handoff === undefined) return;
  const handoff = objectProperty(top, "handoff", "handoff", ["mode", "tasks"], ["mode", "tasks"], issues);
  if (!handoff) return;
  constValue(handoff, "mode", "advisory", "handoff.mode", issues);
  const tasks = arrayProperty(handoff, "tasks", "handoff.tasks", issues, 200);
  if (!tasks) return;
  tasks.forEach((value, index) => {
    const path = `handoff.tasks[${index}]`;
    const task = objectValue(value, path, ["id", "milestone", "command", "estimatedCostUsd"], [
      "id", "milestone", "command", "cwd", "estimatedCostUsd", "timeoutMs", "dependsOn", "requiredReceiptIds",
    ], issues);
    if (!task) return;
    stringValue(task, "id", `${path}.id`, issues, { id: true });
    enumValue(task, "milestone", `${path}.milestone`, ["R", "A", "L", "P", "H"], issues);
    stringValue(task, "command", `${path}.command`, issues, { min: 1, max: 4000 });
    stringValue(task, "cwd", `${path}.cwd`, issues, { relativePath: true, optional: true });
    numberValue(task, "estimatedCostUsd", `${path}.estimatedCostUsd`, issues, { min: 0 });
    numberValue(task, "timeoutMs", `${path}.timeoutMs`, issues, { min: 1, integer: true, optional: true });
    idArrayValue(task, "dependsOn", `${path}.dependsOn`, issues);
    idArrayValue(task, "requiredReceiptIds", `${path}.requiredReceiptIds`, issues);
  });
}

function validateTimestampsShape(top: UnknownRecord, issues: SoloInteropValidationIssue[]): void {
  const timestamps = objectProperty(top, "timestamps", "timestamps", ["createdAt", "exportedAt"], ["createdAt", "exportedAt"], issues);
  if (!timestamps) return;
  stringValue(timestamps, "createdAt", "timestamps.createdAt", issues, { dateTime: true });
  stringValue(timestamps, "exportedAt", "timestamps.exportedAt", issues, { dateTime: true });
}

function verifyReceiptReferences(root: string, envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): SoloInteropEvidenceResult[] {
  return envelope.receipts.map((receipt, index) => {
    const result: SoloInteropEvidenceResult = {
      id: receipt.id,
      kind: receipt.kind,
      path: receipt.path,
      required: receipt.required,
      expectedSha256: receipt.sha256,
      status: "invalid",
    };
    let filePath: string;
    try {
      filePath = resolveSafeRepoPath(root, receipt.path);
    } catch (cause) {
      error(issues, "unsafe_receipt_path", `receipts[${index}].path`, cause instanceof Error ? cause.message : String(cause));
      return result;
    }
    if (!existsSync(filePath)) {
      result.status = "missing";
      const message = `receipt file does not exist: ${receipt.path}`;
      if (receipt.required) error(issues, "required_receipt_missing", `receipts[${index}].path`, message);
      else warning(issues, "optional_receipt_missing", `receipts[${index}].path`, message);
      return result;
    }
    try {
      assertExistingFileWithinRoot(root, filePath);
      if (!statSync(filePath).isFile()) throw new Error("receipt path is not a regular file");
      result.actualSha256 = sha256(readFileSync(filePath));
    } catch (cause) {
      result.status = "invalid";
      error(issues, "invalid_receipt_file", `receipts[${index}].path`, cause instanceof Error ? cause.message : String(cause));
      return result;
    }
    if (result.actualSha256 !== receipt.sha256) {
      result.status = "tampered";
      error(issues, "receipt_digest_mismatch", `receipts[${index}].sha256`, `expected ${receipt.sha256}, got ${result.actualSha256}`);
      return result;
    }
    result.status = "verified";
    return result;
  });
}

function validateCandidateCommit(root: string, envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): string | undefined {
  const candidateCommit = envelope.repository.candidateCommit.toLowerCase();
  try {
    const current = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim().toLowerCase();
    if (candidateCommit !== current && !isEvidenceOnlyPromotionCommit(root, candidateCommit)) {
      error(issues, "stale_candidate_commit", "repository.candidateCommit", `expected current git candidate ${current}, or an evidence-only descendant of ${candidateCommit}`);
    }
    validateCandidateWorktree(root, issues);
    return current;
  } catch (cause) {
    error(issues, "git_candidate_unavailable", "repository.candidateCommit", cause instanceof Error ? cause.message : String(cause));
    return undefined;
  }
}

function isEvidenceOnlyPromotionCommit(root: string, candidateCommit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", candidateCommit, "HEAD"], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${candidateCommit}..HEAD`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/).map((path) => path.trim().replace(/\\/g, "/")).filter(Boolean);
    if (changed.length === 0) return false;
    return changed.every(isSoloPromotionStatePath);
  } catch {
    return false;
  }
}

function validateCandidateWorktree(root: string, issues: SoloInteropValidationIssue[]): void {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const records = output.split("\0").filter(Boolean);
    const productPaths: string[] = [];
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (record.length < 4) continue;
      const status = record.slice(0, 2);
      const path = record.slice(3).replace(/\\/g, "/");
      if (!isSoloPromotionStatePath(path)) productPaths.push(path);
      if (/[RC]/.test(status) && index + 1 < records.length) {
        const secondPath = records[++index].replace(/\\/g, "/");
        if (!isSoloPromotionStatePath(secondPath)) productPaths.push(secondPath);
      }
    }
    if (productPaths.length > 0) {
      error(issues, "dirty_candidate_worktree", "repository.dirty", `uncommitted product paths are not certifiable: ${[...new Set(productPaths)].slice(0, 10).join(", ")}`);
    }
  } catch (cause) {
    error(issues, "git_worktree_unavailable", "repository.dirty", cause instanceof Error ? cause.message : String(cause));
  }
}

function isSoloPromotionStatePath(pathInput: string): boolean {
  const path = pathInput.replace(/\\/g, "/").replace(/^\.\//, "");
  return path === ".solo"
    || path.startsWith(".solo/")
    || path === ".proofloop/interop/solo"
    || path.startsWith(".proofloop/interop/solo/");
}

function validateDuplicateIds(envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): void {
  duplicateValues(envelope.receipts.map((receipt) => receipt.id)).forEach((id) => {
    error(issues, "duplicate_receipt_id", "receipts", `duplicate receipt id: ${id}`);
  });
  duplicateValues((envelope.handoff?.tasks ?? []).map((task) => task.id)).forEach((id) => {
    error(issues, "duplicate_task_id", "handoff.tasks", `duplicate handoff task id: ${id}`);
  });
}

function validateBudgetAndBlockers(envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): void {
  const blockers = envelope.blockers ?? [];
  if (envelope.budget.spentUsd > envelope.budget.maxUsd) {
    error(issues, "budget_overrun", "budget.spentUsd", `spentUsd ${envelope.budget.spentUsd} exceeds maxUsd ${envelope.budget.maxUsd}`);
  }
  if (envelope.goal.status === "blocked" && blockers.length === 0) {
    error(issues, "blocked_without_blocker", "blockers", "a blocked goal must include at least one blocker");
  }
  if (envelope.goal.status !== "blocked" && blockers.length > 0) {
    error(issues, "blockers_without_blocked_goal", "goal.status", "blockers require goal.status to be blocked");
  }
  const projected = (envelope.handoff?.tasks ?? []).reduce((sum, task) => sum + task.estimatedCostUsd, envelope.budget.spentUsd);
  if (projected > envelope.budget.maxUsd) {
    const hasBudgetBlocker = envelope.goal.status === "blocked" && blockers.some((blocker) => blocker.kind === "budget");
    if (hasBudgetBlocker) {
      warning(issues, "handoff_exceeds_remaining_budget", "handoff.tasks", `projected spend ${projected} exceeds maxUsd ${envelope.budget.maxUsd}; budget blocker is active`);
    } else {
      error(issues, "handoff_budget_overrun", "handoff.tasks", `projected spend ${projected} exceeds maxUsd ${envelope.budget.maxUsd}`);
    }
  }
}

function validateTimelineAndScorer(envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): void {
  if (Date.parse(envelope.timestamps.createdAt) > Date.parse(envelope.timestamps.exportedAt)) {
    error(issues, "timestamp_order", "timestamps", "createdAt must be at or before exportedAt");
  }
  const candidateProducedAt = envelope.evaluation?.candidateProducedAt;
  const evaluatorAccessedAt = envelope.evaluation?.evaluatorAccessedAt;
  if ((candidateProducedAt === undefined) !== (evaluatorAccessedAt === undefined)) {
    error(issues, "evaluation_timestamp_pair", "evaluation", "candidateProducedAt and evaluatorAccessedAt must be supplied together");
  }
  if (candidateProducedAt && evaluatorAccessedAt && Date.parse(candidateProducedAt) > Date.parse(evaluatorAccessedAt)) {
    error(issues, "scorer_order", "evaluation", "candidateProducedAt must be at or before evaluatorAccessedAt");
  }
}

function validateSourceVerdict(root: string, envelope: SoloInteropEnvelope, issues: SoloInteropValidationIssue[]): void {
  const { path, sha256: expected } = envelope.sourceVerdict;
  if ((path === undefined) !== (expected === undefined)) {
    error(issues, "source_verdict_reference_pair", "sourceVerdict", "path and sha256 must be supplied together");
    return;
  }
  if (!path || !expected) return;
  let filePath: string;
  try {
    filePath = resolveSafeRepoPath(root, path);
  } catch (cause) {
    error(issues, "unsafe_source_verdict_path", "sourceVerdict.path", cause instanceof Error ? cause.message : String(cause));
    return;
  }
  if (!existsSync(filePath)) {
    error(issues, "source_verdict_missing", "sourceVerdict.path", `source verdict file does not exist: ${path}`);
    return;
  }
  try {
    assertExistingFileWithinRoot(root, filePath);
    if (!statSync(filePath).isFile()) throw new Error("source verdict path is not a regular file");
    const actual = sha256(readFileSync(filePath));
    if (actual !== expected) error(issues, "source_verdict_digest_mismatch", "sourceVerdict.sha256", `expected ${expected}, got ${actual}`);
  } catch (cause) {
    error(issues, "invalid_source_verdict_file", "sourceVerdict.path", cause instanceof Error ? cause.message : String(cause));
  }
}

function validateAndOrderHandoff(
  envelope: SoloInteropEnvelope,
  evidence: SoloInteropEvidenceResult[],
  issues: SoloInteropValidationIssue[],
): SoloInteropHandoffTask[] {
  const tasks = envelope.handoff?.tasks ?? [];
  if (tasks.length === 0) return [];
  const byId = new Map<string, SoloInteropHandoffTask>();
  const indexById = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (!byId.has(task.id)) {
      byId.set(task.id, task);
      indexById.set(task.id, index);
    }
  });
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  for (const [index, task] of tasks.entries()) {
    for (const dependency of task.dependsOn ?? []) {
      if (!byId.has(dependency)) error(issues, "unknown_task_dependency", `handoff.tasks[${index}].dependsOn`, `unknown task dependency: ${dependency}`);
    }
    for (const receiptId of task.requiredReceiptIds ?? []) {
      const receipt = evidenceById.get(receiptId);
      if (!receipt) {
        error(issues, "unknown_required_receipt", `handoff.tasks[${index}].requiredReceiptIds`, `unknown receipt id: ${receiptId}`);
      } else if (receipt.status !== "verified") {
        error(issues, "unverified_required_receipt", `handoff.tasks[${index}].requiredReceiptIds`, `receipt ${receiptId} is ${receipt.status}`);
      }
    }
  }

  if (issues.some((issue) => issue.code === "duplicate_task_id" || issue.code === "unknown_task_dependency")) return [];
  const indegree = new Map(tasks.map((task) => [task.id, task.dependsOn?.length ?? 0]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      const values = dependents.get(dependency) ?? [];
      values.push(task.id);
      dependents.set(dependency, values);
    }
  }
  const available = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id);
  const ordered: SoloInteropHandoffTask[] = [];
  while (available.length > 0) {
    available.sort((left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0));
    const id = available.shift()!;
    ordered.push(byId.get(id)!);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) available.push(dependent);
    }
  }
  if (ordered.length !== tasks.length) {
    const cyclic = tasks.filter((task) => !ordered.some((entry) => entry.id === task.id)).map((task) => task.id);
    error(issues, "cyclic_task_graph", "handoff.tasks", `handoff task graph contains a cycle: ${cyclic.join(", ")}`);
    return [];
  }
  return ordered;
}

function validateClaim(
  root: string,
  envelope: SoloInteropEnvelope,
  evidence: SoloInteropEvidenceResult[],
  issues: SoloInteropValidationIssue[],
): void {
  if (envelope.claim.tier === "team_ready") {
    if (envelope.claim.boundary === "proxy") {
      error(issues, "unsupported_claim_boundary", "claim.boundary", "team_ready cannot be claimed from proxy evidence");
    }
    validatePromotionTrustReceipt(root, envelope, evidence, issues, {
      kind: "nodeproof-ci",
      issuerKind: "github-actions",
      priorTier: "local_ready",
      missingCode: "missing_nodeproof_ci_receipt",
    });
  }
  if (envelope.claim.tier === "certification_ready") {
    if (envelope.claim.boundary === "proxy") {
      error(issues, "unsupported_claim_boundary", "claim.boundary", "certification_ready cannot be claimed from proxy evidence");
    }
    validatePromotionTrustReceipt(root, envelope, evidence, issues, {
      kind: "hosted-trust-root",
      issuerKind: "hosted-worker",
      priorTier: "team_ready",
      missingCode: "missing_hosted_trust_root_receipt",
    });
  }
  if (envelope.claim.boundary === "official") {
    const evaluation = envelope.evaluation;
    if (
      !evaluation?.candidateProducedAt
      || !evaluation.evaluatorAccessedAt
      || evaluation.scorer?.kind !== "official"
      || !evaluation.scorer.name
      || !evaluation.scorer.version
      || !evaluation.scorer.digest
    ) {
      error(issues, "unsupported_official_claim", "claim.boundary", "official claims require an official scorer with name, version, digest, candidateProducedAt, and evaluatorAccessedAt");
    }
  }
}

function validatePromotionTrustReceipt(
  root: string,
  envelope: SoloInteropEnvelope,
  evidence: SoloInteropEvidenceResult[],
  issues: SoloInteropValidationIssue[],
  expected: {
    kind: "nodeproof-ci" | "hosted-trust-root";
    issuerKind: SoloTrustIssuerKind;
    priorTier: "local_ready" | "team_ready";
    missingCode: "missing_nodeproof_ci_receipt" | "missing_hosted_trust_root_receipt";
  },
): void {
  const candidates = envelope.receipts.filter((receipt) => receipt.kind === expected.kind && receipt.required);
  if (candidates.length === 0) {
    error(issues, expected.missingCode, "claim.tier", `${envelope.claim.tier} requires a signed, required ${expected.kind} receipt`);
    return;
  }
  const publicKeyPem = process.env.PROOFLOOP_TRUST_PUBLIC_KEY_PEM;
  if (!publicKeyPem) {
    error(issues, "trust_public_key_missing", "claim.tier", "PROOFLOOP_TRUST_PUBLIC_KEY_PEM is required to verify promotion receipts");
    return;
  }

  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  let valid = false;
  for (const candidate of candidates) {
    if (evidenceById.get(candidate.id)?.status !== "verified") continue;
    const issuePath = `receipts.${candidate.id}`;
    try {
      const receipt = readSoloTrustReceipt(resolveSafeRepoPath(root, candidate.path));
      const expectedRepository = process.env.PROOFLOOP_TRUST_REPOSITORY
        ?? process.env.GITHUB_REPOSITORY
        ?? githubRepositoryFromUrl(envelope.repository.repoUrl);
      const expectedKeyId = process.env.PROOFLOOP_TRUST_KEY_ID;
      const verification = verifySoloTrustReceipt(receipt, {
        publicKeyPem,
        expectedCandidateCommit: envelope.repository.candidateCommit,
        ...(expectedKeyId ? { expectedKeyId } : {}),
        ...(expectedRepository ? { expectedRepository } : {}),
      });
      if (!verification.ok) {
        error(issues, "invalid_trust_receipt", issuePath, verification.errors.join("; "));
        continue;
      }
      if (receipt.payload.issuer.kind !== expected.issuerKind) {
        error(issues, "trust_issuer_mismatch", issuePath, `expected ${expected.issuerKind}, got ${receipt.payload.issuer.kind}`);
        continue;
      }
      if (receipt.payload.claimTier !== expected.priorTier) {
        error(issues, "trust_stage_mismatch", issuePath, `expected prior claim tier ${expected.priorTier}, got ${receipt.payload.claimTier}`);
        continue;
      }
      if (receipt.payload.boundary !== envelope.claim.boundary) {
        error(issues, "trust_boundary_mismatch", issuePath, `expected boundary ${envelope.claim.boundary}, got ${receipt.payload.boundary}`);
        continue;
      }
      if (receipt.payload.programId !== envelope.programId || receipt.payload.goalId !== envelope.goal.goalId) {
        error(issues, "trust_subject_mismatch", issuePath, "promotion receipt programId/goalId does not match the envelope");
        continue;
      }
      valid = true;
    } catch (cause) {
      error(issues, "invalid_trust_receipt", issuePath, cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (!valid && !issues.some((issue) => issue.path.startsWith("receipts.") && [
    "invalid_trust_receipt", "trust_issuer_mismatch", "trust_stage_mismatch", "trust_boundary_mismatch", "trust_subject_mismatch",
  ].includes(issue.code))) {
    error(issues, expected.missingCode, "claim.tier", `${envelope.claim.tier} requires a verified ${expected.kind} receipt`);
  }
}

function githubRepositoryFromUrl(repoUrl: string): string | undefined {
  const scp = repoUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (scp) return scp[1].replace(/\.git$/i, "");
  try {
    const url = new URL(repoUrl);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    return /^[^/]+\/[^/]+$/.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function buildNodeProofSoloReceipt(
  validation: SoloInteropValidation,
  envelopeSha256: string,
  evaluatedAt: string,
  planMetadata: { runnerPlanPath?: string; runnerPlanSha256?: string },
): NodeProofSoloReceipt {
  const envelope = validation.envelope;
  const status = deriveNodeProofStatus(validation);
  return {
    schema: STATUS_SCHEMA,
    authority: "NodeProof",
    status,
    accepted: validation.ok,
    envelopeSha256,
    contractSchemaDigest: SOLO_INTEROP_SCHEMA_DIGEST,
    ...(validation.localCanonicalSchemaDigest ? { localCanonicalSchemaDigest: validation.localCanonicalSchemaDigest } : {}),
    ...(validation.localSchemaFileSha256 ? { localSchemaFileSha256: validation.localSchemaFileSha256 } : {}),
    evaluatedAt,
    ...(envelope ? {
      programId: envelope.programId,
      goalId: envelope.goal.goalId,
      candidateCommit: envelope.repository.candidateCommit,
      claim: { ...envelope.claim },
      sourceVerdict: {
        authority: "advisory" as const,
        status: envelope.sourceVerdict.status,
      },
    } : {}),
    ...(validation.currentCandidateCommit ? { currentCandidateCommit: validation.currentCandidateCommit } : {}),
    evidence: validation.evidence,
    issues: validation.issues,
    blockers: envelope?.blockers ?? [],
    nextActions: deriveNextActions(validation, status),
    ...planMetadata,
  };
}

function deriveNodeProofStatus(validation: SoloInteropValidation): NodeProofSoloStatus {
  if (!validation.ok || !validation.envelope) return "rejected";
  if (validation.envelope.goal.status === "blocked") return "blocked";
  if (validation.envelope.goal.status === "failed") return "failed";
  if (validation.envelope.goal.status !== "completed") return "incomplete";
  if (!validation.evidence.some((entry) => entry.required && entry.status === "verified")) return "incomplete";
  return "passed";
}

function deriveNextActions(validation: SoloInteropValidation, status: NodeProofSoloStatus): string[] {
  const envelope = validation.envelope;
  if (status === "rejected") {
    return validation.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.path}: ${issue.message}`);
  }
  if (status === "blocked") return (envelope?.blockers ?? []).map((blocker) => blocker.nextAction);
  if (status === "failed") return envelope?.goal.resumeCommand ? [envelope.goal.resumeCommand] : ["Repair the failed goal and export a new Solo envelope."];
  if (status === "incomplete") {
    const actions: string[] = [];
    if (!validation.evidence.some((entry) => entry.required && entry.status === "verified")) {
      actions.push("Produce and reference at least one required, digest-verified receipt.");
    }
    if (envelope?.goal.resumeCommand) actions.push(envelope.goal.resumeCommand);
    else actions.push("Continue the goal and export a new envelope after completion.");
    return [...new Set(actions)];
  }
  return [];
}

function persistSoloInterop(root: string, raw: string, receipt: NodeProofSoloReceipt): { envelopePath: string; receiptPath: string } {
  const stateRoot = assertSafeInteropStateRoot(root, true);
  const importPath = join(stateRoot, "imports", `${receipt.envelopeSha256}.json`);
  const envelopePath = soloInteropEnvelopePath(root);
  writeInteropFile(root, importPath, raw);
  writeInteropFile(root, envelopePath, raw);
  const persisted = persistSoloReceipt(root, receipt);
  return { envelopePath, receiptPath: persisted.receiptPath };
}

function persistSoloReceipt(root: string, receipt: NodeProofSoloReceipt): { receiptPath: string } {
  const stateRoot = assertSafeInteropStateRoot(root, true);
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  const historyPath = join(stateRoot, "receipts", `${receipt.envelopeSha256}.json`);
  const receiptPath = soloInteropReceiptPath(root);
  writeInteropFile(root, historyPath, rendered);
  writeInteropFile(root, receiptPath, rendered);
  return { receiptPath };
}

function existingRunnerPlanMetadata(
  root: string,
  validation: SoloInteropValidation,
): { runnerPlanPath?: string; runnerPlanSha256?: string } {
  const filePath = soloInteropRunnerPlanPath(root);
  if (!existsSync(filePath) || !validation.ok || validation.orderedTasks.length === 0) return {};
  try {
    assertExistingFileWithinRoot(root, filePath);
    const actual = readFileSync(filePath, "utf8");
    const expected = `${JSON.stringify(compileSoloHandoffRunnerPlan(validation), null, 2)}\n`;
    if (actual !== expected) return {};
    return { runnerPlanPath: repoRelative(root, filePath), runnerPlanSha256: sha256(actual) };
  } catch {
    return {};
  }
}

function parseEnvelope(raw: string): { value?: unknown; issue?: SoloInteropValidationIssue } {
  try {
    return { value: JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown };
  } catch (cause) {
    return {
      issue: {
        severity: "error",
        code: "invalid_envelope_json",
        path: "$",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}

function invalidParseValidation(issue: SoloInteropValidationIssue): SoloInteropValidation {
  const issues = [issue];
  const schemaDiagnostics = validateLocalSchema(issues);
  return { ok: false, issues, evidence: [], orderedTasks: [], ...schemaDiagnostics };
}

function validateLocalSchema(issues: SoloInteropValidationIssue[]): {
  localCanonicalSchemaDigest?: string;
  localSchemaFileSha256?: string;
} {
  const schemaPath = resolve(__dirname, "..", "schemas", "proofloop-solo-interop-v1.schema.json");
  try {
    const schemaBytes = readFileSync(schemaPath);
    const schemaText = schemaBytes.toString("utf8").replace(/^\uFEFF/, "");
    const localSchemaFileSha256 = sha256(schemaBytes);
    const localCanonicalSchemaDigest = sha256(JSON.stringify(JSON.parse(schemaText) as unknown));
    if (localCanonicalSchemaDigest !== SOLO_INTEROP_SCHEMA_DIGEST) {
      error(
        issues,
        "local_schema_digest_mismatch",
        "contract.schemaDigest",
        `canonical local schema digest ${localCanonicalSchemaDigest} does not match ${SOLO_INTEROP_SCHEMA_DIGEST}`,
      );
    }
    return { localCanonicalSchemaDigest, localSchemaFileSha256 };
  } catch (cause) {
    error(issues, "local_schema_unavailable", "contract.schemaDigest", cause instanceof Error ? cause.message : String(cause));
    return {};
  }
}

function readBoundedFile(filePath: string): string {
  const size = statSync(filePath).size;
  if (size > MAX_ENVELOPE_BYTES) throw new Error(`Solo envelope exceeds ${MAX_ENVELOPE_BYTES} bytes`);
  return readFileSync(filePath, "utf8");
}

function assertSafeInteropStateRoot(rootInput: string, create: boolean): string {
  const root = resolve(rootInput);
  const stateRoot = soloInteropRoot(root);
  const rootReal = realpathSync(root);
  let current = root;
  for (const segment of [".proofloop", "interop", "solo"]) {
    current = join(current, segment);
    if (existsSync(current)) {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) throw new Error(`refusing to use symlinked interop state path: ${current}`);
      if (!entry.isDirectory()) throw new Error(`interop state path is not a directory: ${current}`);
    } else if (create) {
      mkdirSync(current);
    } else {
      throw new Error(`interop state directory is incomplete: ${current}`);
    }
  }
  const stateReal = realpathSync(stateRoot);
  if (!isPathWithin(rootReal, stateReal)) throw new Error("interop state path escapes the repository root");
  const soloSource = resolve(root, ".solo");
  if (isPathWithin(soloSource, stateRoot)) throw new Error("interop state path must not be inside .solo");
  return stateRoot;
}

function writeInteropFile(root: string, filePath: string, contents: string): void {
  const stateRoot = assertSafeInteropStateRoot(root, true);
  const target = resolve(filePath);
  if (!isPathWithin(stateRoot, target)) throw new Error(`refusing to write outside ${SOLO_INTEROP_STATE_ROOT}`);
  ensureSafeInteropDirectory(stateRoot, dirname(target));
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`refusing to replace symlinked interop file: ${target}`);
  const tempPath = join(dirname(target), `.${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, target);
}

function ensureSafeInteropDirectory(stateRootInput: string, directoryInput: string): void {
  const stateRoot = resolve(stateRootInput);
  const directory = resolve(directoryInput);
  if (!isPathWithin(stateRoot, directory)) throw new Error("interop output directory escapes the state root");
  const segments = relative(stateRoot, directory).split(sep).filter(Boolean);
  let current = stateRoot;
  for (const segment of segments) {
    current = join(current, segment);
    if (existsSync(current)) {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) throw new Error(`refusing to use symlinked interop output directory: ${current}`);
      if (!entry.isDirectory()) throw new Error(`interop output path is not a directory: ${current}`);
    } else {
      mkdirSync(current);
    }
  }
}

export function resolveSafeRepoPath(rootInput: string, repoPath: string): string {
  if (!isSafeRepoRelativePath(repoPath)) throw new Error(`unsafe repo-relative path: ${repoPath}`);
  const root = resolve(rootInput);
  const normalized = repoPath.replace(/[\\/]+/g, sep);
  const target = resolve(root, normalized);
  if (!isPathWithin(root, target)) throw new Error(`path escapes repository root: ${repoPath}`);
  return target;
}

function isSafeRepoRelativePath(value: string): boolean {
  if (value.length < 1 || value.length > 4096 || value.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(value) || /^[\\/]/.test(value)) return false;
  const normalized = value.replace(/\\/g, "/");
  if (isAbsolute(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function assertExistingFileWithinRoot(rootInput: string, filePath: string): void {
  const root = resolve(rootInput);
  const lexicalRelative = relative(root, resolve(filePath));
  if (!lexicalRelative || lexicalRelative === ".." || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    throw new Error("resolved file escapes repository root");
  }
  let current = root;
  for (const segment of lexicalRelative.split(sep)) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error("receipt path contains a symbolic link");
  }
  const rootReal = realpathSync(root);
  const fileReal = realpathSync(filePath);
  if (!isPathWithin(rootReal, fileReal)) throw new Error("resolved file escapes repository root");
}

function isPathWithin(rootInput: string, targetInput: string): boolean {
  const rel = relative(resolve(rootInput), resolve(targetInput));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function repoRelative(root: string, filePath: string): string {
  return relative(resolve(root), resolve(filePath)).split(sep).join("/");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function objectProperty(
  parent: UnknownRecord,
  key: string,
  path: string,
  required: string[],
  allowed: string[],
  issues: SoloInteropValidationIssue[],
): UnknownRecord | undefined {
  return objectValue(parent[key], path, required, allowed, issues);
}

function objectValue(
  value: unknown,
  path: string,
  required: string[],
  allowed: string[],
  issues: SoloInteropValidationIssue[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    error(issues, "invalid_type", path, "must be an object");
    return undefined;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) error(issues, "missing_field", `${path}.${key}`, "is required");
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) error(issues, "unknown_field", path === "$" ? key : `${path}.${key}`, `unknown field: ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type StringRules = {
  optional?: boolean;
  min?: number;
  max?: number;
  id?: boolean;
  sha256?: boolean;
  gitSha?: boolean;
  dateTime?: boolean;
  relativePath?: boolean;
};

function stringValue(record: UnknownRecord, key: string, path: string, issues: SoloInteropValidationIssue[], rules: StringRules = {}): void {
  const value = record[key];
  if (value === undefined && rules.optional) return;
  if (typeof value !== "string") {
    error(issues, "invalid_type", path, "must be a string");
    return;
  }
  if (rules.min !== undefined && value.length < rules.min) error(issues, "string_too_short", path, `must contain at least ${rules.min} character(s)`);
  if (rules.max !== undefined && value.length > rules.max) error(issues, "string_too_long", path, `must contain at most ${rules.max} character(s)`);
  if (rules.id && !ID_PATTERN.test(value)) error(issues, "invalid_id", path, "must be a valid interop id");
  if (rules.sha256 && !SHA256_PATTERN.test(value)) error(issues, "invalid_sha256", path, "must be a lowercase SHA-256 digest");
  if (rules.gitSha && !GIT_SHA_PATTERN.test(value)) error(issues, "invalid_git_sha", path, "must be a lowercase 40-64 character git SHA");
  if (rules.dateTime && (!DATE_TIME_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) error(issues, "invalid_date_time", path, "must be an RFC 3339 date-time");
  if (rules.relativePath && !isSafeRepoRelativePath(value)) error(issues, "unsafe_relative_path", path, "must be a safe repo-relative path without traversal");
}

function booleanValue(record: UnknownRecord, key: string, path: string, issues: SoloInteropValidationIssue[]): void {
  if (typeof record[key] !== "boolean") error(issues, "invalid_type", path, "must be a boolean");
}

function numberValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: SoloInteropValidationIssue[],
  rules: { optional?: boolean; min?: number; integer?: boolean } = {},
): void {
  const value = record[key];
  if (value === undefined && rules.optional) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    error(issues, "invalid_type", path, "must be a finite number");
    return;
  }
  if (rules.min !== undefined && value < rules.min) error(issues, "number_too_small", path, `must be at least ${rules.min}`);
  if (rules.integer && !Number.isInteger(value)) error(issues, "invalid_integer", path, "must be an integer");
}

function constValue(record: UnknownRecord, key: string, expected: string | number, path: string, issues: SoloInteropValidationIssue[]): void {
  if (record[key] !== expected) error(issues, "invalid_constant", path, `must equal ${JSON.stringify(expected)}`);
}

function enumValue(record: UnknownRecord, key: string, path: string, allowed: string[], issues: SoloInteropValidationIssue[]): void {
  if (typeof record[key] !== "string" || !allowed.includes(record[key] as string)) {
    error(issues, "invalid_enum", path, `must be one of: ${allowed.join(", ")}`);
  }
}

function arrayProperty(record: UnknownRecord, key: string, path: string, issues: SoloInteropValidationIssue[], maxItems?: number): unknown[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    error(issues, "invalid_type", path, "must be an array");
    return undefined;
  }
  if (maxItems !== undefined && value.length > maxItems) error(issues, "too_many_items", path, `must contain at most ${maxItems} items`);
  return value;
}

function idArrayValue(record: UnknownRecord, key: string, path: string, issues: SoloInteropValidationIssue[]): void {
  if (record[key] === undefined) return;
  const values = arrayProperty(record, key, path, issues);
  if (!values) return;
  const strings: string[] = [];
  values.forEach((value, index) => {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) error(issues, "invalid_id", `${path}[${index}]`, "must be a valid interop id");
    else strings.push(value);
  });
  duplicateValues(strings).forEach((id) => error(issues, "duplicate_array_id", path, `duplicate id: ${id}`));
}

function error(issues: SoloInteropValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ severity: "error", code, path, message });
}

function warning(issues: SoloInteropValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ severity: "warning", code, path, message });
}

function emitSoloResult(
  result: SoloInteropOperationResult,
  json: boolean,
  log: (message: string) => void,
  logError: (message: string) => void,
): void {
  const rendered = json
    ? JSON.stringify({ receipt: result.receipt, envelopePath: result.envelopePath, receiptPath: result.receiptPath, ...(result.runnerPlanPath ? { runnerPlanPath: result.runnerPlanPath } : {}) }, null, 2)
    : formatNodeProofSoloReceipt(result.receipt);
  if (result.receipt.accepted) log(rendered);
  else logError(rendered);
}

function formatSoloResume(receipt: NodeProofSoloReceipt): string {
  const lines = [`solo=${receipt.status}`, `receipt=${soloDisplayPath(receipt)}`];
  if (receipt.nextActions.length === 0) lines.push("next=none; the NodeProof Solo gate passes");
  else receipt.nextActions.forEach((action) => lines.push(`next=${action}`));
  return `${lines.join("\n")}\n`;
}

function soloDisplayPath(receipt: NodeProofSoloReceipt): string {
  return `${SOLO_INTEROP_STATE_ROOT}/receipts/${receipt.envelopeSha256}.json`;
}
