/**
 * `proofloop transfer-check` -- the two-layer certification AGREEMENT GATE.
 *
 * WHY THIS EXISTS: Proof Loop is adopting a two-layer certification model
 * ("two-layer-certification-v1", the vocabulary shared with layeredPlan.ts):
 *
 *   - a headless CAPABILITY lane runs ALL benchmark tasks through the live
 *     agent harness (cheap, no browser);
 *   - a BROWSER lane runs a small stratified sample through the real
 *     production UI.
 *
 * The split saves ~95% of cost and wall-clock, BUT it creates a new gaming
 * surface: the harness lane could take shortcuts the product path does not
 * have (memory-mode, bypassed tool contracts) and nothing would notice.
 * transfer-check makes the anti-cheat doctrine's IN-APP TRANSFER rule
 * mechanical: browser samples are an agreement test ON the capability lane,
 * and divergence fails closed.
 *
 * Direction matters, so disagreements are labeled distinctly:
 *   - capability-pass / browser-fail => suspected harness shortcut or
 *     product-path break -- the capability claim is suspect.
 *   - capability-fail / browser-pass => suspected harness bug or env gap --
 *     the capability lane is under-reporting.
 *
 * Verifying failures is as important as verifying passes: a failure that
 * passes in the browser exposes a harness bug; a pass that fails in the
 * browser exposes a harness shortcut. The sampler therefore MUST include
 * capability-lane failures, and the gate refuses (exit 2, cherry-pick guard)
 * a browser set that dodged every capability failure.
 *
 * Subcommands:
 *   proofloop transfer-check sample --capability <file> --seed <string>
 *       [--per-family 5] [--model <label>] [--out <file>]
 *     Deterministic stratified sampler. The seed is REQUIRED and callers
 *     should pass a commit SHA so the agent cannot re-roll or cherry-pick
 *     the sample. Same seed + same input = byte-identical sample plan.
 *
 *   proofloop transfer-check gate --capability <file> --browser <file>
 *       [--min-agreement 0.9] [--min-overlap 5] [--model <label>]
 *       [--allow-no-failure-overlap]
 *     Joins the two lanes on taskId+model and computes agreement over the
 *     paired set. Exit 0 = agreed (prints the doctrine claim line, which is
 *     deliberately NOT an "all tasks browser-verified" claim); exit 1 =
 *     diverged (per-pair direction-labeled table); exit 2 = unusable
 *     (unreadable inputs, overlap below minimum, or cherry-pick guard).
 *     Never exits 0 on zero evidence.
 *
 * Accepted lane inputs (auto-detected, fail-closed):
 *   - a receipts JSON array: [{ taskId, model, family?, pass }]
 *     (unknown keys warn; missing required fields reject; duplicate
 *     taskId+model pairs reject);
 *   - a runner events ledger (runner.ts appends
 *     .proofloop/runner/runs/<runId>/ledger.jsonl): per-task verdicts are
 *     derived from `task_completed` events' data.status ("passed"/"failed").
 *     Retried tasks are legitimate under resume, so the LAST completed
 *     verdict per taskId wins. Ledger events carry no model, so the caller
 *     labels ledger-derived rows via --model; family is derived from the
 *     layered-plan task-id prefix ("capability.test" -> "capability").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const TRANSFER_SAMPLE_SCHEMA = "proofloop-transfer-sample-v1";

export type TransferLaneResult = {
  taskId: string;
  model: string;
  family: string;
  pass: boolean;
};

export type TransferLaneRead = {
  results: TransferLaneResult[];
  warnings: string[];
  source: "receipts" | "runner-ledger";
};

export type TransferSamplePair = {
  taskId: string;
  model: string;
  family: string;
  capabilityPass: boolean;
};

export type TransferSamplePlan = {
  schema: typeof TRANSFER_SAMPLE_SCHEMA;
  seed: string;
  pairs: TransferSamplePair[];
};

export type TransferDisagreementDirection = "capability-pass-browser-fail" | "capability-fail-browser-pass";

export const TRANSFER_DIRECTION_LABELS: Record<TransferDisagreementDirection, string> = {
  "capability-pass-browser-fail": "suspected harness shortcut or product-path break -- capability claim suspect",
  "capability-fail-browser-pass": "suspected harness bug or env gap -- capability lane under-reporting",
};

export type TransferDisagreement = {
  taskId: string;
  model: string;
  family: string;
  capabilityPass: boolean;
  browserPass: boolean;
  direction: TransferDisagreementDirection;
  label: string;
};

export type TransferGateEvaluation = {
  status: "agreed" | "diverged" | "unusable";
  /** Present when status === "unusable". */
  reason?: string;
  overlap: number;
  matches: number;
  agreementRatio: number;
  minAgreement: number;
  minOverlap: number;
  capabilityFailuresTotal: number;
  pairedCapabilityFailures: number;
  disagreements: TransferDisagreement[];
  warnings: string[];
};

