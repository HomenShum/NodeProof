/**
 * Zero-dependency detectors for the portable Proof Loop package.
 *
 * detectApp   -- what kind of app is in this repo (package.json deps or
 *                python markers); used by `proofloop init`.
 * detectWorkflowHint -- a best-effort one-liner for the "intended workflow"
 *                config field, from package.json name/description.
 * detectWorkers -- which coding-agent CLIs are on PATH (claude, codex); used
 *                by `proofloop doctor`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type AppDetection = {
  app: string;
  /** Human-readable evidence for why we picked this app. */
  reason: string;
};

function readPackageJson(root: string): Record<string, unknown> | undefined {
  const path = join(resolve(root), "package.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const section = pkg[field];
    if (section && typeof section === "object" && !Array.isArray(section)) {
      for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
        if (typeof version === "string") out[name] = version;
      }
    }
  }
  return out;
}

/**
 * Detect the app framework. Order matters: Next.js and Vite are more specific
 * than a bare React dependency, so they win. Python markers are checked when
 * there is no informative package.json.
 */
export function detectApp(root: string): AppDetection {
  const resolved = resolve(root);
  const pkg = readPackageJson(resolved);
  if (pkg) {
    const deps = allDeps(pkg);
    if (deps.next) return { app: "Next.js", reason: "package.json depends on next" };
    if (deps.vite || deps["@vitejs/plugin-react"]) return { app: "Vite", reason: "package.json depends on vite" };
    if (deps.react || deps["react-dom"]) return { app: "React", reason: "package.json depends on react" };
    // A package.json with a start/dev script but none of the above.
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    if (typeof scripts.dev === "string" || typeof scripts.start === "string") {
      return { app: "Node.js app", reason: "package.json has a dev/start script" };
    }
  }

  // Python markers.
  if (existsSync(join(resolved, "pyproject.toml"))) {
    return { app: "FastAPI/Python", reason: "pyproject.toml present" };
  }
  if (existsSync(join(resolved, "requirements.txt"))) {
    return { app: "FastAPI/Python", reason: "requirements.txt present" };
  }
  if (existsSync(join(resolved, "manage.py"))) {
    return { app: "Django/Python", reason: "manage.py present" };
  }

  return { app: "generic web app", reason: "no framework markers detected" };
}

/**
 * Best-effort one-line workflow hint from package.json description/name.
 * Empty string when nothing informative is available -- the user fills it in.
 */
export function detectWorkflowHint(root: string): string {
  const pkg = readPackageJson(root);
  if (!pkg) return "";
  const description = typeof pkg.description === "string" ? pkg.description.trim() : "";
  if (description) return `Prove the core workflow of: ${description}`;
  const name = typeof pkg.name === "string" ? pkg.name.trim() : "";
  if (name) return `Prove the core user workflow of ${name} works end-to-end in the live app.`;
  return "";
}

export type WorkerDetection = {
  name: string;
  onPath: boolean;
  /** Resolved path when found (best-effort). */
  location?: string;
};

/** The coding-agent worker CLIs the package knows how to talk about. */
export const KNOWN_WORKERS = ["claude", "codex"] as const;

/**
 * Detect which worker CLIs are on PATH. Uses `where` on Windows and `which`
 * elsewhere; both are cross-platform-safe via spawnSync (no shell).
 */
export function detectWorkers(workers: readonly string[] = KNOWN_WORKERS): WorkerDetection[] {
  const isWindows = process.platform === "win32";
  const locator = isWindows ? "where" : "which";
  return workers.map((name) => {
    const result = spawnSync(locator, [name], { encoding: "utf8", timeout: 10_000 });
    const stdout = (result.stdout ?? "").trim();
    const onPath = result.status === 0 && stdout.length > 0;
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return onPath && first ? { name, onPath, location: first } : { name, onPath: false };
  });
}

/** Is this directory inside a git working tree? */
export function isGitRepo(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: resolve(root),
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 && (result.stdout ?? "").trim() === "true";
}

/** Is git itself available on PATH? */
export function isGitAvailable(): boolean {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0;
}
