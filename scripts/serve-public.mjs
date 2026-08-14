/**
 * The one local server this repo measures itself through.
 *
 * `public/` is a static Vercel deploy with `api/**` as functions, so there is no
 * `npm run dev` that starts the landing page — that absence is why Wave 1's
 * browser numbers were taken through a throwaway harness and lost. Extracted
 * here from scripts/browser-proof.mjs when a second measurement (the Lighthouse
 * and axe audits) needed the same surface: two probes measuring two different
 * servers would not be measuring the same page.
 *
 * Routes exactly as Vercel does with `cleanUrls: true` — /api/hosted/submit
 * resolves api/hosted/submit.js — and serves everything else from public/.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function apiHandlerPath(pathname) {
  if (!pathname.startsWith("/api/")) return null;
  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (rel.includes("..") || rel.split("/").some((part) => part.startsWith("_"))) return null;
  const file = join(ROOT, `${rel}.js`);
  return existsSync(file) ? file : null;
}

/**
 * Starts the page on 127.0.0.1:<port>. Rejects if the port is taken: a probe
 * that silently measures somebody else's dev server proves nothing.
 *
 * Returns { base, responses, close } — `responses` accumulates every
 * { method, path, status } the server answered, which is condition 9's evidence.
 */
export async function startPublicServer(port) {
  if (!existsSync(join(ROOT, "dist", "hosted.js"))) {
    throw new Error("dist/ is missing: run `npm run build` first (api/** handlers require dist/hosted.js).");
  }
  const responses = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.on("finish", () => responses.push({ method: req.method, path: url.pathname, status: res.statusCode }));
    const handlerPath = apiHandlerPath(url.pathname);
    if (handlerPath) {
      req.query = Object.fromEntries(url.searchParams);
      try {
        await require(handlerPath)(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
      }
      return;
    }
    const file = join(ROOT, "public", url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
    if (!file.startsWith(join(ROOT, "public")) || !existsSync(file)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", MIME[extname(file)] || "application/octet-stream");
    res.end(readFileSync(file));
  });

  await new Promise((ok, fail) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        fail(new Error(`port ${port} is already in use — another server would be measured instead of this one. Re-run with --port <free port>.`));
        return;
      }
      fail(error);
    });
    server.listen(port, "127.0.0.1", ok);
  });

  return {
    base: `http://127.0.0.1:${port}`,
    responses,
    close: () => new Promise((ok) => server.close(ok)),
  };
}
