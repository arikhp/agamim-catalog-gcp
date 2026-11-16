"use strict";
// Mock accounts and sessions. Passwords are hashed with scrypt; a session is a signed cookie.
const crypto = require("crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const COOKIE = "agamim_session";
const SESSION_HOURS = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, salt.toString("base64"), hash.toString("base64")].join("$");
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "base64");
  const want = Buffer.from(parts[3], "base64");
  const got = crypto.scryptSync(String(password), salt, want.length, { N: Number(parts[1]), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(got, want);
}

// Same work for an unknown user as for a known one, so response time does not reveal which IDs exist.
const DUMMY = hashPassword("not-a-real-password");

async function findUser(db, userId) {
  return db.get("SELECT user_id, role, display_name, password_hash FROM app_user WHERE user_id = ?", [String(userId)]);
}

async function checkLogin(db, userId, password) {
  const user = await findUser(db, userId);
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY);
  return user && ok ? { userId: user.user_id, role: user.role, name: user.display_name } : null;
}

// Creates or updates an account so that its password matches what the server was configured with.
async function upsertUser(db, { userId, role, name, password }) {
  const existing = await findUser(db, userId);
  if (existing && verifyPassword(password, existing.password_hash) && existing.role === role) return "unchanged";
  await db.tx(async (t) => {
    await t.run("DELETE FROM app_user WHERE user_id = ?", [userId]);
    await t.run("INSERT INTO app_user (user_id, role, display_name, password_hash) VALUES (?, ?, ?, ?)", [userId, role, name, hashPassword(password)]);
  });
  return existing ? "updated" : "created";
}

// Accounts come from the environment. An account without a configured password is not created.
async function ensureUsers(db, env = process.env) {
  const wanted = [
    { userId: env.MOCK_ADMIN_USER || "admin", role: "admin", name: "מנהל מערכת (הדגמה)", password: env.MOCK_ADMIN_PASSWORD },
    { userId: env.MOCK_CONSUMER_USER || "consumer", role: "consumer", name: "צרכן נתונים (הדגמה)", password: env.MOCK_CONSUMER_PASSWORD }
  ];
  const out = {};
  for (const u of wanted) if (u.password) out[u.userId] = await upsertUser(db, u);
  return out;
}

// --- sessions -----------------------------------------------------------------------------------
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (secret, data) => b64(crypto.createHmac("sha256", secret).update(data).digest());

function makeToken(secret, user, now = Date.now()) {
  const payload = b64(JSON.stringify({ u: user.userId, r: user.role, n: user.name, e: now + SESSION_HOURS * 3600 * 1000 }));
  return `${payload}.${sign(secret, payload)}`;
}

function readToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== "string") return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof p.e !== "number" || p.e < now) return null;
    return { userId: p.u, role: p.r, name: p.n };
  } catch { return null; }
}

function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieHeader(token, secure, clear = false) {
  const attrs = [`${COOKIE}=${clear ? "" : token}`, "Path=/", "HttpOnly", "SameSite=Lax", clear ? "Max-Age=0" : `Max-Age=${SESSION_HOURS * 3600}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

module.exports = { hashPassword, verifyPassword, checkLogin, ensureUsers, upsertUser, makeToken, readToken, readCookie, cookieHeader, COOKIE };
