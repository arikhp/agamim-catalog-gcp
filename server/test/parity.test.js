"use strict";
// The database must reproduce every published data file exactly (JSON compared by value, other files by bytes).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { open, migrate } = require("../db");
const { seed, walk } = require("../seed");
const { buildFile } = require("../materialize");

const DATA = path.join(__dirname, "..", "..", "data");

async function freshDb() {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  await seed(db, DATA);
  return db;
}

test("seed loads the expected rows", async () => {
  const db = await freshDb();
  const counts = await seed(db, DATA); // seeding twice must give the same result
  assert.equal(counts.repositories, 3);
  assert.equal(counts.layers, 3);
  assert.ok(counts.columns > 0);
  await db.close();
});

test("every published data file is reproduced from the database", async () => {
  const db = await freshDb();
  const files = walk(DATA);
  assert.ok(files.length > 30, "expected the fixtures to be present");
  for (const rel of files) {
    const built = await buildFile(db, rel);
    assert.ok(built, `missing from database: ${rel}`);
    const original = fs.readFileSync(path.join(DATA, rel), "utf8");
    if (rel.endsWith(".json")) {
      assert.deepStrictEqual(JSON.parse(built.body), JSON.parse(original), rel);
    } else {
      assert.equal(built.body, original, rel);
    }
  }
  await db.close();
});

test("unknown and deleted entries return nothing", async () => {
  const db = await freshDb();
  assert.equal(await buildFile(db, "consumer/layers__999999.json"), null);
  assert.equal(await buildFile(db, "consumer/repositories__999999.json"), null);
  assert.equal(await buildFile(db, "consumer/nope.json"), null);
  await db.run("UPDATE layer SET deleted = 1 WHERE id = 6452");
  assert.equal(await buildFile(db, "consumer/layers__6452.json"), null);
  const list = JSON.parse((await buildFile(db, "consumer/layers.json")).body);
  assert.equal(list.total, 2);
  assert.ok(!list.items.some((l) => l.id === 6452));
  await db.close();
});
