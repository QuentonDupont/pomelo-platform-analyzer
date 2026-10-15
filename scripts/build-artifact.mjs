// Build the claude.ai Artifact: one self-contained HTML page (inline CSS + bundled React app).
// Usage: node scripts/build-artifact.mjs  →  artifact/dist/pomelo-dashboard.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "artifact", "dist");
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, "artifact", "main.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  jsx: "automatic",
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
});
// a literal "</script" inside the bundle would end the inline script early
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = ["app/globals.css", "app/viz.css"].map((f) => readFileSync(path.join(root, f), "utf8")).join("\n");

const html = `<title>Pomelo Bounce &amp; Release Impact</title>
<style>
${css}
.boot { max-width: 1320px; margin: 0 auto; padding: 48px 16px; color: var(--muted); font-size: 14px; }
.boot strong { display: block; color: var(--ink); font-size: 18px; margin-bottom: 6px; }
</style>
<div id="root"><div class="boot" role="status"><strong>Pomelo bounce rate &amp; release impact</strong>Loading the saved dashboard data — web, iOS and Android sessions, orders and production releases…</div></div>
<script>${js}</script>
`;
const file = path.join(out, "pomelo-dashboard.html");
writeFileSync(file, html);
console.log(`${path.relative(root, file)} ${(html.length / 1024).toFixed(0)} KiB`);
