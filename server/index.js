"use strict";
// One origin: the static site, plus /data/* generated from the database, plus a small admin API.
// Run:  node server/index.js   (PORT, SITE_DIR, SQLITE_FILE, DB_DRIVER, ADMIN_KEY are optional)
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { open, migrate } = require("./db");
const { seed } = require("./seed");
const { seedSource } = require("./source");
const { harvest, addSource } = require("./harvest");
const { buildFile } = require("./materialize");
const { readState, writeState, Invalid } = require("./state");
const { checkLogin, ensureUsers, makeToken, readToken, readCookie, cookieHeader } = require("./users");
const { startNightly } = require("./schedule");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json"
};

// Never served: hidden files, tooling, tests, infrastructure code, the server itself and the data folder
// (data comes from the database, not from files).
const BLOCKED_DIRS = new Set(["node_modules", "tests", "test-results", "playwright-report", "infra", "tools", "server", "data", "_site"]);
const BLOCKED_FILES = /(\.ndjson|\.md|\.env|\.tfstate|\.tfvars)$|^package(-lock)?\.json$|^playwright\.config\.js$|^amplitude-dashboard\.html$/;
const MAX_BODY = 2 * 1024 * 1024;

function isPublic(rel) {
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((p) => p.startsWith("."))) return false;
  if (parts.slice(0, -1).some((p) => BLOCKED_DIRS.has(p))) return false;
  if (parts.length === 1 && BLOCKED_DIRS.has(parts[0])) return false;
  return !BLOCKED_FILES.test(parts[parts.length - 1]);
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "same-origin", ...extra });
  res.end(body);
}
const json = (res, status, value) => send(res, status, "application/json; charset=utf-8", JSON.stringify(value), { "cache-control": "no-store" });

// State is embedded in a <script>: make sure no value can close the tag or break the line.
function embed(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// Every HTML page gets a marker and the shared state, so the front end knows a back end exists
// and starts with the same data in every browser, without an extra request.
async function withState(db, html, { session, requireLogin }) {
  const at = html.search(/<head[^>]*>/i);
  if (at < 0) return html;
  const end = html.indexOf(">", at) + 1;
  let inject = '<meta name="agamim-api" content="1">';
  if (requireLogin) {
    inject += `<script>window.__AGAMIM_LOGIN_REQUIRED=true;window.__AGAMIM_SESSION=${embed(session)};</script>`;
    inject += '<script src="./login.js"></script>';
  }
  // Without a session the shared state is withheld, like the data.
  if (!requireLogin || session) inject += `<script>window.__AGAMIM_STATE=${embed(await readState(db))};</script>`;
  return html.slice(0, end) + inject + html.slice(end);
}

// Reads at most MAX_BODY bytes. A bigger body is drained without being stored, so the client can still
// read the 413 answer; past HARD_CAP the connection is dropped.
const HARD_CAP = 20 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > HARD_CAP) { req.destroy(); reject(Object.assign(new Error("Body too large"), { status: 413 })); return; }
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => (size > MAX_BODY ? reject(Object.assign(new Error("Body too large"), { status: 413 })) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

// Admin key: a shared secret in the x-admin-key header. A stopgap until real sign-in exists.
function makeAuth(adminKey) {
  const failures = new Map(); // ip -> [timestamps]
  const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
  const expected = adminKey ? digest(adminKey) : null;
  return function check(req) {
    if (!expected) return { ok: false, status: 503, error: "Admin key is not configured on the server" };
    if (!req.headers["x-admin-key"]) return { ok: false, status: 401, error: "Wrong or missing admin key" };
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= 10) return { ok: false, status: 429, error: "Too many wrong keys, wait a minute" };
    const given = digest(req.headers["x-admin-key"] || "");
    if (crypto.timingSafeEqual(given, expected)) return { ok: true, actor: "admin-key" };
    recent.push(now);
    failures.set(ip, recent);
    return { ok: false, status: 401, error: "Wrong or missing admin key" };
  };
}

