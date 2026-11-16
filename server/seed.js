"use strict";
// Loads the published fixtures under data/ into the catalog tables. Idempotent: it replaces everything.
const fs = require("fs");
const path = require("path");

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

async function seed(db, dataDir) {
  const read = (rel) => fs.readFileSync(path.join(dataDir, rel), "utf8");
  const json = (rel) => JSON.parse(read(rel));
  const files = walk(dataDir);

  await db.tx(async (t) => {
    for (const table of ["sample_row", "layer_column", "layer", "repository", "payload"]) {
      await t.run(`DELETE FROM ${table}`);
    }

    // Repositories, in the order the published list shows them.
    const repoList = json("consumer/repositories.json").items;
    for (let pos = 0; pos < repoList.length; pos++) {
      const id = repoList[pos].id;
      await t.run("INSERT INTO repository (id, pos, doc) VALUES (?, ?, ?)", [id, pos, read(`consumer/repositories__${id}.json`)]);
    }

    // Layers: the list item, plus the detail file split into detail, columns and sample rows.
    const layerList = json("consumer/layers.json").items;
    for (let pos = 0; pos < layerList.length; pos++) {
      const item = layerList[pos];
      const file = `consumer/layers__${item.id}.json`;
      const detail = files.includes(file) ? json(file) : { ...item };
      const { columns = [], sampleRows = [], ...rest } = detail;
      await t.run(
        "INSERT INTO layer (id, repo_id, pos, sql_name, doc, detail) VALUES (?, ?, ?, ?, ?, ?)",
        [item.id, item.repoId, pos, item.sqlName, JSON.stringify(item), JSON.stringify(rest)]
      );
      for (let i = 0; i < columns.length; i++) {
        await t.run("INSERT INTO layer_column (layer_id, ordinal, doc) VALUES (?, ?, ?)", [item.id, i, JSON.stringify(columns[i])]);
      }
      for (let i = 0; i < sampleRows.length; i++) {
        await t.run("INSERT INTO sample_row (layer_id, row_no, doc) VALUES (?, ?, ?)", [item.id, i, JSON.stringify(sampleRows[i])]);
      }
    }

    // Everything else is served as it is.
    const derived = /^consumer\/(repositories\.json|layers\.json|repositories__\d+\.json|repositories__\d+__layers\.json|layers__\d+\.json)$/;
    for (const rel of files) {
      if (derived.test(rel)) continue;
      await t.run("INSERT INTO payload (name, body) VALUES (?, ?)", [rel, read(rel)]);
    }
  });

  return {
    repositories: (await db.get("SELECT COUNT(*) AS n FROM repository")).n,
    layers: (await db.get("SELECT COUNT(*) AS n FROM layer")).n,
    columns: (await db.get("SELECT COUNT(*) AS n FROM layer_column")).n,
    payloads: (await db.get("SELECT COUNT(*) AS n FROM payload")).n
  };
}

module.exports = { seed, walk };
