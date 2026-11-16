"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { open, migrate } = require("../db");
const { seed } = require("../seed");
const users = require("../users");
const { msUntilNext, parseTime } = require("../schedule");
const { createServer } = require("../index");

const SITE = path.join(__dirname, "..", "..");
const SECRET = "test-session-secret-0123456789abcdef";
const KEY = "test-admin-key-0123456789";
const ENV = { MOCK_ADMIN_USER: "boss", MOCK_ADMIN_PASSWORD: "admin-pass-1234", MOCK_CONSUMER_USER: "viewer", MOCK_CONSUMER_PASSWORD: "viewer-pass-5678" };

async function start() {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  await seed(db, path.join(SITE, "data"));
  await users.ensureUsers(db, ENV);
  const server = createServer({ db, siteDir: SITE, adminKey: KEY, sessionSecret: SECRET, requireLogin: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (userId, password, headers = {}) => fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ userId, password }) });
  const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
  return { db, base, login, cookieOf, stop: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
}

test("passwords are hashed, salted and checked in constant time", () => {
  const a = users.hashPassword("secret-1");
  const b = users.hashPassword("secret-1");
  assert.notEqual(a, b, "a new salt each time");
  assert.ok(a.startsWith("scrypt$") && !a.includes("secret-1"));
  assert.equal(users.verifyPassword("secret-1", a), true);
  assert.equal(users.verifyPassword("secret-2", a), false);
  assert.equal(users.verifyPassword("secret-1", "garbage"), false);
});

test("session tokens are signed and expire", () => {
  const user = { userId: "boss", role: "admin", name: "n" };
  const token = users.makeToken(SECRET, user, 1000);
  assert.deepEqual(users.readToken(SECRET, token, 2000), user);
  assert.equal(users.readToken("another-secret", token, 2000), null, "wrong secret");
  assert.equal(users.readToken(SECRET, token.slice(0, -3) + "xyz", 2000), null, "tampered signature");
  const forged = Buffer.from(JSON.stringify({ u: "boss", r: "admin", n: "n", e: 9e15 })).toString("base64url") + "." + token.split(".")[1];
  assert.equal(users.readToken(SECRET, forged, 2000), null, "forged payload");
  assert.equal(users.readToken(SECRET, token, 1000 + 9 * 3600 * 1000), null, "expired after 8 hours");
  assert.equal(users.readToken("", token), null);
});

test("accounts come from configuration and never from defaults", async () => {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  assert.deepEqual(await users.ensureUsers(db, {}), {}, "no passwords configured, no accounts");
  assert.deepEqual(await users.ensureUsers(db, ENV), { boss: "created", viewer: "created" });
  assert.deepEqual(await users.ensureUsers(db, ENV), { boss: "unchanged", viewer: "unchanged" });
  assert.deepEqual(await users.ensureUsers(db, { ...ENV, MOCK_ADMIN_PASSWORD: "changed-pass-9" }), { boss: "updated", viewer: "unchanged" });
  assert.ok(await users.checkLogin(db, "boss", "changed-pass-9"));
  assert.equal(await users.checkLogin(db, "boss", "admin-pass-1234"), null, "the old password stops working");
  const rows = JSON.stringify(await db.all("SELECT * FROM app_user"));
  assert.ok(!rows.includes("changed-pass-9") && !rows.includes("viewer-pass-5678"), "no clear-text passwords stored");
  await db.close();
});