const RECEIPT_KNOWN_KEYS: readonly string[] = ["taskId", "model", "family", "pass"];
const RUNNER_EVENT_SCHEMA = "proofloop-runner-event-v1";
const DEFAULT_PER_FAMILY = 5;
const DEFAULT_MIN_AGREEMENT = 0.9;
const DEFAULT_MIN_OVERLAP = 5;
/** Guard against float noise at exactly-threshold agreement (e.g. 9/10 vs 0.9). */
const AGREEMENT_EPSILON = 1e-12;

// ---------------------------------------------------------------------------
// lane readers (fail-closed: any surprise throws; the CLI maps throws to exit 2)
// ---------------------------------------------------------------------------

export function readTransferLaneResults(path: string, options: { ledgerModel?: string } = {}): TransferLaneRead {
  if (!existsSync(path)) throw new Error(`lane input not found: ${path}`);
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  if (raw.trimStart().startsWith("[")) return readReceiptsArray(raw, path);
  return readRunnerLedger(raw, path, options.ledgerModel);
}

function readReceiptsArray(raw: string, path: string): TransferLaneRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`receipts file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`receipts file ${path} must be a JSON array of { taskId, model, family?, pass }`);
  if (parsed.length === 0) throw new Error(`receipts file ${path} is an empty array -- zero evidence is unusable (fail-closed)`);

  const warnings: string[] = [];
  const seen = new Set<string>();
  const results = parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`receipts entry ${index} in ${path} must be an object { taskId, model, family?, pass }`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!RECEIPT_KNOWN_KEYS.includes(key)) {
        warnings.push(`receipts entry ${index} in ${path} has unknown key "${key}" (ignored; known keys: ${RECEIPT_KNOWN_KEYS.join(", ")})`);
      }
    }
    const taskId = record.taskId;
    if (typeof taskId !== "string" || !taskId.trim()) throw new Error(`receipts entry ${index} in ${path}: "taskId" (non-empty string) is required`);
    const model = record.model;
    if (typeof model !== "string" || !model.trim()) throw new Error(`receipts entry ${index} in ${path}: "model" (non-empty string) is required`);
    const pass = record.pass;
    if (typeof pass !== "boolean") throw new Error(`receipts entry ${index} in ${path}: "pass" (boolean) is required -- refusing to coerce ${JSON.stringify(pass)}`);
    let family = "default";
    if (record.family !== undefined) {
      if (typeof record.family !== "string" || !record.family.trim()) {
        throw new Error(`receipts entry ${index} in ${path}: "family" must be a non-empty string when present`);
      }
      family = record.family;
    }
    const pairKey = joinKey(taskId, model);
    if (seen.has(pairKey)) {
      throw new Error(`duplicate taskId+model pair in ${path}: "${taskId}" + "${model}" -- refusing to guess which verdict is real (fail-closed)`);
    }
    seen.add(pairKey);
    return { taskId, model, family, pass };
  });
  return { results, warnings, source: "receipts" };
}

function readRunnerLedger(raw: string, path: string, ledgerModel: string | undefined): TransferLaneRead {
  const warnings: string[] = [];
  const model = ledgerModel ?? "unspecified";
  if (!ledgerModel) {
    warnings.push(`runner ledger ${path}: no --model label given; ledger rows get model "unspecified" (pass --model <label> so gate joins line up)`);
  }
  const lines = raw.split(/\r?\n/);
  const verdicts = new Map<string, TransferLaneResult>();
  let sawLedgerEvent = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(
        `${path}:${index + 1}: not a receipts JSON array and not a parseable runner-ledger line -- accepted inputs are a receipts array [{taskId,model,family?,pass}] or a ${RUNNER_EVENT_SCHEMA} events ledger (fail-closed)`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path}:${index + 1}: ledger line must be a JSON object (fail-closed)`);
    }
    const event = parsed as Record<string, unknown>;
    if (event.schema !== RUNNER_EVENT_SCHEMA) {
      throw new Error(`${path}:${index + 1}: expected schema "${RUNNER_EVENT_SCHEMA}", got ${JSON.stringify(event.schema)} (fail-closed)`);
    }
    sawLedgerEvent = true;
    if (event.event !== "task_completed") continue;
    const taskId = event.taskId;
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error(`${path}:${index + 1}: task_completed event has no usable taskId (fail-closed; runner schema drift?)`);
    }
    const data = event.data;
    const status = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).status : undefined;
    if (status !== "passed" && status !== "failed") {
      throw new Error(
        `${path}:${index + 1}: task_completed data.status must be "passed" or "failed", got ${JSON.stringify(status)} (fail-closed; runner schema drift?)`,
      );
    }
    // Retries after crash/resume are legitimate runner behavior: last verdict wins.
    verdicts.set(taskId, { taskId, model, family: familyFromTaskId(taskId), pass: status === "passed" });
  }
  if (!sawLedgerEvent) {
    throw new Error(`${path}: no ${RUNNER_EVENT_SCHEMA} lines found -- accepted inputs are a receipts JSON array or a runner events ledger (fail-closed)`);
  }
  if (verdicts.size === 0) {
    throw new Error(`${path}: ledger contains no task_completed verdicts -- zero evidence is unusable (fail-closed)`);
  }
  return { results: [...verdicts.values()], warnings, source: "runner-ledger" };
}

