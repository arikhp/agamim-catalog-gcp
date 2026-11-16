"use strict";
// Creates the pilot's source tables (schema "curated") from the staging fixture, plus their descriptive
// metadata. In a real deployment the data engineers own these tables; this stands in for them.
const fs = require("fs");
const path = require("path");

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return name;
}
const quote = (db, name) => (db.driver === "mssql" ? `[${ident(name)}]` : `"${ident(name)}"`);

// Physical column type per database for the fixture's logical types.
function physicalType(db, logical) {
  if (db.driver !== "mssql") return /^geometry/i.test(logical) ? "TEXT" : logical; // geometry is WKT text
  const t = logical.toLowerCase();
  let m;
  if (t === "int") return "INT";
  if ((m = /^varchar\((\d+)\)$/.exec(t))) return `NVARCHAR(${m[1]})`;
  if (t === "boolean") return "BIT";
  if (t === "timestamp") return "DATETIME2";
  if (t === "float") return "FLOAT";
  if (t.startsWith("geometry")) return "NVARCHAR(MAX)"; // stored as WKT text in the pilot
  throw new Error(`No SQL Server type for ${logical}`);
}

function cell(db, column, value) {
  if (value === null || value === undefined) return null;
  const t = column.type.toLowerCase();
  if (t === "boolean") return value ? 1 : 0;
  if (t === "timestamp") return db.driver === "mssql" ? new Date(value) : String(value);
  return value;
}

async function seedSource(db, dataDir) {
  const file = path.join(dataDir, "staging", "db-tables.json");
  if (!fs.existsSync(file)) return { created: 0 };
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const existing = new Set((await db.describeSchema("curated")).map((t) => t.table));
  let created = 0;

  for (const t of fixture.tables) {
    const table = t.sqlName.split(".")[1];
    const { columns, sampleRows, rowCount, ...meta } = t;
    // Descriptive metadata is kept even when the table already exists.
    await db.run("DELETE FROM source_meta WHERE sql_name = ?", [t.sqlName]);
    await db.run("INSERT INTO source_meta (sql_name, doc) VALUES (?, ?)", [t.sqlName, JSON.stringify({ ...meta, columns })]);
    if (existing.has(table)) continue;

    const defs = columns.map((c) => `${quote(db, c.name)} ${physicalType(db, c.type)} ${c.nullable ? "NULL" : "NOT NULL"}`);
    const pk = columns.filter((c) => c.pk).map((c) => quote(db, c.name));
    if (pk.length) defs.push(`PRIMARY KEY (${pk.join(", ")})`);
    await db.exec(`CREATE TABLE curated.${quote(db, table)} (${defs.join(", ")})`);

    const names = columns.map((c) => quote(db, c.name)).join(", ");
    const marks = columns.map(() => "?").join(", ");
    for (const row of sampleRows) {
      await db.run(`INSERT INTO curated.${quote(db, table)} (${names}) VALUES (${marks})`, columns.map((c) => cell(db, c, row[c.name])));
    }
    created++;
  }
  return { created };
}

module.exports = { seedSource, quote, ident };
