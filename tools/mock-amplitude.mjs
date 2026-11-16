#!/usr/bin/env node
/*
 * Synthetic Amplitude data: the same 30 days / ~180 made-up people as tools/mock-mixpanel.mjs, reshaped for
 * Amplitude (Title Case event names, user_id/device_id/session_id, user_properties).
 *
 *   node tools/mock-amplitude.mjs --dry-run   writes mock-amplitude-events.ndjson and prints a summary (sends nothing)
 *   node tools/mock-amplitude.mjs --send      imports them via the Amplitude US Batch API
 *
 * It runs tools/mock-mixpanel.mjs --dry-run first and converts its output, so the stories in the data
 * (login failure spike days 8-9, suggestions launch day 14, add-dataset drop-off at step 2, rollout spike
 * days 19-21) stay in one place. Every event carries is_mock=true and app_env="mock".
 *
 * The API key is the site's own public client key, read from index.html. No secret is needed.
 * Re-running is safe: insert_id de-duplicates identical events.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const SRC = path.join(ROOT, "mock-mixpanel-events.ndjson");
const OUT = path.join(ROOT, "mock-amplitude-events.ndjson");
const ENDPOINT = "https://api2.amplitude.com/batch"; // US zone, matching serverZone: 'US' in index.html
const SESSION_GAP_MS = 30 * 60 * 1000;

// 1. Generate the shared mock world (dry-run only writes a file).
execFileSync(process.execPath, [path.join(ROOT, "tools", "mock-mixpanel.mjs"), "--dry-run"], { cwd: ROOT, stdio: "ignore" });
const src = fs.readFileSync(SRC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// 2. Convert.
const title = (name) => name.split("_").map((w) => (w === "mfa" ? "MFA" : w[0].toUpperCase() + w.slice(1))).join(" ");
const TECH = new Set(["time", "distinct_id", "$user_id", "$insert_id", "$browser", "$os", "$device", "mp_country_code", "role", "app_env", "is_mock"]);

const lastSeen = {}; // user -> { t, sessionId }
const events = src
  .sort((a, b) => a.properties.time - b.properties.time)
  .map((e) => {
    const p = e.properties;
    const t = p.time * 1000;
    const s = lastSeen[p.distinct_id];
    const sessionId = s && t - s.t < SESSION_GAP_MS ? s.sessionId : t;
    lastSeen[p.distinct_id] = { t, sessionId };
    const props = {};
    Object.keys(p).forEach((k) => { if (!TECH.has(k)) props[k] = p[k]; });
    props.app_env = p.app_env;
    props.is_mock = p.is_mock;
    return {
      user_id: p.distinct_id,
      device_id: "dev_" + crypto.createHash("sha1").update(p.distinct_id).digest("hex").slice(0, 12),
      event_type: title(e.event),
      time: t,
      session_id: sessionId,
      insert_id: p.$insert_id,
      event_properties: props,
      user_properties: { role: p.role, hierarchy: "HFC", is_mock: true, app_env: "mock" },
      platform: "Web",
      os_name: p.$os,
      device_family: p.$device,
      country: "IL"
    };
  });

function summary() {
  const byName = {};
  events.forEach((e) => { byName[e.event_type] = (byName[e.event_type] || 0) + 1; });
  console.log(`${events.length} events from ${new Set(events.map((e) => e.user_id)).size} people`);
  Object.entries(byName).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + k.padEnd(40) + v));
}

if (!args.has("--send")) {
  fs.writeFileSync(OUT, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  summary();
  console.log("\nWrote", path.relative(process.cwd(), OUT), "(nothing was sent). Use --send to import.");
  process.exit(0);
}

// 3. Send.
const key = (/amplitude\.init\(\s*['"]([0-9a-f]{32})['"]/.exec(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")) || [])[1];
if (!key) { console.error("Could not find the Amplitude key in index.html"); process.exit(1); }
summary();

async function post(body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" }, body });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    return { status: r.status, text: await r.text() };
  }
  return { status: 0, text: "gave up after retries" };
}

let sent = 0;
for (let i = 0; i < events.length; i += 1000) {
  const batch = events.slice(i, i + 1000);
  const r = await post(JSON.stringify({ api_key: key, events: batch }));
  if (r.status !== 200) { console.error(`batch ${i / 1000 + 1} failed: HTTP ${r.status} ${r.text.slice(0, 300)}`); process.exit(1); }
  sent += batch.length;
  console.log(`sent batch ${i / 1000 + 1}: ${batch.length} events`);
}
console.log(`events accepted: ${sent} of ${events.length}`);
