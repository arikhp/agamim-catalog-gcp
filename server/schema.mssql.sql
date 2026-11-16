-- Catalog schema, Azure SQL (T-SQL) flavour. Same tables as schema.sqlite.sql.
-- Safe to run repeatedly: each table is created only if it does not exist.

IF OBJECT_ID(N'dbo.repository', N'U') IS NULL
CREATE TABLE dbo.repository (
  id      INT           NOT NULL PRIMARY KEY,
  pos     INT           NOT NULL,
  doc     NVARCHAR(MAX) NOT NULL,
  deleted INT           NOT NULL DEFAULT 0
);

IF OBJECT_ID(N'dbo.layer', N'U') IS NULL
CREATE TABLE dbo.layer (
  id       INT           NOT NULL PRIMARY KEY,
  repo_id  INT           NOT NULL REFERENCES dbo.repository(id),
  pos      INT           NOT NULL,
  sql_name NVARCHAR(200) NOT NULL UNIQUE,
  doc      NVARCHAR(MAX) NOT NULL,
  detail   NVARCHAR(MAX) NOT NULL,
  deleted  INT           NOT NULL DEFAULT 0
);

IF OBJECT_ID(N'dbo.layer_column', N'U') IS NULL
CREATE TABLE dbo.layer_column (
  layer_id INT           NOT NULL REFERENCES dbo.layer(id),
  ordinal  INT           NOT NULL,
  doc      NVARCHAR(MAX) NOT NULL,
  PRIMARY KEY (layer_id, ordinal)
);

IF OBJECT_ID(N'dbo.sample_row', N'U') IS NULL
CREATE TABLE dbo.sample_row (
  layer_id INT           NOT NULL REFERENCES dbo.layer(id),
  row_no   INT           NOT NULL,
  doc      NVARCHAR(MAX) NOT NULL,
  PRIMARY KEY (layer_id, row_no)
);

IF OBJECT_ID(N'dbo.payload', N'U') IS NULL
CREATE TABLE dbo.payload (
  name NVARCHAR(400)  NOT NULL PRIMARY KEY,
  body NVARCHAR(MAX)  NOT NULL
);

IF OBJECT_ID(N'dbo.audit', N'U') IS NULL
CREATE TABLE dbo.audit (
  id      BIGINT IDENTITY(1,1) PRIMARY KEY,
  at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  actor   NVARCHAR(200) NOT NULL,
  action  NVARCHAR(100) NOT NULL,
  entity  NVARCHAR(200) NOT NULL,
  payload NVARCHAR(MAX) NULL
);

IF OBJECT_ID(N'dbo.app_state', N'U') IS NULL
CREATE TABLE dbo.app_state (
  [key]      NVARCHAR(100) NOT NULL PRIMARY KEY,
  body       NVARCHAR(MAX) NOT NULL,
  updated_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.source_meta', N'U') IS NULL
CREATE TABLE dbo.source_meta (
  sql_name NVARCHAR(200) NOT NULL PRIMARY KEY,
  doc      NVARCHAR(MAX) NOT NULL
);

IF OBJECT_ID(N'dbo.harvest_run', N'U') IS NULL
CREATE TABLE dbo.harvest_run (
  id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  started_at  NVARCHAR(40) NOT NULL,
  finished_at NVARCHAR(40) NULL,
  status      NVARCHAR(20) NOT NULL,
  summary     NVARCHAR(MAX) NULL
);

IF OBJECT_ID(N'dbo.app_user', N'U') IS NULL
CREATE TABLE dbo.app_user (
  user_id       NVARCHAR(100) NOT NULL PRIMARY KEY,
  role          NVARCHAR(20)  NOT NULL,
  display_name  NVARCHAR(200) NOT NULL,
  password_hash NVARCHAR(400) NOT NULL
);