test("without a session the data and the shared state are closed", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/data/consumer/repositories.json`)).status, 401);
    assert.equal((await fetch(`${s.base}/data/staging/db-tables.json`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/state`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/me`)).status, 401);
    // the page itself is public, but carries a login marker and no state
    const html = await (await fetch(`${s.base}/`)).text();
    assert.match(html, /__AGAMIM_LOGIN_REQUIRED=true/);
    assert.match(html, /__AGAMIM_SESSION=null/);
    assert.match(html, /<script src="\.\/login\.js"><\/script>/);
    assert.ok(!html.includes("__AGAMIM_STATE"), "state is withheld");
    assert.equal((await fetch(`${s.base}/login.js`)).status, 200);
    // the health check stays open for the platform
    assert.equal((await fetch(`${s.base}/api/health`)).status, 200);
  } finally { await s.stop(); }
});

test("a wrong user or password gives the same answer", async () => {
  const s = await start();
  try {
    const wrongPass = await s.login("boss", "nope");
    const wrongUser = await s.login("nobody", "admin-pass-1234");
    assert.equal(wrongPass.status, 401);
    assert.equal(wrongUser.status, 401);
    assert.deepEqual(await wrongPass.json(), await wrongUser.json());
    assert.equal(s.cookieOf(wrongPass), "");
    assert.equal((await s.login(123, {})).status, 401, "odd input is refused, not an error");
    const failed = JSON.parse(JSON.stringify(await s.db.all("SELECT actor, action FROM audit WHERE action = 'login.failed'")));
    assert.equal(failed.length, 3);
  } finally { await s.stop(); }
});

test("signing in opens the data for that browser", async () => {
  const s = await start();
  try {
    const res = await s.login("viewer", "viewer-pass-5678");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: "viewer", role: "consumer", name: "צרכן נתונים (הדגמה)" });
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.ok(!/Secure/.test(setCookie), "not Secure over plain http");
    const secure = await s.login("viewer", "viewer-pass-5678", { "x-forwarded-proto": "https" });
    assert.match(secure.headers.get("set-cookie"), /Secure/);

    const cookie = s.cookieOf(res);
    const get = (p) => fetch(`${s.base}${p}`, { headers: { cookie } });
    assert.equal((await get("/data/consumer/repositories.json")).status, 200);
    assert.equal((await get("/api/state")).status, 200);
    assert.equal((await (await get("/api/me")).json()).userId, "viewer");
    const html = await (await get("/")).text();
    assert.match(html, /__AGAMIM_SESSION=\{"userId":"viewer","role":"consumer"/);
    assert.match(html, /__AGAMIM_STATE=/);
    assert.equal((await fetch(`${s.base}/data/consumer/repositories.json`, { headers: { cookie: "agamim_session=abc.def" } })).status, 401, "a bad cookie is no session");
  } finally { await s.stop(); }
});

test("only an admin session may change things", async () => {
  const s = await start();
  try {
    const consumer = s.cookieOf(await s.login("viewer", "viewer-pass-5678"));
    const admin = s.cookieOf(await s.login("boss", "admin-pass-1234"));
    const put = (cookie, extra = {}) => fetch(`${s.base}/api/state/deleted`, { method: "PUT", headers: { "content-type": "application/json", cookie, ...extra }, body: "[3]" });
    assert.equal((await put(consumer)).status, 403, "consumer");
    assert.equal((await put("")).status, 401, "nobody");
    assert.equal((await put(admin, { origin: "https://evil.example" })).status, 403, "cross-site");
    assert.equal((await put(admin, { origin: new URL(s.base).origin })).status, 200, "same-site admin");
    assert.equal((await put(admin)).status, 200);
    const audit = JSON.parse(JSON.stringify(await s.db.all("SELECT actor, action FROM audit WHERE action = 'state.put' ORDER BY id")));
    assert.deepEqual(audit[0], { actor: "user:boss", action: "state.put" });
    assert.equal((await fetch(`${s.base}/api/admin/harvest`, { method: "POST", headers: { cookie: consumer } })).status, 403);
    assert.equal((await fetch(`${s.base}/api/admin/harvest`, { method: "POST", headers: { cookie: admin } })).status, 200);
  } finally { await s.stop(); }
});

test("the admin key still works for scripts, and anonymous visitors do not lock it out", async () => {
  const s = await start();
  try {
    for (let i = 0; i < 30; i++) await fetch(`${s.base}/data/consumer/layers.json`); // anonymous, many times
    const withKey = await fetch(`${s.base}/data/consumer/layers.json`, { headers: { "x-admin-key": KEY } });
    assert.equal(withKey.status, 200, "30 anonymous requests did not count as wrong keys");
    assert.equal((await fetch(`${s.base}/api/state/deleted`, { method: "PUT", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: "[]" })).status, 200);
  } finally { await s.stop(); }
});

test("sign out ends the session and repeated wrong passwords are throttled", async () => {
  const s = await start();
  try {
    const out = await fetch(`${s.base}/api/logout`, { method: "POST" });
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
    for (let i = 0; i < 10; i++) assert.equal((await s.login("boss", `wrong${i}`)).status, 401);
    assert.equal((await s.login("boss", "admin-pass-1234")).status, 429, "even the right password waits");
  } finally { await s.stop(); }
});

test("the nightly time is worked out in the right time zone", () => {
  // 22:30 UTC on 15 Nov 2026 is 00:30 in Israel (UTC+2), so 02:00 is 90 minutes away.
  assert.equal(msUntilNext(new Date("2026-11-15T22:30:00Z"), 2, 0, "Asia/Jerusalem"), 90 * 60 * 1000);
  // exactly 02:00 local: the next run is tomorrow
  assert.equal(msUntilNext(new Date("2026-11-16T00:00:00Z"), 2, 0, "Asia/Jerusalem"), 24 * 3600 * 1000);
  // just after 02:00 local
  assert.equal(msUntilNext(new Date("2026-11-16T00:00:30Z"), 2, 0, "Asia/Jerusalem"), (24 * 3600 - 30) * 1000);
  // summer time (UTC+3): 21:30 UTC is 00:30 local
  assert.equal(msUntilNext(new Date("2026-07-15T21:30:00Z"), 2, 0, "Asia/Jerusalem"), 90 * 60 * 1000);
  assert.deepEqual(parseTime("02:00"), { hour: 2, minute: 0 });
  assert.deepEqual(parseTime("2:05"), { hour: 2, minute: 5 });
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("nope"), null);
});
