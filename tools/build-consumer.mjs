// Builds dist/ for the public consumer site from an explicit allow-list.
// Anything not listed here cannot ship. The build fails if dist/ ends up with a file that is not allowed.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");

// Files and folders copied as-is.
const ALLOW = [
  "index.html", "404.html",
  "agamim-logo.png", "agamim-emblem.png", "pakar-logo.svg",
  "hero.css",
  "theme-oref.css", "theme-oref-2.css", "theme-oref.js",
  "datasets-overlay.js", "search-suggest.js",
  "assets", "data/consumer", "data/meta.json", "data/personas.json",
];

// Script tags removed from index.html in the consumer build (admin tooling and login).
const STRIP_SCRIPTS = ["onboarding.js", "admin-drawer.js", "admin-actions.js", "login.js", "analytics.js", "analytics-entry.js", "analytics-journey.js"];

// Patterns that must never appear in dist/.
const FORBIDDEN = [/^onboarding\./, /^add-dataset\./, /^admin-/, /^login\./, /^server\//, /^tests?\//, /^tools\//, /^infra\//, /^data\/staging\//,
  /\.(env|tfstate|tfvars|ndjson|md|sqlite|db)$/, /(^|\/)\./, /^package(-lock)?\.json$/];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const item of ALLOW) cpSync(join(ROOT, item), join(DIST, item), { recursive: true });

// Remove the stripped script tags from every HTML page.
for (const page of ["index.html", "404.html"]) {
  const file = join(DIST, page);
  let html = readFileSync(file, "utf8");
  for (const s of STRIP_SCRIPTS) {
    html = html.replace(new RegExp(`\\s*<script[^>]*src="\\./${s.replace(".", "\\.")}[^"]*"[^>]*></script>`, "g"), "");
  }
  writeFileSync(file, html);
}

// The first-visit profile form (onboarding) is not part of the public site. Remove its stylesheet link too.
for (const page of ["index.html", "404.html"]) {
  const file = join(DIST, page);
  writeFileSync(file, readFileSync(file, "utf8").replace(/\s*<link[^>]*href="\.\/onboarding\.css[^"]*"[^>]*>/g, ""));
}

// No third-party analytics: visitor data must stay in GCP. Remove Amplitude (script + inline init).
for (const page of ["index.html", "404.html"]) {
  const file = join(DIST, page);
  let html = readFileSync(file, "utf8");
  html = html.replace(/\s*<script[^>]*src="https:\/\/cdn\.amplitude\.com[^"]*"[^>]*><\/script>/g, "");
  html = html.replace(/\s*<script>(?:(?!<\/script>)[\s\S])*amplitude\.init(?:(?!<\/script>)[\s\S])*<\/script>/g, "");
  writeFileSync(file, html);
}

// Public mode: no sign-in in this phase. Copy the script and load it first, before the app starts.
cpSync(join(ROOT, "tools/public-mode.js"), join(DIST, "public-mode.js"));
{
  const file = join(DIST, "index.html");
  const html = readFileSync(file, "utf8");
  if (!/<head[^>]*>/i.test(html)) { console.error("index.html has no <head>"); process.exit(1); }
  writeFileSync(file, html.replace(/<head[^>]*>/i, (m) => `${m}\n    <script src="./public-mode.js"></script>`));
}

// Verify. Third-party analytics must not be anywhere in the output.
for (const f of walk(DIST)) {
  if (!/\.(html|js|css|json)$/.test(f)) continue;
  if (/amplitude|mixpanel/i.test(readFileSync(f, "utf8"))) { console.error(`Consumer build FAILED: third-party analytics found in ${relative(DIST, f)}`); process.exit(1); }
}
const files = walk(DIST).map((f) => relative(DIST, f));
const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
const leftover = ["index.html", "404.html"].flatMap((p) =>
  [...STRIP_SCRIPTS, "onboarding.css"].filter((s) => readFileSync(join(DIST, p), "utf8").includes(s)).map((s) => `${p} still references ${s}`));
if (!files.includes("index.html")) bad.push("index.html missing");
if (!readFileSync(join(DIST, "index.html"), "utf8").includes("./public-mode.js")) bad.push("index.html does not load public-mode.js");
if (bad.length || leftover.length) {
  console.error("Consumer build FAILED:\n" + [...bad, ...leftover].map((b) => "  " + b).join("\n"));
  process.exit(1);
}
console.log(`Consumer build OK: ${files.length} files in dist/`);
