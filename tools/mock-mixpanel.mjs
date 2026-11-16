#!/usr/bin/env node
/*
 * Synthetic Mixpanel data for exploring the product: 30 days of usage by ~180 made-up people.
 *
 *   node tools/mock-mixpanel.mjs --dry-run     writes the events to a file and prints a summary (sends nothing)
 *   node tools/mock-mixpanel.mjs --send        imports them into the Mixpanel project named in .mixpanel-import.env
 *
 * Everything is fake: people are "mock_u001"... with no names, emails or real data. Every event and profile
 * carries is_mock=true, so it can be filtered out (is_mock is not true) in any report.
 * The events use exactly the names and properties the site sends (see analytics.js, analytics-journey.js,
 * analytics-entry.js, add-dataset.js), so a report built on this data works unchanged on real data.
 *
 * Credentials (for --send only) live in .mixpanel-import.env, which is git-ignored:
 *   MP_PROJECT_ID=<numeric project id>        Settings > Project settings
 *   MP_SA_USER=<service account username>     Settings > Organization settings > Service accounts
 *   MP_SA_SECRET=<service account secret>
 *   MP_REGION=eu                              eu | us | in   (this project is EU)
 *
 * The data is seeded, so running it twice produces the same events with the same $insert_id, and Mixpanel
 * de-duplicates them. Re-running on a later day shifts the 30-day window and adds the new days.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6) || path.join(ROOT, "mock-mixpanel-events.ndjson");

// ------------------------------------------------------------------ random
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261112);
const chance = (p) => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
function pick(items) { // [[value, weight], ...]
  const total = items.reduce((s, x) => s + x[1], 0);
  let r = rnd() * total;
  for (const [v, w] of items) { if ((r -= w) <= 0) return v; }
  return items[items.length - 1][0];
}

// ------------------------------------------------------------------ the world
const DAYS = 30;
const USERS = 180;
const DATASETS = [[1, 50], [3, 28], [2, 22]]; // dataset id, popularity (id 2 is the blocked one)
const TABS = [["טבלאות ונתונים", 30], ["סקירה", 20], ["ליניאז'", 15], ["חוזה", 12], ["איכות ושירות", 10], ["צרכנים", 8], ["גישה ומצבי הפעלה", 5]];
const BROWSERS = [["Chrome", 62], ["Safari", 22], ["Edge", 12], ["Firefox", 4]];
const OSES = [["Windows", 55], ["Mac OS X", 30], ["iOS", 10], ["Android", 5]];
// Israeli work week: Sunday-Thursday busy, Friday light, Saturday nearly empty.
const WEEKDAY = [1.0, 1.0, 1.0, 1.0, 1.0, 0.25, 0.12]; // Sun..Sat (JS getUTCDay: 0 = Sunday)
const PERSONAS = {
  power:   { share: 0.15, active: 0.72, decay: 400, tabs: 0.8, sessions: [1, 3] },
  regular: { share: 0.35, active: 0.42, decay: 150, tabs: 0.6, sessions: [1, 2] },
  casual:  { share: 0.35, active: 0.17, decay: 60,  tabs: 0.4, sessions: [1, 1] },
  oneoff:  { share: 0.15, active: 0.0,  decay: 1,   tabs: 0.3, sessions: [1, 1] }
};

const now = Date.now();
const todayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
const dayStart = (d) => todayStart - (DAYS - 1 - d) * 86400000; // d = 0 is 29 days ago, d = 29 is today

// Sign-ups grow over the month, with a rollout spike on day 20 (new teams onboarded).
function signupDay() {
  const w = [];
  for (let d = 0; d < DAYS; d++) {
    const dow = new Date(dayStart(d)).getUTCDay();
    let x = (1 + d / 8) * WEEKDAY[dow];
    if (d >= 19 && d <= 21) x *= 4;
    w.push([d, x]);
  }
  return pick(w);
}

const people = [];
for (let i = 1; i <= USERS; i++) {
  const persona = pick(Object.entries(PERSONAS).map(([k, v]) => [k, v.share]));
  const role = chance(0.15) ? "admin" : "consumer";
  people.push({
    id: "mock_u" + String(i).padStart(3, "0"),
    role: role === "admin" ? "admin" : "user", // the site's own role values are "admin" / "user"
    persona,
    start: signupDay(),
    browser: pick(BROWSERS),
    os: pick(OSES),
    seenProfile: false
  });
}

// ------------------------------------------------------------------ events
const events = [];
let seq = 0;
function emit(u, name, t, props) {
  if (t > now - 60000) return false; // never in the future
  seq++;
  const insert = crypto.createHash("sha1").update(u.id + "|" + name + "|" + t + "|" + seq).digest("hex").slice(0, 32);
  events.push({
    event: name,
    properties: Object.assign({
      time: Math.floor(t / 1000),
      distinct_id: u.id,
      $user_id: u.id,
      $insert_id: insert,
      $browser: u.browser,
      $os: u.os,
      $device: u.os === "iOS" || u.os === "Android" ? "mobile" : "desktop",
      mp_country_code: "IL",
      role: u.role,
      app_env: "mock",
      is_mock: true
    }, props || {})
  });
  return true;
}

function session(u, day) {
  // 07:00-17:00 Israel time (UTC+2 in winter), most of it mid-morning.
  const hour = pick([[7, 5], [8, 12], [9, 18], [10, 18], [11, 16], [12, 10], [13, 9], [14, 8], [15, 6], [16, 4], [17, 2]]);
  let t = dayStart(day) + (hour - 2) * 3600000 + int(0, 59) * 60000 + int(0, 59) * 1000;
  const step = (a, b) => (t += int(a, b) * 1000);
  const P = PERSONAS[u.persona];

  // Login funnel. A friction bump on days 8-9 (a flaky login window).
  emit(u, "login_viewed", t);
  const failP = day === 8 || day === 9 ? 0.34 : 0.09;
  step(6, 25); emit(u, "login_submitted", t);
  let tries = 0;
  while (chance(failP) && tries < 3) {
    tries++;
    step(1, 3);
    emit(u, "login_failed", t, { reason: "invalid_credentials", attempts_left: 3 - tries });
    step(5, 15); emit(u, "login_submitted", t);
  }
  if (tries >= 3 || chance(0.005)) { emit(u, "login_failed", t + 1000, { reason: "account_locked" }); return; }
  step(2, 5); emit(u, "mfa_viewed", t);
  step(8, 30); emit(u, "mfa_code_submitted", t);
  if (chance(0.08)) { step(5, 12); emit(u, "mfa_code_resent", t); step(8, 25); emit(u, "mfa_code_submitted", t); }
  if (chance(0.04)) return; // gave up at the verification step
  const started = t;
  step(1, 4);
  emit(u, "sign_in_completed", t, { seconds_to_complete: Math.round((t - started) / 1000) + int(15, 50) });

  if (!u.seenProfile) {
    u.seenProfile = true;
    step(1, 3); emit(u, "profile_screen_viewed", t);
    if (chance(0.93)) { step(25, 90); emit(u, "profile_completed", t, { hierarchy: "HFC" }); } else return;
  }

  // Discovery. Suggestions launch on day 14: more people use them and they convert better.
  const suggestShare = day >= 14 ? 0.5 : 0.12;
  const datasetsToOpen = chance(0.65) ? 1 : chance(0.6) ? 2 : 3;
  let opened = 0;
  let from = "home";
  for (let round = 0; round < 3 && opened < datasetsToOpen; round++) {
    const intent = pick([["search", 55], ["browse", 35], ["home", 10]]);
    if (intent === "browse") {
      step(3, 12); emit(u, "catalog_viewed", t);
      from = "catalog";
      if (!chance(0.8)) continue;
    } else if (intent === "search") {
      const qlen = int(2, 22);
      if (chance(suggestShare)) {
        step(4, 14); emit(u, "search_suggestion_clicked", t, { query_length: int(2, 7) });
        from = "suggestion";
      } else {
        step(4, 14); emit(u, "search_performed", t, { query_length: qlen, query_words: Math.min(3, 1 + Math.floor(qlen / 8)) });
        from = "search";
        // About one typed search in four finds nothing useful.
        if (chance(0.26)) { if (chance(0.5)) continue; else { step(5, 20); emit(u, "search_performed", t, { query_length: int(3, 15), query_words: int(1, 3) }); } }
        if (!chance(0.66)) continue;
      }
    } else {
      from = "home";
    }
    const id = pick(DATASETS);
    step(2, 8); emit(u, "dataset_viewed", t, { dataset_id: String(id), source: from });
    opened++;
    // Tabs: power users go deeper; the blocked dataset (2) gets fewer.
    let n = 0;
    while (chance(P.tabs * (id === 2 ? 0.5 : 1) * Math.pow(0.62, n)) && n < 5) {
      step(8, 70); emit(u, "dataset_tab_viewed", t, { dataset_id: String(id), tab: pick(TABS) });
      n++;
    }
  }

  // Admins also register datasets: most start, fewer finish, and step 2 (the long form) is where they stall.
  if (u.role === "admin" && chance(0.3)) {
    step(10, 40); emit(u, "dataset_registration_started", t, { resumed_draft: chance(0.15) });
    if (chance(0.82)) {
      step(20, 80); emit(u, "dataset_registration_step_completed", t, { step: 1, step_name: "table" });
      if (chance(0.58)) {
        step(120, 600); emit(u, "dataset_registration_step_completed", t, { step: 2, step_name: "details" });
        if (chance(0.88)) { step(15, 60); emit(u, "dataset_registered", t, { columns_count: int(5, 40), requirements_count: int(0, 5) }); }
        else emit(u, "dataset_registration_abandoned", t + 20000, { last_step: 3 });
      } else emit(u, "dataset_registration_abandoned", t + 30000, { last_step: 2 });
    } else emit(u, "dataset_registration_abandoned", t + 15000, { last_step: 1 });
  }
}

for (const u of people) {
  const P = PERSONAS[u.persona];
  for (let d = u.start; d < DAYS; d++) {
    const age = d - u.start;
    const dow = new Date(dayStart(d)).getUTCDay();
    // The first day is always active; later days follow the persona's habit, fading with age.
    const p = age === 0 ? 1 : P.active * Math.exp(-age / P.decay) * WEEKDAY[dow] * (u.role === "admin" ? 1.15 : 1);
    if (!chance(Math.min(1, p))) continue;
    const n = age === 0 ? 1 : int(P.sessions[0], P.sessions[1]);
    for (let k = 0; k < n; k++) session(u, d);
  }
}
events.sort((a, b) => a.properties.time - b.properties.time);

// ------------------------------------------------------------------ summary
function summary() {
  const byName = {};
  events.forEach((e) => { byName[e.event] = (byName[e.event] || 0) + 1; });
  const users = new Set(events.map((e) => e.properties.distinct_id));
  console.log(`${events.length} events from ${users.size} people over ${DAYS} days`);
  Object.entries(byName).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + k.padEnd(40) + v));
  const reach = (name) => new Set(events.filter((e) => e.event === name).map((e) => e.properties.distinct_id)).size;
  console.log(`people who signed in: ${reach("sign_in_completed")}, opened a dataset: ${reach("dataset_viewed")}, viewed a tab: ${reach("dataset_tab_viewed")}`);
  const bySource = {};
  events.filter((e) => e.event === "dataset_viewed").forEach((e) => { bySource[e.properties.source] = (bySource[e.properties.source] || 0) + 1; });
  console.log("dataset_viewed by source:", JSON.stringify(bySource));
}

// ------------------------------------------------------------------ output
if (args.has("--dry-run") || !args.has("--send")) {
  fs.writeFileSync(OUT, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  summary();
  console.log("\nWrote", path.relative(process.cwd(), OUT), "(nothing was sent). Use --send to import.");
  process.exit(0);
}

// ------------------------------------------------------------------ send
function readEnv() {
  const file = path.join(ROOT, ".mixpanel-import.env");
  if (!fs.existsSync(file)) { console.error("Missing .mixpanel-import.env (see the header of this file)."); process.exit(1); }
  const env = {};
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((l) => {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !l.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  for (const k of ["MP_PROJECT_ID", "MP_SA_USER", "MP_SA_SECRET"]) if (!env[k]) { console.error("Missing " + k + " in .mixpanel-import.env"); process.exit(1); }
  return env;
}
const HOSTS = { eu: "https://api-eu.mixpanel.com", us: "https://api.mixpanel.com", in: "https://api-in.mixpanel.com" };

async function post(url, body, headers, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { method: "POST", headers, body });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    return { status: r.status, text: await r.text() };
  }
  return { status: 0, text: "gave up after retries" };
}

async function send() {
  const env = readEnv();
  const host = HOSTS[(env.MP_REGION || "eu").toLowerCase()];
  if (!host) { console.error("MP_REGION must be eu, us or in"); process.exit(1); }
  const auth = "Basic " + Buffer.from(env.MP_SA_USER + ":" + env.MP_SA_SECRET).toString("base64");
  summary();

  let ok = 0;
  for (let i = 0; i < events.length; i += 2000) {
    const batch = events.slice(i, i + 2000);
    const r = await post(`${host}/import?strict=1&project_id=${encodeURIComponent(env.MP_PROJECT_ID)}`, JSON.stringify(batch), {
      "Content-Type": "application/json", Authorization: auth, Accept: "application/json"
    });
    let n = 0;
    try { n = JSON.parse(r.text).num_records_imported || 0; } catch (e) {}
    if (r.status !== 200) { console.error(`batch ${i / 2000 + 1} failed: HTTP ${r.status} ${r.text.slice(0, 300)}`); process.exit(1); }
    ok += n;
    console.log(`imported batch ${i / 2000 + 1}: ${n} events`);
  }
  console.log(`events imported: ${ok} of ${events.length}`);

  // Profiles (Users page, cohorts by role). The profile endpoint takes the project token, found in analytics.js.
  const token = (/MIXPANEL_TOKEN\s*=\s*"([0-9a-f]+)"/.exec(fs.readFileSync(path.join(ROOT, "analytics.js"), "utf8")) || [])[1];
  if (token) {
    const profiles = people.filter((u) => events.some((e) => e.properties.distinct_id === u.id)).map((u) => ({
      $token: token, $distinct_id: u.id, $ip: "0",
      $set: { $name: "Mock user " + u.id.slice(-3), role: u.role, hierarchy: "HFC", is_mock: true }
    }));
    for (let i = 0; i < profiles.length; i += 200) {
      const r = await post(`${host}/engage?verbose=1`, JSON.stringify(profiles.slice(i, i + 200)), { "Content-Type": "application/json", Accept: "application/json" });
      if (r.status !== 200) { console.error("profile batch failed:", r.status, r.text.slice(0, 200)); process.exit(1); }
    }
    console.log(`profiles set: ${profiles.length}`);
  }
}
send();
