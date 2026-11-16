"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { open, migrate } = require("../db");
const { seed } = require("../seed");
const { createServer, isPublic } = require("../index");

const SITE = path.join(__dirname, "..", "..");

async function start() {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  await seed(db, path.join(SITE, "data"));
  const server = createServer({ db, siteDir: SITE });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
}

test("serves the site, the data and a health check", async () => {
  const s = await start();
  try {
    const home = await fetch(`${s.base}/`);
    assert.equal(home.status, 200);
    // Other sites may not frame the pages, but the site's own registration drawer does (same origin).
    assert.equal(home.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(await home.text(), /<title>/);

    const health = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(health.ok, true);

    const repos = await (await fetch(`${s.base}/data/consumer/repositories.json`)).json();
    assert.equal(repos.total, 3);

    const csv = await fetch(`${s.base}/data/consumer/layers__6452__sample.csv`);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    // Compare raw bytes: fetch().text() would strip the BOM the CSV starts with.
    const original = fs.readFileSync(path.join(SITE, "data/consumer/layers__6452__sample.csv"));
    assert.deepEqual(Buffer.from(await csv.arrayBuffer()), original);
    assert.deepEqual([...original.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    assert.equal((await fetch(`${s.base}/data/consumer/layers__999999.json`)).status, 404);
  } finally { await s.stop(); }
});

test("never serves private files or the raw data folder", async () => {
  const s = await start();
  try {
    for (const p of [
      "/.claude/settings.local.json", "/.gitignore", "/PROJECT-STATE.md", "/package.json", "/package-lock.json",
      "/server/index.js", "/server/schema.sqlite.sql", "/infra/main.tf", "/tests/data.spec.js", "/tools/mock-amplitude.mjs",
      "/mock-amplitude-events.ndjson", "/amplitude-dashboard.html", "/data/../package.json", "/%2e%2e/package.json",
      "/node_modules/", "/server"
    ]) {
      const r = await fetch(`${s.base}${p}`);
      assert.equal(r.status, 404, `${p} should be 404 but was ${r.status}`);
    }
    // Only the documented API routes exist; other methods and paths are refused.
    assert.equal((await fetch(`${s.base}/api/health`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${s.base}/index.html`, { method: "POST" })).status, 405);
  } finally { await s.stop(); }
});

test("isPublic allows site files and blocks private ones", () => {
  for (const ok of ["index.html", "theme-oref.js", "assets/index-SdISdr38.js", "agamim-logo.png", "404.html"]) assert.equal(isPublic(ok), true, ok);
  for (const no of [".claude/x", "data/meta.json", "server/db.js", "README.md", "a/.hidden", "x.ndjson"]) assert.equal(isPublic(no), false, no);
});