/** Layered-plan task ids are "<lane>.<name>" (see layeredPlan.ts); the prefix is the natural family. */
function familyFromTaskId(taskId: string): string {
  const dot = taskId.indexOf(".");
  return dot > 0 ? taskId.slice(0, dot) : "default";
}

function joinKey(taskId: string, model: string): string {
  return `${taskId} ${model}`;
}

// ---------------------------------------------------------------------------
// deterministic stratified sampler
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit over the seed string; feeds the xorshift32 stream. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seedText: string): () => number {
  let state = fnv1a32(seedText) || 0x9e3779b9; // xorshift must not start at 0
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function byFamilyTaskModel(a: { family: string; taskId: string; model: string }, b: { family: string; taskId: string; model: string }): number {
  return a.family.localeCompare(b.family) || a.taskId.localeCompare(b.taskId) || a.model.localeCompare(b.model);
}

/**
 * Deterministic stratified sample of the capability lane for browser
 * certification. Same seed + same input = byte-identical plan (the per-family
 * PRNG stream is `fnv1a(seed|family)`, so adding a family never changes
 * another family's picks). If a family has capability failures, at least
 * ceil(perFamily/3) of its sample slots are failures (capped by how many
 * failures exist): failures must transfer too, or the failure path of the
 * harness is never checked against the product.
 */
export function buildTransferSample(capability: readonly TransferLaneResult[], options: { seed: string; perFamily?: number }): TransferSamplePlan {
  const seed = options.seed;
  if (typeof seed !== "string" || !seed.trim()) {
    throw new Error("sample requires --seed <string>; pass a commit SHA so the sample cannot be re-rolled or cherry-picked");
  }
  const perFamily = options.perFamily ?? DEFAULT_PER_FAMILY;
  if (!Number.isInteger(perFamily) || perFamily < 1) throw new Error("--per-family must be an integer >= 1");
  if (capability.length === 0) throw new Error("capability set is empty -- nothing to sample (fail-closed)");

  const byFamily = new Map<string, TransferLaneResult[]>();
  for (const result of capability) {
    const list = byFamily.get(result.family) ?? [];
    list.push(result);
    byFamily.set(result.family, list);
  }

  const pairs: TransferSamplePair[] = [];
  for (const family of [...byFamily.keys()].sort()) {
    const members = [...(byFamily.get(family) ?? [])].sort(byFamilyTaskModel);
    const rand = seededRandom(`${seed}|${family}`);
    const failures = members.filter((member) => !member.pass);
    const slots = Math.min(perFamily, members.length);
    const failureSlots = failures.length === 0 ? 0 : Math.min(Math.ceil(perFamily / 3), failures.length, slots);

    const picked = new Set<TransferLaneResult>();
    for (const failure of shuffled(failures, rand).slice(0, failureSlots)) picked.add(failure);
    const rest = members.filter((member) => !picked.has(member));
    for (const member of shuffled(rest, rand).slice(0, slots - picked.size)) picked.add(member);

    for (const member of [...picked].sort(byFamilyTaskModel)) {
      pairs.push({ taskId: member.taskId, model: member.model, family: member.family, capabilityPass: member.pass });
    }
  }
  pairs.sort(byFamilyTaskModel);
  return { schema: TRANSFER_SAMPLE_SCHEMA, seed, pairs };
}

// ---------------------------------------------------------------------------
// agreement gate
// ---------------------------------------------------------------------------

export function evaluateTransferGate(
  capability: readonly TransferLaneResult[],
  browser: readonly TransferLaneResult[],
  options: { minAgreement?: number; minOverlap?: number; allowNoFailureOverlap?: boolean } = {},
): TransferGateEvaluation {
  const minAgreement = options.minAgreement ?? DEFAULT_MIN_AGREEMENT;
  if (!Number.isFinite(minAgreement) || minAgreement < 0 || minAgreement > 1) {
    throw new Error("--min-agreement must be a number between 0 and 1");
  }
  const requestedMinOverlap = options.minOverlap ?? DEFAULT_MIN_OVERLAP;
  if (!Number.isInteger(requestedMinOverlap)) throw new Error("--min-overlap must be an integer");
  // Never certify zero evidence, no matter what the caller asked for.
  const minOverlap = Math.max(1, requestedMinOverlap);

  const capabilityByKey = new Map<string, TransferLaneResult>();
  for (const result of capability) capabilityByKey.set(joinKey(result.taskId, result.model), result);

  const paired: Array<{ cap: TransferLaneResult; browser: TransferLaneResult }> = [];
  for (const browserResult of [...browser].sort(byFamilyTaskModel)) {
    const cap = capabilityByKey.get(joinKey(browserResult.taskId, browserResult.model));
    if (cap) paired.push({ cap, browser: browserResult });
  }

  const overlap = paired.length;
  const capabilityFailuresTotal = capability.filter((result) => !result.pass).length;
  const pairedCapabilityFailures = paired.filter((pair) => !pair.cap.pass).length;
  const matches = paired.filter((pair) => pair.cap.pass === pair.browser.pass).length;
  const agreementRatio = overlap === 0 ? 0 : matches / overlap;
  const disagreements: TransferDisagreement[] = paired
    .filter((pair) => pair.cap.pass !== pair.browser.pass)
    .map((pair) => {
      const direction: TransferDisagreementDirection = pair.cap.pass ? "capability-pass-browser-fail" : "capability-fail-browser-pass";
      return {
        taskId: pair.cap.taskId,
        model: pair.cap.model,
        family: pair.cap.family,
        capabilityPass: pair.cap.pass,
        browserPass: pair.browser.pass,
        direction,
        label: TRANSFER_DIRECTION_LABELS[direction],
      };
    });

  const base = {
    overlap,
    matches,
    agreementRatio,
    minAgreement,
    minOverlap,
    capabilityFailuresTotal,
    pairedCapabilityFailures,
    disagreements,
    warnings: [] as string[],
  };

  if (overlap < minOverlap) {
    return {
      status: "unusable",
      reason:
        overlap === 0
          ? "zero paired taskId+model verdicts between the capability and browser lanes -- zero evidence can never certify agreement"
          : `paired overlap ${overlap} is below --min-overlap ${minOverlap} -- too little evidence to certify agreement`,
      ...base,
    };
  }

  if (capabilityFailuresTotal > 0 && pairedCapabilityFailures === 0) {
    if (!options.allowNoFailureOverlap) {
      return {
        status: "unusable",
        reason:
          `cherry-pick guard: the capability set contains ${capabilityFailuresTotal} failure(s) but the browser paired set contains ZERO of them; ` +
          "a sample that dodges every failure cannot certify the failure path (pass --allow-no-failure-overlap to override with a loud warning)",
        ...base,
      };
    }
    base.warnings.push(
      `WARNING: --allow-no-failure-overlap: the capability set contains ${capabilityFailuresTotal} failure(s) but the browser paired set includes NONE of them. ` +
        "Harness shortcuts on the failure path remain UNVERIFIED; this agreement claim is weaker than the standard transfer gate.",
    );
  }

  return {
    status: agreementRatio >= minAgreement - AGREEMENT_EPSILON ? "agreed" : "diverged",
    ...base,
  };
}

/**
 * The doctrine claim line printed on exit 0 -- deliberately scoped language.
 * The browser lane certified a stratified sample, so the only honest claim is
 * "capability lane verified + transfer verified on N seeded pairs", never
 * "all tasks browser-verified".
 */
export function transferClaimLine(evaluation: TransferGateEvaluation): string {
  return (
    `Capability verified through the live agent harness; production browser path verified by stratified UI certification ` +
    `(agreement ${formatPercent(evaluation.agreementRatio)}% on ${evaluation.overlap} seeded pairs including ` +
    `${evaluation.pairedCapabilityFailures} capability-failures). This is NOT an all-tasks-browser-verified claim.`
  );
}

function formatPercent(ratio: number): string {
  const rounded = Math.round(ratio * 1000) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type TransferCheckIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

function strOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function intOption(value: string | boolean | undefined, flag: string): number | undefined {
  const raw = strOption(value);
  if (raw === undefined) {
    if (value === true) throw new Error(`${flag} requires a value`);
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer, got ${JSON.stringify(raw)}`);
  return parsed;
}

function floatOption(value: string | boolean | undefined, flag: string): number | undefined {
  const raw = strOption(value);
  if (raw === undefined) {
    if (value === true) throw new Error(`${flag} requires a value`);
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number, got ${JSON.stringify(raw)}`);
  return parsed;
}

function resolveLane(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

/**
 * `proofloop transfer-check sample|gate`. Exit codes:
 *   sample: 0 wrote/printed the plan, 2 unusable input or bad flags.
 *   gate:   0 agreed, 1 diverged, 2 unusable (fail-closed).
 */
export function runTransferCheckCommand(
  sub: string | undefined,
  options: Record<string, string | boolean>,
  root: string,
  io: TransferCheckIo = {},
): number {
  const log = io.log ?? console.log;
  const logError = io.logError ?? console.error;
  try {
    if (sub === "sample") return runSample(options, root, log, logError);
    if (sub === "gate") return runGateSub(options, root, log, logError);
    logError("proofloop transfer-check: expected `sample` or `gate`.");
    return 2;
  } catch (error) {
    logError(`proofloop transfer-check: ${error instanceof Error ? error.message : String(error)} (fail-closed, exit 2)`);
    return 2;
  }
}

function runSample(options: Record<string, string | boolean>, root: string, log: (line: string) => void, logError: (line: string) => void): number {
  const capabilityPath = strOption(options.capability);
  if (!capabilityPath) throw new Error("sample requires --capability <file>");
  const seed = strOption(options.seed);
  if (!seed) throw new Error("sample requires --seed <string>; pass a commit SHA so the sample cannot be re-rolled or cherry-picked");
  const perFamily = intOption(options["per-family"], "--per-family");

  const lane = readTransferLaneResults(resolveLane(root, capabilityPath), { ...(strOption(options.model) !== undefined ? { ledgerModel: strOption(options.model)! } : {}) });
  for (const warning of lane.warnings) logError(`proofloop transfer-check: warning: ${warning}`);

  const plan = buildTransferSample(lane.results, { seed, ...(perFamily !== undefined ? { perFamily } : {}) });
  const serialized = JSON.stringify(plan, null, 2);
  const outPath = strOption(options.out);
  if (outPath) {
    const resolved = resolveLane(root, outPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${serialized}\n`, "utf8");
    logError(`proofloop transfer-check: wrote sample plan to ${resolved}`);
  }
  log(serialized);
  return 0;
}

function runGateSub(options: Record<string, string | boolean>, root: string, log: (line: string) => void, logError: (line: string) => void): number {
  const capabilityPath = strOption(options.capability);
  const browserPath = strOption(options.browser);
  if (!capabilityPath || !browserPath) throw new Error("gate requires --capability <file> and --browser <file>");
  const minAgreement = floatOption(options["min-agreement"], "--min-agreement");
  const minOverlap = intOption(options["min-overlap"], "--min-overlap");
  const ledgerModel = strOption(options.model);

  const capability = readTransferLaneResults(resolveLane(root, capabilityPath), { ...(ledgerModel !== undefined ? { ledgerModel } : {}) });
  const browser = readTransferLaneResults(resolveLane(root, browserPath), { ...(ledgerModel !== undefined ? { ledgerModel } : {}) });
  for (const warning of [...capability.warnings, ...browser.warnings]) logError(`proofloop transfer-check: warning: ${warning}`);

  const evaluation = evaluateTransferGate(capability.results, browser.results, {
    ...(minAgreement !== undefined ? { minAgreement } : {}),
    ...(minOverlap !== undefined ? { minOverlap } : {}),
    allowNoFailureOverlap: options["allow-no-failure-overlap"] === true,
  });

  if (evaluation.status === "unusable") {
    logError(`proofloop transfer-check: UNUSABLE -- ${evaluation.reason} (fail-closed, exit 2)`);
    return 2;
  }

  for (const warning of evaluation.warnings) log(`proofloop transfer-check: ${warning}`);

  if (evaluation.status === "diverged") {
    log(
      `proofloop transfer-check: DIVERGED -- agreement ${formatPercent(evaluation.agreementRatio)}% < required ` +
        `${formatPercent(evaluation.minAgreement)}% on ${evaluation.overlap} paired verdicts.`,
    );
    log("  disagreements:");
    for (const disagreement of evaluation.disagreements) {
      log(
        `    - ${disagreement.taskId} [${disagreement.model} / ${disagreement.family}] ` +
          `capability=${disagreement.capabilityPass ? "pass" : "fail"} browser=${disagreement.browserPass ? "pass" : "fail"} -> ${disagreement.label}`,
      );
    }
    log("  Do not publish the capability-lane score until each divergence is root-caused.");
    return 1;
  }

  log(`proofloop transfer-check: AGREED -- ${evaluation.matches}/${evaluation.overlap} paired verdicts match.`);
  log(transferClaimLine(evaluation));
  return 0;
}
