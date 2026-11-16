"use strict";
// Thin async database interface. Today: SQLite (node:sqlite) for local runs and tests.
// Azure SQL (mssql) is added as a second driver with the same shape in the Azure phase.
const fs = require("fs");
const path = require("path");

async function open(opts = {}) {
  const driver = opts.driver || process.env.DB_DRIVER || "sqlite";
  if (driver === "sqlite") return openSqlite(opts.file || process.env.SQLITE_FILE || ":memory:");
  if (driver === "mssql") return openMssql(opts);
  throw new Error(`Unknown DB driver: ${driver}`);
}

// Azure SQL. Same interface as the SQLite driver. "?" placeholders become @p0, @p1, ...
// The mssql package is loaded only here, so local runs and tests do not need it.
async function openMssql(opts) {
  const sql = require("mssql");
  const env = process.env;
  const pool = await new sql.ConnectionPool({
    server: opts.server || env.MSSQL_SERVER,
    database: opts.database || env.MSSQL_DATABASE,
    user: opts.user || env.MSSQL_USER,
    password: opts.password || env.MSSQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 30000,
    requestTimeout: 60000
  }).connect();

  const bind = (request, params) => {
    params.forEach((value, i) => {
      if (value === null || value === undefined) request.input(`p${i}`, sql.NVarChar(sql.MAX), null);
      else if (typeof value === "number" && Number.isInteger(value)) request.input(`p${i}`, Math.abs(value) > 2147483647 ? sql.BigInt : sql.Int, value);
      else if (typeof value === "number") request.input(`p${i}`, sql.Float, value);
      else if (value instanceof Date) request.input(`p${i}`, sql.DateTime2, value);
      else request.input(`p${i}`, sql.NVarChar(sql.MAX), String(value));
    });
    return request;
  };
  const numbered = (text) => { let n = 0; return text.replace(/\?/g, () => `@p${n++}`); };

  // "target" is the pool, or a transaction inside tx().
  const api = (target) => ({
    driver: "mssql",
    async exec(text) { await new sql.Request(target).batch(text); },
    async all(text, params = []) { return (await bind(new sql.Request(target), params).query(numbered(text))).recordset || []; },
    async get(text, params = []) { return (await this.all(text, params))[0]; },
    async run(text, params = []) {
      const result = await bind(new sql.Request(target), params).query(numbered(text));
      return { changes: result.rowsAffected.reduce((a, b) => a + b, 0) };
    },
    async tx(fn) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const result = await fn(api(transaction));
        await transaction.commit();
        return result;
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    },
    async close() { await pool.close(); },
    async ensureSchema(name) {
      await this.exec(`IF SCHEMA_ID(N'${name}') IS NULL EXEC(N'CREATE SCHEMA ${name}')`);
    },
    // [{ table, columns: [{ name, type, nullable, pk }] }] for every base table in a schema.
    async describeSchema(schema) {
      const tables = await this.all("SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", [schema]);
      const out = [];
      for (const { t } of tables) {
        const cols = await this.all(
          "SELECT COLUMN_NAME AS name, DATA_TYPE AS dt, CHARACTER_MAXIMUM_LENGTH AS len, IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
          [schema, t]
        );
        const pks = new Set((await this.all(
          "SELECT kcu.COLUMN_NAME AS name FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?",
          [schema, t]
        )).map((r) => r.name));
        out.push({
          table: t,
          columns: cols.map((c) => ({
            name: c.name,
            type: c.len === null || c.len === undefined ? c.dt : `${c.dt}(${c.len === -1 ? "max" : c.len})`,
            nullable: c.nullable === "YES",
            pk: pks.has(c.name)
          }))
        });
      }
      return out;
    }
  });
  return api(pool);
}

function openSqlite(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // The source tables live in their own schema, like "curated" in Azure SQL.
  db.exec(file === ":memory:" ? "ATTACH DATABASE ':memory:' AS curated" : `ATTACH DATABASE '${file.replace(/'/g, "''")}-curated' AS curated`);
  const self = {
    driver: "sqlite",
    async exec(sql) { db.exec(sql); },
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async get(sql, params = []) { return db.prepare(sql).get(...params); },
    async run(sql, params = []) { return db.prepare(sql).run(...params); },
    async tx(fn) {
      db.exec("BEGIN");
      try {
        const result = await fn(self);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async close() { db.close(); },
    async ensureSchema() {},
    async describeSchema(schema) {
      const tables = db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
      return tables.map(({ name }) => ({
        table: name,
        columns: db.prepare(`PRAGMA ${schema}.table_info("${name}")`).all().map((c) => ({
          name: c.name,
          type: c.type,
          nullable: !c.notnull && !c.pk,
          pk: !!c.pk
        }))
      }));
    }
  };
  return self;
}

async function migrate(db) {
  const sql = fs.readFileSync(path.join(__dirname, `schema.${db.driver}.sql`), "utf8");
  await db.exec(sql);
  await db.ensureSchema("curated");
}

module.exports = { open, migrate };
