import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [join(root, "site-src", "webcontainer-demo.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  sourcemap: false,
  outfile: join(root, "public", "webcontainer-demo.bundle.js"),
});

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(
  join(root, "node_modules", "@xterm", "xterm", "css", "xterm.css"),
  join(root, "public", "xterm.css"),
);

console.log("built public/webcontainer-demo.bundle.js + public/xterm.css");
