"use strict";
// The harvester: reads the structure and statistics of the source tables (schema "curated") and
// rebuilds the list of tables a product manager can register (data/staging/db-tables.json).
// Structure and numbers come from the database; titles, owners and descriptions come from source_meta.
const { quote } = require("./source");

const STAGING_FILE = "staging/db-tables.json";

// Other databases the harvester reads besides the catalog database's "curated" schema, e.g. the gold database
// that Azure Data Factory loads. Set by the server at startup: addSource({ db, schema: "dbo", label: "gold" }).
const extraSources = [];
function addSource(source) { extraSources.push(source); }

// Descriptions for tables that Data Factory loads into gold, used when source_meta has no row for them.
const GOLD_META = {
  "gold.dim_city_weather": {
    dbName: "db-gold",
    titleHe: "מזג אוויר נוכחי לפי עיר",
    titleEn: "Current weather by city",
    cadence: "every10min",
    loadedBy: "Azure Data Factory",
    loadTime: "every 10 min",
    columns: [
      { name: "city_id", descHe: "מזהה עיר", descEn: "City id (dim_city)" },
      { name: "city_name", descHe: "שם העיר באנגלית", descEn: "City name (English)" },
      { name: "observed_local", descHe: "זמן המדידה (שעון מקומי)", descEn: "Observation time, local" },
      { name: "TLV_TIME", descHe: "זמן המדידה בשעון תל אביב", descEn: "Observation time, Tel Aviv local time" },
      { name: "temperature_c", descHe: "טמפרטורה (°C)", descEn: "Temperature (C)" },
      { name: "feels_like_c", descHe: "טמפרטורה מורגשת (°C)", descEn: "Feels-like temperature (C)" },
      { name: "humidity_pct", descHe: "לחות יחסית (%)", descEn: "Relative humidity (%)" },
      { name: "precipitation_mm", descHe: "משקעים (מ\"מ)", descEn: "Precipitation (mm)" },
      { name: "cloud_cover_pct", descHe: "כיסוי עננים (%)", descEn: "Cloud cover (%)" },
      { name: "wind_kmh", descHe: "מהירות רוח (קמ\"ש)", descEn: "Wind speed (km/h)" },
      { name: "wind_dir_deg", descHe: "כיוון רוח (מעלות)", descEn: "Wind direction (degrees)" },
      { name: "wind_dir_name", descHe: "כיוון רוח (N, NE, E...)", descEn: "Wind direction name" },
      { name: "weather_code", descHe: "קוד מזג אוויר WMO", descEn: "WMO weather code" },
      { name: "weather_desc", descHe: "תיאור מזג האוויר", descEn: "Weather description" },
      { name: "is_day", descHe: "יום (1) או לילה (0)", descEn: "Daytime flag" },
      { name: "elevation_m", descHe: "גובה (מטר)", descEn: "Elevation (m)" },
      { name: "updated_utc", descHe: "זמן העדכון האחרון (UTC)", descEn: "Last refresh (UTC)" }
    ]
  },
  "gold.usgs_quakes": {
    dbName: "db-gold",
    titleHe: "רעידות אדמה (USGS)",
    titleEn: "Earthquakes (USGS)",
    cadence: "every10min",
    loadedBy: "Azure Data Factory",
    loadTime: "every 10 min",
    columns: [
      { name: "id", descHe: "מזהה אירוע USGS", descEn: "USGS event id" },
      { name: "mag", descHe: "עוצמה", descEn: "Magnitude" },
      { name: "place", descHe: "תיאור מיקום", descEn: "Place description" },
      { name: "event_type", descHe: "סוג אירוע", descEn: "Event type" },
      { name: "time_ms", descHe: "זמן האירוע (אלפיות שנייה מ-1970)", descEn: "Event time (epoch ms)" },
      { name: "updated_ms", descHe: "עדכון אחרון (אלפיות שנייה מ-1970)", descEn: "Last update (epoch ms)" },
      { name: "longitude", descHe: "קו אורך", descEn: "Longitude" },
      { name: "latitude", descHe: "קו רוחב", descEn: "Latitude" },
      { name: "depth_km", descHe: "עומק בק\"מ", descEn: "Depth in km" },
      { name: "ingested_utc", descHe: "זמן קליטה", descEn: "Ingest time (UTC)" },
      { name: "TLV_TIME", descHe: "זמן האירוע בשעון תל אביב", descEn: "Event time, Tel Aviv local time" },
      { name: "event_utc", descHe: "זמן האירוע (UTC)", descEn: "Event time (UTC)" }
    ]
  }
};
const SAMPLE_ROWS = 6;

