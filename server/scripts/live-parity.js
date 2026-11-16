"use strict";
// Fetches every file under data/ from a running server and compares it with the fixture on disk.
// Usage: ADMIN_KEY=... node server/scripts/live-parity.js https://agamim-catalog-dc3eee23.azurewebsites.net
// (ADMIN_KEY is only needed when the server requires a login; it is sent as the x-admin-key header.)
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { walk } = require("../seed");

const headers = process.env.ADMIN_KEY ? { "x-admin-key": process.env.ADMIN_KEY } : {};
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!base) { console.error("Usage: node server/scripts/live-parity.js <base url>"); process.exit(2); }
const DATA = path.join(__dirname, "..", "..", "data");

(async () => {
  let ok = 0;
  const bad = [];
  for (const rel of walk(DATA)) {
    // The list of source tables is rebuilt by the harvester from the real database, so it can differ in
    // row counts and statistics. Compare its structure instead of its bytes.
    if (rel === "staging/db-tables.json") {
      const res = await fetch(`${base}/data/${rel}`, { headers });
      try {
        assert.equal(res.status, 200);
        const live = (await res.json()).tables;
        const want = JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")).tables;
        const shape = (list) => list.map((t) => [t.sqlName, t.columns.map((c) => [c.name, c.type, c.pk])]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
        assert.deepStrictEqual(shape(live), shape(want));
        ok++;
      } catch (err) { bad.push(`${rel}: structure differs (${String(err.message).split("\n")[0]})`); }
      continue;
    }
    const res = await fetch(`${base}/data/${rel}`, { headers });
    const body = Buffer.from(await res.arrayBuffer());
    const original = fs.readFileSync(path.join(DATA, rel));
    try {
      assert.equal(res.status, 200, `status ${res.status}`);
      if (rel.endsWith(".json")) assert.deepStrictEqual(JSON.parse(body.toString("utf8")), JSON.parse(original.toString("utf8")));
      else assert.deepEqual(body, original);
      ok++;
    } catch (err) {
      bad.push(`${rel}: ${String(err.message).split("\n")[0]}`);
    }
  }
  console.log(`${ok} files match, ${bad.length} differ`);
  for (const line of bad) console.log("  " + line);
  process.exit(bad.length ? 1 : 0);
})();