function createServer({
  db, siteDir,
  adminKey = process.env.ADMIN_KEY || "",
  sessionSecret = process.env.SESSION_SECRET || "",
  requireLogin = process.env.REQUIRE_LOGIN === "1"
}) {
  const root = path.resolve(siteDir);
  const keyAuth = makeAuth(adminKey);
  const loginFailures = new Map(); // ip -> [timestamps]
  const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const isSecure = (req) => req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted;
  const currentSession = (req) => readToken(sessionSecret, readCookie(req));
  // A browser that sends an Origin must be talking from this site (blocks cross-site form posts).
  const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

  // Who may change things: a signed-in admin, or the shared admin key (scripts and tests).
  function auth(req) {
    const s = currentSession(req);
    if (s && s.role === "admin") return sameOrigin(req) ? { ok: true, actor: `user:${s.userId}` } : { ok: false, status: 403, error: "Cross-site request refused" };
    const k = keyAuth(req);
    if (k.ok) return k;
    return s ? { ok: false, status: 403, error: "Admin role required" } : k;
  }
  // Who may read the catalog when login is required: any signed-in user, or the admin key.
  function canRead(req) {
    if (!requireLogin) return true;
    if (currentSession(req)) return true;
    return !!req.headers["x-admin-key"] && keyAuth(req).ok;
  }

  async function api(req, res, pathname) {
    if (pathname === "/api/health" && req.method === "GET") {
      await db.get("SELECT 1 AS ok");
      return json(res, 200, { ok: true, driver: db.driver });
    }
    if (pathname === "/api/login" && req.method === "POST") {
      if (!sessionSecret) return json(res, 503, { error: "Sign-in is not configured on the server" });
      const ip = ipOf(req);
      const now = Date.now();
      const recent = (loginFailures.get(ip) || []).filter((x) => now - x < 60000);
      if (recent.length >= 10) return json(res, 429, { error: "Too many attempts, wait a minute" });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Body must be valid JSON" }); }
      const okShape = body && typeof body.userId === "string" && typeof body.password === "string" && body.userId.length <= 200 && body.password.length <= 500;
      const user = okShape ? await checkLogin(db, body.userId, body.password) : null;
      if (!user) {
        recent.push(now);
        loginFailures.set(ip, recent);
        await db.run("INSERT INTO audit (actor, action, entity) VALUES (?, ?, ?)", [String(okShape ? body.userId : "?").slice(0, 100), "login.failed", "session"]);
        return json(res, 401, { error: "Wrong user ID or password" });
      }
      loginFailures.delete(ip);
      await db.run("INSERT INTO audit (actor, action, entity) VALUES (?, ?, ?)", [user.userId, "login", "session"]);
      res.setHeader("set-cookie", cookieHeader(makeToken(sessionSecret, user), isSecure(req)));
      return json(res, 200, user);
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      res.setHeader("set-cookie", cookieHeader("", isSecure(req), true));
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/me" && req.method === "GET") {
      const s = currentSession(req);
      return s ? json(res, 200, s) : json(res, 401, { error: "Not signed in" });
    }
    if (pathname === "/api/state" && req.method === "GET") {
      if (!canRead(req)) return json(res, 401, { error: "Sign in first" });
      return json(res, 200, await readState(db));
    }

    let m = /^\/api\/state\/([a-z]+)$/.exec(pathname);
    if (m && req.method === "PUT") {
      const who = auth(req);
      if (!who.ok) return json(res, who.status, { error: who.error });
      let value;
      try { value = JSON.parse(await readBody(req)); } catch (err) {
        return json(res, err.status || 400, { error: err.status === 413 ? "Body too large" : "Body must be valid JSON" });
      }
      try { return json(res, 200, await writeState(db, m[1], value, who.actor)); }
      catch (err) { if (err instanceof Invalid) return json(res, 400, { error: err.message }); throw err; }
    }

    if (pathname === "/api/admin/harvest" && req.method === "POST") {
      const who = auth(req);
      if (!who.ok) return json(res, who.status, { error: who.error });
      return json(res, 200, await harvest(db));
    }
    return json(res, 404, { error: "Not found" });
  }

  return http.createServer(async (req, res) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); }
      catch { return send(res, 400, "text/plain", "Bad request"); }

      if (pathname.startsWith("/api/")) return await api(req, res, pathname);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "Method not allowed");

      if (pathname.startsWith("/data/")) {
        if (!canRead(req)) return json(res, 401, { error: "Sign in first" });
        const built = await buildFile(db, pathname.slice("/data/".length));
        if (!built) return send(res, 404, "text/plain", "Not found");
        return send(res, 200, built.type, built.body, { "cache-control": "no-cache" });
      }

      let rel = pathname.replace(/^\/+/, "");
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) || !isPublic(path.relative(root, file).split(path.sep).join("/"))) {
        return notFound(res, root);
      }
      let stat;
      try { stat = fs.statSync(file); } catch { return notFound(res, root); }
      if (!stat.isFile()) return notFound(res, root);
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      if (req.method === "HEAD") return send(res, 200, type, "", { "cache-control": "no-cache" });
      let body = fs.readFileSync(file);
      if (ext === ".html") body = await withState(db, body.toString("utf8"), { session: currentSession(req), requireLogin });
      return send(res, 200, type, body, { "cache-control": "no-cache" });
    } catch (err) {
      console.error(err);
      return send(res, err.status || 500, "text/plain", err.status === 413 ? "Body too large" : "Server error");
    }
  });
}