function logicalType(raw, metaType) {
  const t = String(raw || "").toLowerCase();
  if (metaType && /^geometry/i.test(metaType)) return metaType; // geometry is stored as WKT text
  let m;
  if (t === "int" || t === "integer" || t === "bigint" || t === "smallint") return "int";
  if ((m = /^n?varchar\((\w+)\)$/.exec(t))) return `varchar(${m[1]})`;
  if (t === "bit" || t === "boolean") return "boolean";
  if (t === "datetime2" || t === "datetime" || t === "timestamp") return "timestamp";
  if (t === "float" || t === "real" || t === "double") return "float";
  return raw;
}

const round1 = (n) => Math.round(n * 10) / 10;
const iso = (v) => (v instanceof Date ? v.toISOString() : v);

async function describeTable(db, schema, t, meta, label = schema) {
  const ref = `${schema}.${quote(db, t.table)}`;
  const rowCount = Number((await db.get(`SELECT COUNT(*) AS n FROM ${ref}`)).n);
  const orderBy = quote(db, (t.columns.find((c) => c.pk) || t.columns[0]).name);
  const rows = await db.all(
    db.driver === "mssql"
      ? `SELECT TOP ${SAMPLE_ROWS} * FROM ${ref} ORDER BY ${orderBy}`
      : `SELECT * FROM ${ref} ORDER BY ${orderBy} LIMIT ${SAMPLE_ROWS}`
  );
  const known = new Map((meta.columns || []).map((c) => [c.name, c]));

  const columns = [];
  for (const c of t.columns) {
    const prior = known.get(c.name) || { descHe: "", descEn: "", pii: false };
    const type = logicalType(c.type, prior.type);
    const q = quote(db, c.name);
    const stats = await db.get(`SELECT COUNT(*) - COUNT(${q}) AS nulls, COUNT(DISTINCT ${q}) AS d FROM ${ref}`);
    let min = null;
    let max = null;
    if (type === "int" && rowCount) {
      const range = await db.get(`SELECT MIN(${q}) AS mn, MAX(${q}) AS mx FROM ${ref}`);
      min = range.mn === null ? null : String(range.mn);
      max = range.mx === null ? null : String(range.mx);
    }
    columns.push({
      ...prior,
      name: c.name,
      type,
      nullable: c.nullable,
      pk: c.pk,
      emptyPct: rowCount ? round1((100 * Number(stats.nulls)) / rowCount) : 0,
      distinct: Number(stats.d),
      min,
      max
    });
  }

  const sampleRows = rows.map((r) => {
    const out = {};
    for (const c of columns) {
      const v = r[c.name];
      out[c.name] = v === null || v === undefined ? null : c.type === "boolean" ? Boolean(v) : iso(v);
    }
    return out;
  });

  // Last update: newest value of an updated_at column, else what the metadata says.
  let lastUpdated = meta.lastUpdated || null;
  if (columns.some((c) => c.name === "updated_at") && rowCount) {
    const latest = await db.get(`SELECT MAX(${quote(db, "updated_at")}) AS m FROM ${ref}`);
    if (latest.m) lastUpdated = iso(latest.m instanceof Date ? latest.m : new Date(latest.m)).toString();
  }
  const documented = columns.filter((c) => c.descHe).length;
  const measured = (field) => meta.quality && typeof meta.quality[field] === "number" ? meta.quality[field] : null;
  const avgEmpty = columns.length ? columns.reduce((a, c) => a + c.emptyPct, 0) / columns.length : 0;
  const pkCol = columns.find((c) => c.pk);
  const geometryColumn = columns.find((c) => /^geometry\(/i.test(c.type));
  const minutesOld = lastUpdated ? Math.max(0, Math.round((Date.now() - new Date(lastUpdated).getTime()) / 60000)) : 0;

  return {
    sqlName: `${label}.${t.table}`,
    dbName: meta.dbName || "db-oref-base",
    titleHe: meta.titleHe || t.table,
    titleEn: meta.titleEn || t.table,
    kind: meta.kind || "table",
    geometry: meta.geometry || (geometryColumn ? /^geometry\((\w+)/i.exec(geometryColumn.type)[1] : "None"),
    rowCount,
    createdAt: meta.createdAt || new Date().toISOString().slice(0, 10),
    lastUpdated,
    cadence: meta.cadence || "onChange",
    loadedBy: meta.loadedBy || "צוות Data Engineering",
    loadTime: meta.loadTime || "00:00",
    freshnessMin: typeof meta.freshnessMin === "number" ? meta.freshnessMin : minutesOld,
    failedLoads30: typeof meta.failedLoads30 === "number" ? meta.failedLoads30 : 0,
    docs: { documented, total: columns.length },
    // Completeness and uniqueness are measured here; the other quality scores come from the metadata
    // and default to 100 for a table nobody has described yet.
    quality: {
      completeness: Math.round(100 - avgEmpty),
      timeliness: measured("timeliness") ?? 100,
      consistency: measured("consistency") ?? 100,
      accuracy: measured("accuracy") ?? 100,
      uniqueness: pkCol && rowCount ? Math.round((100 * pkCol.distinct) / rowCount) : 100
    },
    columns,
    sampleRows
  };
}

async function harvest(db, { schema = "curated" } = {}) {
  const started = new Date().toISOString();
  await db.run("INSERT INTO harvest_run (started_at, status) VALUES (?, ?)", [started, "running"]);
  const runId = (await db.get("SELECT MAX(id) AS id FROM harvest_run")).id;
  try {
    const metaByName = new Map(
      (await db.all("SELECT sql_name, doc FROM source_meta")).map((r) => [r.sql_name, JSON.parse(r.doc)])
    );
    const tables = [];
    for (const t of await db.describeSchema(schema)) {
      tables.push(await describeTable(db, schema, t, metaByName.get(`${schema}.${t.table}`) || {}));
    }
    const seen = new Set(tables.map((t) => t.sqlName.split(".")[1]));
    for (const src of extraSources) {
      for (const t of await src.db.describeSchema(src.schema)) {
        if (seen.has(t.table) || /^(stg_|rejected_)/.test(t.table)) continue; // working tables are not datasets
        if (false) continue; // already listed from curated (Data Flow reloads those into gold)
        const name = `${src.label}.${t.table}`;
        const meta = metaByName.get(name) || GOLD_META[name] || {};
        tables.push(await describeTable(src.db, src.schema, t, meta, src.label));
      }
    }
    const doc = {
      synthetic: true,
      note: "Source tables in the curated schema, read by the harvester. Descriptions come from source_meta.",
      generatedAt: new Date().toISOString(),
      tables
    };
    await db.tx(async (t) => {
      await t.run("DELETE FROM payload WHERE name = ?", [STAGING_FILE]);
      await t.run("INSERT INTO payload (name, body) VALUES (?, ?)", [STAGING_FILE, JSON.stringify(doc)]);
    });
    const summary = {
      tables: tables.length,
      columns: tables.reduce((n, t) => n + t.columns.length, 0),
      rows: tables.reduce((n, t) => n + t.rowCount, 0)
    };
    await db.run("UPDATE harvest_run SET finished_at = ?, status = ?, summary = ? WHERE id = ?", [new Date().toISOString(), "ok", JSON.stringify(summary), runId]);
    return { runId, startedAt: started, ...summary };
  } catch (err) {
    await db.run("UPDATE harvest_run SET finished_at = ?, status = ?, summary = ? WHERE id = ?", [new Date().toISOString(), "failed", String(err.message).slice(0, 2000), runId]);
    throw err;
  }
}

module.exports = { harvest, addSource, STAGING_FILE };
