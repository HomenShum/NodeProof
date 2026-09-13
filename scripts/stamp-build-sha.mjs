/**
 * Stamps exactly one <meta name="proofloop-build-sha" ...> into public/index.html at build
 * time, adapted from node-foyer's vite.config.ts foyer-build-sha plugin (there is no bundler
 * here — public/ is a static Vercel deploy — so this runs as a `npm run build` step instead
 * of a Vite transform).
 *
 * Precedence: VERCEL_GIT_COMMIT_SHA, then GITHUB_SHA, then `git rev-parse HEAD`, else
 * "unavailable" (non-strict, matching NodeVoice's build-sha plugin: no gate here depends on
 * this tag existing, so a git-less build environment ships "unavailable" rather than failing).
 *
 * Idempotent: strips any previously stamped tag before inserting the new one, so re-running
 * `npm run build` (as `pretest` does) never produces a duplicate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INDEX_HTML = resolve(ROOT, "public", "index.html");
const BUILD_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const META_TAG_RE = /\n?\s*<meta name="proofloop-build-sha"[^>]*>\r?\n?/gu;

export function resolveBuildSha() {
  for (const value of [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GITHUB_SHA]) {
    const sha = value?.trim().toLowerCase();
    if (sha && BUILD_SHA_PATTERN.test(sha)) return sha;
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      cwd: ROOT,
    }).trim();
    if (BUILD_SHA_PATTERN.test(sha)) return sha;
  } catch {
    // fall through to unavailable
  }
  return "unavailable";
}

export function stamp(sha, html) {
  const provenance = sha === "unavailable" ? "unavailable" : "commit";
  const tag = `    <meta name="proofloop-build-sha" content="${sha}" data-provenance="${provenance}" />\n`;
  const stripped = html.replace(META_TAG_RE, "\n");
  return stripped.replace("</head>", `${tag}  </head>`);
}

function main() {
  const sha = resolveBuildSha();
  const html = readFileSync(INDEX_HTML, "utf8");
  writeFileSync(INDEX_HTML, stamp(sha, html));
  console.log(`stamp-build-sha: wrote proofloop-build-sha=${sha} to public/index.html`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