function notFound(res, root) {
  const page = path.join(root, "404.html");
  if (fs.existsSync(page)) return send(res, 404, "text/html; charset=utf-8", fs.readFileSync(page));
  return send(res, 404, "text/plain", "Not found");
}

async function main() {
  const db = await open();
  await migrate(db);
  const siteDir = process.env.SITE_DIR || path.join(__dirname, "..");
  const dataDir = path.join(siteDir, "data");
  // Gold database (loaded by Azure Data Factory), read by the harvester so its tables can be registered.
  if (process.env.GOLD_DATABASE) {
    try { addSource({ db: await open({ database: process.env.GOLD_DATABASE }), schema: "dbo", label: "gold" }); }
    catch (err) { console.error("Gold database not reachable (harvest skips it):", err); }
  }
  const hasData = await db.get("SELECT COUNT(*) AS n FROM repository");
  if (!hasData.n) console.log("Seeded empty database:", JSON.stringify(await seed(db, dataDir)));
  // The catalog data is already served; a problem with the source tables or the harvest is logged and the
  // site stays up. POST /api/admin/harvest can retry it.
  try {
    console.log("Source tables:", JSON.stringify(await seedSource(db, dataDir)));
    console.log("Harvest:", JSON.stringify(await harvest(db)));
  } catch (err) {
    console.error("Source tables or harvest failed at startup (site keeps running):", err);
  }
  try { console.log("Accounts:", JSON.stringify(await ensureUsers(db))); } catch (err) { console.error("Accounts setup failed:", err); }
  const port = Number(process.env.PORT || 8080);
  createServer({ db, siteDir }).listen(port, () => console.log(`Listening on http://localhost:${port} (db: ${db.driver})`));
  // Nightly harvest. HARVEST_AT=off turns it off; a harvest already started in the last 30 minutes is not repeated.
  if (String(process.env.HARVEST_AT || "02:00").toLowerCase() !== "off") {
    startNightly({
      at: process.env.HARVEST_AT || "02:00",
      timeZone: process.env.HARVEST_TZ || "Asia/Jerusalem",
      run: async () => {
        const last = await db.get("SELECT MAX(started_at) AS s FROM harvest_run");
        if (last && last.s && Date.now() - new Date(last.s).getTime() < 30 * 60 * 1000) { console.log("Nightly harvest skipped: one just ran"); return; }
        console.log("Nightly harvest:", JSON.stringify(await harvest(db)));
      }
    });
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { createServer, isPublic };
