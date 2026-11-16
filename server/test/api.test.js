"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { open, migrate } = require("../db");
const { seed } = require("../seed");
const { seedSource } = require("../source");
const { harvest } = require("../harvest");
const { createServer } = require("../index");

const SITE = path.join(__dirname, "..", "..");
const KEY = "test-admin-key-0123456789";

async function start({ adminKey = KEY } = {}) {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  await seed(db, path.join(SITE, "data"));
  await seedSource(db, path.join(SITE, "data"));
  await harvest(db);
  const server = createServer({ db, siteDir: SITE, adminKey });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (key, body, headers = { "x-admin-key": KEY }) =>
    fetch(`${base}/api/state/${key}`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { db, base, put, stop: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
}

test("state starts empty and is public to read", async () => {
  const s = await start();
  try {
    const state = await (await fetch(`${s.base}/api/state`)).json();
    assert.deepEqual(state, { datasets: [], access: {}, edits: {}, deleted: [] });
  } finally { await s.stop(); }
});

test("writes need the admin key", async () => {
  const s = await start();
  try {
    const body = { 1: { blocked: true } };
    assert.equal((await s.put("access", body, {})).status, 401, "no key");
    assert.equal((await s.put("access", body, { "x-admin-key": "wrong" })).status, 401, "wrong key");
    assert.deepEqual((await (await fetch(`${s.base}/api/state`)).json()).access, {}, "nothing was stored");
    const ok = await s.put("access", body);
    assert.equal(ok.status, 200);
    assert.deepEqual((await (await fetch(`${s.base}/api/state`)).json()).access, { 1: { blocked: true } });
    const audit = JSON.parse(JSON.stringify(await s.db.all("SELECT actor, action, entity FROM audit")));
    assert.deepEqual(audit, [{ actor: "admin-key", action: "state.put", entity: "access" }]);
  } finally { await s.stop(); }
});

test("without a configured key every write is refused", async () => {
  const s = await start({ adminKey: "" });
  try {
    assert.equal((await s.put("deleted", [1], { "x-admin-key": "anything" })).status, 503);
    assert.equal((await s.put("deleted", [1], {})).status, 503);
  } finally { await s.stop(); }
});

test("repeated wrong keys are throttled", async () => {
  const s = await start();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await s.put("deleted", [1], { "x-admin-key": `bad${i}` })).status, 401);
    assert.equal((await s.put("deleted", [1], { "x-admin-key": "bad-again" })).status, 429);
    assert.equal((await s.put("deleted", [1])).status, 429, "even the right key waits, so guessing gains nothing");
  } finally { await s.stop(); }
});

test("bad input is rejected with a clear error", async () => {
  const s = await start();
  try {
    assert.equal((await s.put("nope", {})).status, 400, "unknown key");
    assert.equal((await s.put("access", "not json")).status, 400, "not JSON");
    assert.equal((await s.put("access", { abc: { blocked: true } })).status, 400, "non-numeric id");
    assert.equal((await s.put("access", { 1: { blocked: "yes" } })).status, 400, "blocked must be boolean");
    assert.equal((await s.put("edits", { 1: { nameHe: "x".repeat(2001) } })).status, 400, "too long");
    assert.equal((await s.put("deleted", ["1", "x"])).status, 400, "ids only");
    assert.equal((await s.put("datasets", [{ repoId: 4 }])).status, 400, "incomplete dataset");
    assert.equal((await s.put("datasets", "x".repeat(10))).status, 400);
    const big = await s.put("edits", { 1: { nameHe: "x".repeat(1900) }, pad: "y".repeat(2 * 1024 * 1024) });
    assert.equal(big.status, 413, "over 2 MB");
    // unknown edit fields are dropped, not stored
    assert.equal((await s.put("edits", { 7: { nameHe: "שם", hacked: "<script>" } })).status, 200);
    assert.deepEqual((await (await fetch(`${s.base}/api/state`)).json()).edits, { 7: { nameHe: "שם" } });
  } finally { await s.stop(); }
});

test("pages carry the shared state, safely", async () => {
  const s = await start();
  try {
    const evil = "</script><script>alert(1)</script> &  ";
    assert.equal((await s.put("edits", { 1: { nameHe: evil } })).status, 200);
    assert.equal((await s.put("deleted", [3])).status, 200);
    const html = await (await fetch(`${s.base}/`)).text();
    assert.match(html, /<meta name="agamim-api" content="1">/);
    const m = /window\.__AGAMIM_STATE=(.*?);<\/script>/s.exec(html);
    assert.ok(m, "state is embedded");
    assert.ok(!m[1].includes("</script>") && !m[1].includes("<"), "nothing in the state can close the tag");
    const embedded = JSON.parse(m[1]);
    assert.equal(embedded.edits[1].nameHe, evil, "the value survives exactly");
    assert.deepEqual(embedded.deleted, ["3"]);
    assert.equal(html.match(/<script>window\.__AGAMIM_STATE/g).length, 1);
  } finally { await s.stop(); }
});

test("the harvest endpoint needs the key and refreshes the list of source tables", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/api/admin/harvest`, { method: "POST" })).status, 401);
    await s.db.exec("ALTER TABLE curated.siren_zones ADD COLUMN reviewed_by varchar(40)");
    const before = await (await fetch(`${s.base}/data/staging/db-tables.json`)).json();
    assert.ok(!before.tables.find((t) => t.sqlName === "curated.siren_zones").columns.some((c) => c.name === "reviewed_by"));
    const res = await fetch(`${s.base}/api/admin/harvest`, { method: "POST", headers: { "x-admin-key": KEY } });
    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.tables, 3);
    const after = await (await fetch(`${s.base}/data/staging/db-tables.json`)).json();
    assert.ok(after.tables.find((t) => t.sqlName === "curated.siren_zones").columns.some((c) => c.name === "reviewed_by"));
  } finally { await s.stop(); }
});
