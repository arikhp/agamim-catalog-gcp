"use strict";
// Builds the same files the static site serves under data/, from the database.
// buildFile(db, "consumer/layers__6452.json") -> { type, body } or null.

const LIST_ONLY_EXCLUDED = ["card", "requirements", "platformRequirements"];

function count(items, pick) {
  const out = {};
  for (const item of items) {
    const key = pick(item);
    if (key === undefined || key === null || key === "") continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

async function repoDocs(db) {
  const rows = await db.all("SELECT doc FROM repository WHERE deleted = 0 ORDER BY pos");
  return rows.map((r) => JSON.parse(r.doc));
}

async function layerDocs(db, repoId) {
  const rows = repoId === undefined
    ? await db.all("SELECT doc FROM layer WHERE deleted = 0 ORDER BY pos")
    : await db.all("SELECT doc FROM layer WHERE deleted = 0 AND repo_id = ? ORDER BY pos", [repoId]);
  return rows.map((r) => JSON.parse(r.doc));
}

function listItem(detail) {
  const item = { ...detail };
  for (const key of LIST_ONLY_EXCLUDED) delete item[key];
  return item;
}

async function repositories(db) {
  const details = await repoDocs(db);
  const items = details.map(listItem);
  const layers = await layerDocs(db);
  const cadenceOf = new Map();
  for (const layer of layers) if (!cadenceOf.has(layer.repoId)) cadenceOf.set(layer.repoId, layer.cadence);
  const facets = {
    access: count(items, (r) => (r.restricted ? "locked" : "open")),
    core: count(items, (r) => r.core),
    value: count(items, (r) => r.valueLevel),
    phase: count(items, (r) => r.phase),
    owner: count(items, (r) => r.ownerHe),
    frequency: count(items, (r) => cadenceOf.get(r.id)),
    slo: count(items, (r) => r.sloStatus),
    verdict: count(items, (r) => (r.quality ? r.quality.verdict : null))
  };
  return { items, facets, total: items.length };
}

async function layers(db) {
  const items = await layerDocs(db);
  return {
    items,
    facets: {
      tier: count(items, (l) => l.tier),
      kind: count(items, (l) => l.kind),
      owner: count(items, (l) => l.ownerHe)
    },
    total: items.length
  };
}

async function layerDetail(db, id) {
  const row = await db.get("SELECT detail FROM layer WHERE id = ? AND deleted = 0", [id]);
  if (!row) return null;
  const out = JSON.parse(row.detail);
  const columns = await db.all("SELECT doc FROM layer_column WHERE layer_id = ? ORDER BY ordinal", [id]);
  const samples = await db.all("SELECT doc FROM sample_row WHERE layer_id = ? ORDER BY row_no", [id]);
  if (columns.length) out.columns = columns.map((c) => JSON.parse(c.doc));
  if (samples.length) out.sampleRows = samples.map((s) => JSON.parse(s.doc));
  return out;
}

function typeOf(name) {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

async function buildFile(db, name) {
  let m;
  let value = null;
  if (name === "consumer/repositories.json") value = await repositories(db);
  else if (name === "consumer/layers.json") value = await layers(db);
  else if ((m = name.match(/^consumer\/repositories__(\d+)\.json$/))) {
    const row = await db.get("SELECT doc FROM repository WHERE id = ? AND deleted = 0", [Number(m[1])]);
    value = row ? JSON.parse(row.doc) : null;
  } else if ((m = name.match(/^consumer\/repositories__(\d+)__layers\.json$/))) {
    const exists = await db.get("SELECT id FROM repository WHERE id = ? AND deleted = 0", [Number(m[1])]);
    value = exists ? await layerDocs(db, Number(m[1])) : null;
  } else if ((m = name.match(/^consumer\/layers__(\d+)\.json$/))) value = await layerDetail(db, Number(m[1]));
  else {
    const row = await db.get("SELECT body FROM payload WHERE name = ?", [name]);
    return row ? { type: typeOf(name), body: row.body } : null;
  }
  return value === null ? null : { type: typeOf(name), body: JSON.stringify(value) };
}

module.exports = { buildFile };
