"use strict";
// Shared admin state. The front end keeps four things in the browser: registered datasets, access
// overrides, edits and deletions. The server stores each as one JSON document so every browser sees them.

const EDIT_FIELDS = ["nameHe", "purposeHe", "ownerHe", "ownerPhone", "stewardHe", "custodianHe"];
const KEYS = ["datasets", "access", "edits", "deleted"];
const EMPTY = { datasets: [], access: {}, edits: {}, deleted: [] };

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isId = (k) => /^\d{1,9}$/.test(k);
const text = (v, max) => (typeof v === "string" && v.length <= max ? v : null);

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };

function clean(key, value) {
  switch (key) {
    case "datasets": {
      if (!Array.isArray(value) || value.length > 200) fail("datasets must be a list of at most 200");
      for (const d of value) {
        if (!isPlainObject(d) || !Number.isInteger(d.repoId) || d.repoId < 1 || !Number.isInteger(d.layerId) || d.layerId < 1) fail("each dataset needs numeric repoId and layerId");
        if (!isPlainObject(d.files) || Object.keys(d.files).length > 60) fail("each dataset needs a files object");
        if (!isPlainObject(d.list) || !isPlainObject(d.list.repo) || !isPlainObject(d.list.layer)) fail("each dataset needs list.repo and list.layer");
      }
      return value;
    }
    case "access": {
      if (!isPlainObject(value) || Object.keys(value).length > 500) fail("access must be an object");
      const out = {};
      for (const [id, v] of Object.entries(value)) {
        if (!isId(id) || !isPlainObject(v) || typeof v.blocked !== "boolean") fail("access entries need a numeric id and a boolean blocked");
        out[id] = { blocked: v.blocked };
        for (const f of ["reasonHe", "reasonEn"]) if (v[f] !== undefined) { const s = text(v[f], 500); if (s === null) fail(`${f} is too long`); out[id][f] = s; }
      }
      return out;
    }
    case "edits": {
      if (!isPlainObject(value) || Object.keys(value).length > 500) fail("edits must be an object");
      const out = {};
      for (const [id, v] of Object.entries(value)) {
        if (!isId(id) || !isPlainObject(v)) fail("edits entries need a numeric id and an object");
        out[id] = {};
        for (const f of EDIT_FIELDS) if (v[f] !== undefined) { const s = text(v[f], 2000); if (s === null) fail(`${f} must be text of at most 2000 characters`); out[id][f] = s; }
      }
      return out;
    }
    case "deleted": {
      if (!Array.isArray(value) || value.length > 500) fail("deleted must be a list");
      return value.map((v) => { const s = String(v); if (!isId(s)) fail("deleted holds numeric ids"); return s; });
    }
    default:
      return fail("unknown state key");
  }
}

async function readState(db) {
  const state = JSON.parse(JSON.stringify(EMPTY));
  const col = db.driver === "mssql" ? "[key]" : "key";
  for (const row of await db.all(`SELECT ${col} AS k, body FROM app_state`)) {
    if (KEYS.includes(row.k)) {
      try { state[row.k] = JSON.parse(row.body); } catch { /* keep the empty value */ }
    }
  }
  return state;
}

async function writeState(db, key, value, actor) {
  const body = JSON.stringify(clean(key, value));
  const col = db.driver === "mssql" ? "[key]" : "key";
  const count = Array.isArray(JSON.parse(body)) ? JSON.parse(body).length : Object.keys(JSON.parse(body)).length;
  await db.tx(async (t) => {
    await t.run(`DELETE FROM app_state WHERE ${col} = ?`, [key]);
    await t.run(`INSERT INTO app_state (${col}, body) VALUES (?, ?)`, [key, body]);
    await t.run("INSERT INTO audit (actor, action, entity, payload) VALUES (?, ?, ?, ?)", [actor, "state.put", key, JSON.stringify({ entries: count, bytes: body.length })]);
  });
  return { key, entries: count };
}

module.exports = { KEYS, readState, writeState, Invalid };
