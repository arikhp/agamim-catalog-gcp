"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { open, migrate } = require("../db");
const { seed } = require("../seed");
const { seedSource } = require("../source");
const { harvest } = require("../harvest");
const { buildFile } = require("../materialize");

const DATA = path.join(__dirname, "..", "..", "data");
const fixture = JSON.parse(fs.readFileSync(path.join(DATA, "staging", "db-tables.json"), "utf8"));

async function ready() {
  const db = await open({ driver: "sqlite", file: ":memory:" });
  await migrate(db);
  await seed(db, DATA);
  await seedSource(db, DATA);
  await harvest(db);
  return db;
}
const served = async (db) => JSON.parse((await buildFile(db, "staging/db-tables.json")).body);

test("the harvest reproduces the structure and sample rows of the source tables", async () => {
  const db = await ready();
  const doc = await served(db);
  assert.equal(doc.tables.length, fixture.tables.length);
  for (const want of fixture.tables) {
    const got = doc.tables.find((t) => t.sqlName === want.sqlName);
    assert.ok(got, `missing ${want.sqlName}`);
    assert.deepEqual(got.columns.map((c) => [c.name, c.type, c.pk, c.nullable]), want.columns.map((c) => [c.name, c.type, c.pk, c.nullable]), want.sqlName);
    assert.deepStrictEqual(got.sampleRows, want.sampleRows, `${want.sqlName} sample rows`);
    assert.equal(got.rowCount, want.sampleRows.length, "row count is the real number of rows");
    assert.equal(got.titleHe, want.titleHe);
    assert.equal(got.docs.documented, got.docs.total);
    // descriptions and flags survive
    assert.equal(got.columns[0].descHe, want.columns[0].descHe);
    assert.equal(got.columns.some((c) => c.geometry), want.columns.some((c) => c.geometry));
  }
  await db.close();
});

test("the harvested list meets the rules the registration form relies on", async () => {
  const db = await ready();
  const doc = await served(db);
  assert.ok(doc.tables.length >= 3);
  const names = doc.tables.map((t) => t.sqlName);
  assert.equal(new Set(names).size, names.length);
  for (const t of doc.tables) {
    assert.equal(t.columns.filter((c) => c.pk).length, 1, `${t.sqlName} needs exactly one primary key`);
    for (const f of ["completeness", "timeliness", "consistency", "accuracy", "uniqueness"]) assert.equal(typeof t.quality[f], "number", `${t.sqlName} ${f}`);
    assert.equal(typeof t.freshnessMin, "number");
    assert.ok(t.loadTime);
  }
  await db.close();
});

test("a column added to a source table shows up after the next harvest", async () => {
  const db = await ready();
  assert.ok(!(await served(db)).tables[0].columns.some((c) => c.name === "notes"));
  await db.exec("ALTER TABLE curated.public_shelters ADD COLUMN notes varchar(50)");
  const result = await harvest(db);
  assert.equal(result.tables, 3);
  const t = (await served(db)).tables.find((x) => x.sqlName === "curated.public_shelters");
  const col = t.columns.find((c) => c.name === "notes");
  assert.ok(col, "new column is listed");
  assert.equal(col.type, "varchar(50)");
  assert.equal(col.emptyPct, 100);
  assert.equal(col.descHe, "");
  assert.equal(t.docs.total, t.docs.documented + 1);
  await db.close();
});

test("a table nobody has described yet appears with sensible defaults", async () => {
  const db = await ready();
  await db.exec("CREATE TABLE curated.new_zones (zone_id int NOT NULL, label varchar(40) NULL, PRIMARY KEY (zone_id))");
  await db.run("INSERT INTO curated.new_zones (zone_id, label) VALUES (?, ?)", [1, "a"]);
  await db.run("INSERT INTO curated.new_zones (zone_id, label) VALUES (?, ?)", [2, null]);
  await harvest(db);
  const doc = await served(db);
  const t = doc.tables.find((x) => x.sqlName === "curated.new_zones");
  assert.ok(t);
  assert.equal(t.rowCount, 2);
  assert.equal(t.titleHe, "new_zones");
  assert.equal(t.columns.find((c) => c.name === "label").emptyPct, 50);
  assert.equal(t.columns.find((c) => c.name === "zone_id").max, "2");
  assert.equal(t.quality.uniqueness, 100);
  assert.equal(t.geometry, "None");
  assert.equal(doc.tables.length, 4);
  await db.close();
});

test("every harvest is recorded", async () => {
  const db = await ready();
  await harvest(db);
  const runs = await db.all("SELECT status, summary FROM harvest_run ORDER BY id");
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.status === "ok"));
  assert.equal(JSON.parse(runs[1].summary).tables, 3);
  await db.close();
});
