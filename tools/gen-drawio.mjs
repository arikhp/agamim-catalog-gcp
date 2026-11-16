// Generates docs/architecture/*.drawio and docs/architecture/index.html from the node/edge lists below.
// Run: node tools/gen-drawio.mjs
// Icons are draw.io's built-in Google Cloud stencils (mxgraph.gcp3.*). Products without their own stencil
// use the matching category icon and a clear label.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../docs/architecture/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ICON = {
  run: ["cloudrun", "#4285f4"], storage: ["cloud_storage", "#4285f4"], bq: ["bigquery", "#4285f4"],
  alloy: ["alloydb", "#4285f4"], sql: ["cloudsql", "#4285f4"], net: ["networking", "#4285f4"],
  sec: ["securityidentity", "#ea4335"], scc: ["securitycommandcenter", "#ea4335"], obs: ["observability", "#34a853"],
  ops: ["operations", "#34a853"], dev: ["devops", "#fbbc04"], data: ["dataanalytics", "#4285f4"],
  serverless: ["serverlesscomputing", "#4285f4"], mgmt: ["managementtools", "#34a853"], integ: ["integrationservices", "#4285f4"],
  compute: ["compute", "#4285f4"], tools: ["developer_tools", "#fbbc04"]
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Wrap a label to about `max` characters per line and use <br> (cells are html=1).
const wrap = (text, max = 17) => text.split("\n").flatMap((line) => {
  const out = []; let cur = "";
  for (const w of line.split(" ")) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur); return out;
}).join("<br>");
const lab = (t, icon) => esc(icon ? wrap(t) : t.replace(/\n/g, "<br>"));

function diagram(name, title, W, H, spec) {
  let id = 2;
  const cells = [];
  const pos = {};
  const nid = () => `c${id++}`;
  const ids = {};
  const add = (xml) => cells.push(xml);

  // title
  add(`<mxCell id="${nid()}" value="${esc(title)}" style="text;html=1;fontSize=20;fontStyle=1;align=left;fontColor=#202124;" vertex="1" parent="1"><mxGeometry x="20" y="10" width="${W - 40}" height="30" as="geometry"/></mxCell>`);

  for (const g of spec.groups || []) {
    const gid = nid(); ids[g.id] = gid; pos[g.id] = { x: g.x, y: g.y };
    const dash = g.dashed ? "dashed=1;" : "";
    add(`<mxCell id="${gid}" value="${esc(g.label)}" style="rounded=1;arcSize=3;whiteSpace=wrap;html=1;container=1;collapsible=0;fillColor=${g.fill || "#f8f9fa"};strokeColor=${g.stroke || "#dadce0"};${dash}verticalAlign=top;align=left;spacingLeft=12;spacingTop=4;fontStyle=1;fontSize=12;fontColor=${g.color || "#5f6368"};" vertex="1" parent="1"><mxGeometry x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" as="geometry"/></mxCell>`);
  }
  for (const n of spec.nodes) {
    const nidv = nid(); ids[n.id] = nidv;
    const parent = n.in ? ids[n.in] : "1";
    const ox = n.in ? pos[n.in].x : 0, oy = n.in ? pos[n.in].y : 0;
    const x = n.x - ox, y = n.y - oy;
    if (n.icon) {
      const [shape, color] = ICON[n.icon];
      add(`<mxCell id="${nidv}" value="${lab(n.label, true)}" style="sketch=0;html=1;verticalAlign=top;labelPosition=center;verticalLabelPosition=bottom;align=center;fontSize=11;fontColor=#202124;aspect=fixed;pointerEvents=1;shape=mxgraph.gcp3.${shape};fillColor=${color};strokeColor=none;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="56" height="56" as="geometry"/></mxCell>`);
    } else if (n.actor) {
      add(`<mxCell id="${nidv}" value="${lab(n.label, false)}" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontSize=11;fillColor=#e8eaed;strokeColor=#5f6368;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="30" height="56" as="geometry"/></mxCell>`);
    } else {
      add(`<mxCell id="${nidv}" value="${lab(n.label, false)}" style="rounded=1;whiteSpace=wrap;html=1;fontSize=11;fillColor=${n.fill || "#ffffff"};strokeColor=${n.stroke || "#5f6368"};fontColor=#202124;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${n.w || 120}" height="${n.h || 44}" as="geometry"/></mxCell>`);
    }
  }
  for (const e of spec.edges || []) {
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=${e.color || "#5f6368"};fontSize=10;fontColor=#5f6368;${e.dashed ? "dashed=1;" : ""}labelBackgroundColor=#ffffff;`;
    add(`<mxCell id="${nid()}" value="${esc(e.label || "")}" style="${style}" edge="1" parent="1" source="${ids[e.from]}" target="${ids[e.to]}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  }
  const xml = `<mxfile host="app.diagrams.net"><diagram name="${esc(title)}" id="${name}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${W}" pageHeight="${H}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
  writeFileSync(join(OUT, `${name}.drawio`), xml);
  return { name, title, xml, W, H };
}

const D = [];

// 1. Overview of one environment
D.push(diagram("01-overview", "Solution overview (one environment, Israel me-west1)", 1420, 780, {
  groups: [
    { id: "edge", label: "Edge (global services)", x: 130, y: 70, w: 320, h: 290 },
    { id: "run", label: "Serving (me-west1)", x: 480, y: 70, w: 450, h: 290 },
    { id: "data", label: "Data (me-west1)", x: 960, y: 70, w: 440, h: 290 },
    { id: "ident", label: "Identity and secrets", x: 130, y: 400, w: 440, h: 150 },
    { id: "jobs", label: "Batch (me-west1)", x: 600, y: 400, w: 330, h: 150 },
    { id: "ops", label: "Operations and security", x: 130, y: 580, w: 1270, h: 170, fill: "#f1f8f4" }
  ],
  nodes: [
    { id: "users", label: "Consumers", actor: true, x: 40, y: 120 },
    { id: "staff", label: "Admins (staff)", actor: true, x: 40, y: 240 },
    { id: "dns", label: "Cloud DNS", icon: "net", x: 160, y: 110, in: "edge" },
    { id: "armor", label: "Cloud Armor (WAF)", icon: "sec", x: 320, y: 110, in: "edge" },
    { id: "alb", label: "Global ALB + CDN + managed cert", icon: "net", x: 320, y: 240, in: "edge" },
    { id: "site", label: "Cloud Storage: consumer site", icon: "storage", x: 510, y: 110, in: "run" },
    { id: "api", label: "Cloud Run: catalog API", icon: "run", x: 650, y: 110, in: "run" },
    { id: "admin", label: "Cloud Run: admin portal", icon: "run", x: 790, y: 240, in: "run" },
    { id: "iap", label: "Identity-Aware Proxy", icon: "sec", x: 650, y: 240, in: "run" },
    { id: "alloy", label: "AlloyDB (private IP, HA)", icon: "alloy", x: 990, y: 110, in: "data" },
    { id: "bq", label: "BigQuery: source + usage", icon: "bq", x: 1130, y: 110, in: "data" },
    { id: "dpx", label: "Dataplex Universal Catalog", icon: "data", x: 1270, y: 110, in: "data" },
    { id: "ps", label: "Pub/Sub usage events", icon: "integ", x: 1130, y: 240, in: "data" },
    { id: "idp", label: "Identity Platform (login, MFA)", icon: "sec", x: 160, y: 440, in: "ident" },
    { id: "sm", label: "Secret Manager", icon: "sec", x: 300, y: 440, in: "ident" },
    { id: "kms", label: "Cloud KMS (CMEK)", icon: "sec", x: 440, y: 440, in: "ident" },
    { id: "sch", label: "Cloud Scheduler", icon: "mgmt", x: 640, y: 440, in: "jobs" },
    { id: "job", label: "Cloud Run job: harvest", icon: "run", x: 790, y: 440, in: "jobs" },
    { id: "mon", label: "Monitoring, uptime, SLOs", icon: "obs", x: 160, y: 620, in: "ops" },
    { id: "log", label: "Logging + sink to BigQuery", icon: "obs", x: 330, y: 620, in: "ops" },
    { id: "scc", label: "Security Command Center", icon: "scc", x: 500, y: 620, in: "ops" },
    { id: "ar", label: "Artifact Registry + Binary Authorization", icon: "tools", x: 670, y: 620, in: "ops" },
    { id: "bud", label: "Budgets and alerts", icon: "mgmt", x: 840, y: 620, in: "ops" }
  ],
  edges: [
    { from: "users", to: "dns" }, { from: "dns", to: "armor" }, { from: "armor", to: "alb" },
    { from: "staff", to: "alb", label: "admin host" },
    { from: "alb", to: "site", label: "/*" }, { from: "alb", to: "api", label: "/api/**" }, { from: "alb", to: "iap" },
    { from: "iap", to: "admin" },
    { from: "api", to: "alloy" }, { from: "admin", to: "api", label: "admin calls" }, { from: "api", to: "ps", label: "events" },
    { from: "ps", to: "bq", label: "BQ subscription" }, { from: "sch", to: "job" },
    { from: "job", to: "bq", label: "read metadata" }, { from: "job", to: "alloy", label: "write catalog" }
  ]
}));

// 2. Projects and environments
D.push(diagram("02-environments", "Projects, environments and promotion", 1280, 700, {
  groups: [
    { id: "gh", label: "GitHub: arikhp/agamim-catalog-gcp", x: 20, y: 60, w: 250, h: 330 },
    { id: "shared", label: "Project: agamim-shared-il", x: 300, y: 60, w: 300, h: 330, fill: "#fef7e0", stroke: "#fbbc04" },
    { id: "dev", label: "Project: agamim-catalog-dev-il", x: 630, y: 60, w: 200, h: 330, fill: "#f8f9fa" },
    { id: "stg", label: "Project: agamim-catalog-stg-il", x: 850, y: 60, w: 200, h: 330 },
    { id: "prod", label: "Project: agamim-catalog-prod-il", x: 1070, y: 60, w: 190, h: 330, fill: "#e6f4ea", stroke: "#34a853" },
    { id: "bill", label: "Billing account (credit) + budgets per project", x: 300, y: 430, w: 960, h: 110, fill: "#fce8e6", stroke: "#ea4335" }
  ],
  nodes: [
    { id: "repo", label: "main (protected)\nrequired checks", w: 200, x: 45, y: 100, in: "gh" },
    { id: "actions", label: "GitHub Actions\ncheck, plan, release, apply", w: 200, x: 45, y: 180, in: "gh" },
    { id: "envs", label: "Environments: dev, staging,\nprod (manual approval)", w: 200, x: 45, y: 270, in: "gh" },
    { id: "tf", label: "Cloud Storage: Terraform state", icon: "storage", x: 330, y: 100, in: "shared" },
    { id: "ar", label: "Artifact Registry (images by digest)", icon: "tools", x: 460, y: 100, in: "shared" },
    { id: "wif", label: "Workload Identity Federation", icon: "sec", x: 330, y: 220, in: "shared" },
    { id: "kms", label: "KMS: attestation signing key", icon: "sec", x: 460, y: 220, in: "shared" },
    { id: "sink", label: "Central log sink (BigQuery)", icon: "obs", x: 400, y: 320, in: "shared" },
    { id: "d1", label: "Cloud Run + bucket\nno load balancer", w: 150, x: 655, y: 110, in: "dev" },
    { id: "d2", label: "Postgres (small) or none", w: 150, x: 655, y: 190, in: "dev" },
    { id: "s1", label: "ALB, CDN, Armor", w: 150, x: 875, y: 110, in: "stg" },
    { id: "s2", label: "Cloud Run + AlloyDB\n(trial cluster)", w: 150, x: 875, y: 190, in: "stg" },
    { id: "s3", label: "applied for release\nwindows only", w: 150, x: 875, y: 270, in: "stg", fill: "#fff8e1" },
    { id: "p1", label: "ALB, CDN, Armor, DNS", w: 150, x: 1090, y: 110, in: "prod" },
    { id: "p2", label: "Cloud Run (canary)\nAlloyDB HA", w: 150, x: 1090, y: 190, in: "prod" },
    { id: "p3", label: "IAP admin, Identity\nPlatform, Dataplex", w: 150, x: 1090, y: 270, in: "prod" },
    { id: "bd", label: "Budget: dev (low)", w: 200, x: 330, y: 470, in: "bill" },
    { id: "bs", label: "Budget: staging", w: 200, x: 580, y: 470, in: "bill" },
    { id: "bp", label: "Budget: prod, alerts at 50/90/100%", w: 260, x: 830, y: 470, in: "bill" }
  ],
  edges: [
    { from: "repo", to: "actions" }, { from: "actions", to: "envs" },
    { from: "actions", to: "wif", label: "OIDC, no keys" },
    { from: "ar", to: "d1", label: "same digest" }, { from: "d1", to: "s1", label: "promote", color: "#1a73e8" },
    { from: "s1", to: "p1", label: "approve + canary", color: "#1a73e8" }
  ]
}));

// 3. Network and security
D.push(diagram("03-network-security", "Network and security (one environment)", 1280, 760, {
  groups: [
    { id: "net", label: "Internet and Google edge", x: 20, y: 60, w: 300, h: 360 },
    { id: "vpc", label: "VPC (me-west1), no public IPs on data", x: 350, y: 60, w: 560, h: 360, fill: "#e8f0fe", stroke: "#4285f4" },
    { id: "psa", label: "Google-managed service network (Private Services Access)", x: 940, y: 60, w: 320, h: 360, fill: "#f8f9fa" },
    { id: "ctl", label: "Preventive and detective controls", x: 20, y: 450, w: 1240, h: 270, fill: "#fce8e6", stroke: "#ea4335" }
  ],
  nodes: [
    { id: "user", label: "Users", actor: true, x: 40, y: 110 },
    { id: "armor", label: "Cloud Armor: OWASP rules, rate limit", icon: "sec", x: 190, y: 110, in: "net" },
    { id: "alb", label: "Global ALB, TLS 1.2+, managed cert", icon: "net", x: 190, y: 250, in: "net" },
    { id: "neg", label: "Serverless NEG", w: 110, x: 380, y: 120, in: "vpc" },
    { id: "run", label: "Cloud Run API\ningress: LB only", icon: "run", x: 570, y: 110, in: "vpc" },
    { id: "egress", label: "Direct VPC egress", w: 120, x: 570, y: 220, in: "vpc" },
    { id: "nat", label: "Cloud NAT (outbound)", icon: "net", x: 770, y: 110, in: "vpc" },
    { id: "pga", label: "Private Google Access\n(BigQuery, Storage)", w: 150, x: 740, y: 250, in: "vpc" },
    { id: "alloy", label: "AlloyDB\nprivate IP only, CMEK", icon: "alloy", x: 1060, y: 110, in: "psa" },
    { id: "iap", label: "Identity-Aware Proxy (admin host)", icon: "sec", x: 400, y: 300, in: "vpc" },
    { id: "iam", label: "Least-privilege service accounts\none per workload", icon: "sec", x: 60, y: 490, in: "ctl" },
    { id: "sm", label: "Secret Manager\nno secrets in env files", icon: "sec", x: 220, y: 490, in: "ctl" },
    { id: "kms", label: "Cloud KMS CMEK\nrotation 90 days", icon: "sec", x: 380, y: 490, in: "ctl" },
    { id: "ba", label: "Binary Authorization\nsigned images only", icon: "sec", x: 540, y: 490, in: "ctl" },
    { id: "scan", label: "Artifact Analysis\nvulnerability scan", icon: "sec", x: 700, y: 490, in: "ctl" },
    { id: "scc", label: "Security Command Center\nfindings", icon: "scc", x: 860, y: 490, in: "ctl" },
    { id: "audit", label: "Audit logs (Admin + Data)\nretained, sunk to BigQuery", icon: "obs", x: 1020, y: 490, in: "ctl" },
    { id: "gh", label: "GitHub scanning:\ngitleaks, CodeQL, Dependabot", w: 180, x: 1060, y: 500, in: "ctl" }
  ],
  edges: [
    { from: "user", to: "armor" }, { from: "armor", to: "alb" }, { from: "alb", to: "neg", label: "/api/**" },
    { from: "neg", to: "run" }, { from: "run", to: "egress" }, { from: "egress", to: "alloy", label: "private IP :5432" },
    { from: "run", to: "nat", dashed: true }, { from: "egress", to: "pga", dashed: true }, { from: "alb", to: "iap", label: "admin.*" }
  ]
}));

// 4. Data flow
D.push(diagram("04-data-flow", "Data flow: catalog, usage and lineage", 1280, 760, {
  groups: [
    { id: "src", label: "Sources", x: 20, y: 60, w: 240, h: 360 },
    { id: "ing", label: "Harvest (nightly)", x: 290, y: 60, w: 260, h: 360 },
    { id: "store", label: "Catalog stores", x: 580, y: 60, w: 330, h: 360 },
    { id: "pub", label: "Publish and serve", x: 940, y: 60, w: 320, h: 360 },
    { id: "use", label: "Usage analytics", x: 20, y: 460, w: 890, h: 260, fill: "#f1f8f4" }
  ],
  nodes: [
    { id: "bqs", label: "BigQuery: source datasets", icon: "bq", x: 60, y: 120, in: "src" },
    { id: "sch", label: "Cloud Scheduler 02:00", icon: "mgmt", x: 330, y: 110, in: "ing" },
    { id: "job", label: "Cloud Run job: harvest", icon: "run", x: 330, y: 270, in: "ing" },
    { id: "alloy", label: "AlloyDB: catalog tables", icon: "alloy", x: 620, y: 110, in: "store" },
    { id: "dpx", label: "Dataplex: lineage, quality, glossary", icon: "data", x: 760, y: 110, in: "store" },
    { id: "mat", label: "materialize.js: build\nconsumer JSON files", w: 150, x: 620, y: 340, in: "store" },
    { id: "site", label: "Cloud Storage: site bucket\ndata/consumer/*.json", icon: "storage", x: 960, y: 110, in: "pub" },
    { id: "cdn", label: "Cloud CDN\nHTTPS to users", icon: "net", x: 1100, y: 110, in: "pub" },
    { id: "api", label: "Cloud Run API\nwrites + admin actions", icon: "run", x: 1030, y: 340, in: "pub" },
    { id: "evt", label: "Browser events\n/api/events", w: 130, x: 50, y: 520, in: "use" },
    { id: "ps", label: "Pub/Sub topic\n+ dead-letter topic", icon: "integ", x: 230, y: 510, in: "use" },
    { id: "usage", label: "BigQuery: usage dataset\n(BQ subscription)", icon: "bq", x: 400, y: 510, in: "use" },
    { id: "log", label: "Logging sink to BigQuery\n(audit + requests)", icon: "obs", x: 570, y: 510, in: "use" },
    { id: "dash", label: "Dashboards: Looker Studio\nor Cloud Monitoring", icon: "data", x: 740, y: 510, in: "use" }
  ],
  edges: [
    { from: "sch", to: "job" }, { from: "job", to: "bqs", label: "read" }, { from: "job", to: "alloy", label: "upsert" },
    { from: "job", to: "dpx", dashed: true, label: "lineage" }, { from: "alloy", to: "mat" }, { from: "mat", to: "site", label: "sync" },
    { from: "site", to: "cdn" }, { from: "api", to: "alloy" }, { from: "evt", to: "ps" }, { from: "ps", to: "usage" },
    { from: "log", to: "usage", dashed: true }, { from: "usage", to: "dash" }
  ]
}));

// 5. CI/CD
D.push(diagram("05-cicd", "CI/CD with GitHub Actions (keyless to Google Cloud)", 1280, 760, {
  groups: [
    { id: "pr", label: "Pull request: check.yml + plan.yml", x: 20, y: 60, w: 400, h: 300 },
    { id: "rel", label: "Merge to main: release.yml", x: 450, y: 60, w: 810, h: 300 },
    { id: "infra", label: "infra-apply.yml (per environment)", x: 20, y: 400, w: 640, h: 330 },
    { id: "run", label: "After release", x: 690, y: 400, w: 570, h: 330, fill: "#f1f8f4" }
  ],
  nodes: [
    { id: "dev", label: "Developer opens PR", w: 150, x: 40, y: 110, in: "pr" },
    { id: "c1", label: "gitleaks, JSON, build dist/\nPlaywright, a11y, unit tests", w: 190, x: 40, y: 190, in: "pr" },
    { id: "c2", label: "terraform fmt/validate\ntflint, checkov, plan comment", w: 190, x: 40, y: 270, in: "pr" },
    { id: "c3", label: "CodeQL, dependency review", w: 150, x: 250, y: 190, in: "pr" },
    { id: "b", label: "Build images\nAPI + harvest", w: 120, x: 480, y: 110, in: "rel" },
    { id: "s", label: "Scan + SBOM", w: 100, x: 620, y: 110, in: "rel" },
    { id: "ar", label: "Push to Artifact Registry\nby digest", icon: "tools", x: 770, y: 100, in: "rel" },
    { id: "at", label: "Sign attestation (KMS)", icon: "sec", x: 920, y: 100, in: "rel" },
    { id: "d", label: "Deploy dev\nauto", w: 100, x: 480, y: 250, in: "rel" },
    { id: "st", label: "Deploy staging\nauto + e2e + smoke", w: 140, x: 620, y: 250, in: "rel" },
    { id: "ap", label: "Prod approval\n(GitHub Environment)", w: 140, x: 790, y: 250, in: "rel", fill: "#fff8e1" },
    { id: "pr10", label: "Prod 10% canary\nhealth gate", w: 120, x: 950, y: 250, in: "rel" },
    { id: "pr100", label: "100% + CDN\ninvalidate", w: 100, x: 1090, y: 250, in: "rel" },
    { id: "i1", label: "Terraform plan\n(PR comment)", w: 120, x: 40, y: 450, in: "infra" },
    { id: "i2", label: "Approve (prod)", w: 110, x: 190, y: 450, in: "infra", fill: "#fff8e1" },
    { id: "i3", label: "Terraform apply\nstate in Cloud Storage", w: 140, x: 330, y: 450, in: "infra" },
    { id: "i4", label: "Nightly drift check\nplan -detailed-exitcode", w: 160, x: 500, y: 450, in: "infra" },
    { id: "wif", label: "Workload Identity Federation\nrepo-scoped, short-lived token", icon: "sec", x: 80, y: 570, in: "infra" },
    { id: "iss", label: "Drift opens a\nGitHub issue", w: 130, x: 500, y: 570, in: "infra" },
    { id: "rb", label: "Rollback: shift traffic to\nprevious Cloud Run revision", w: 190, x: 720, y: 450, in: "run" },
    { id: "ob", label: "Monitoring SLO burn alerts\nauto-halt canary", icon: "obs", x: 760, y: 570, in: "run" },
    { id: "bk", label: "Site rollback: restore previous\nbucket object generation", w: 210, x: 1000, y: 450, in: "run" }
  ],
  edges: [
    { from: "dev", to: "c1" }, { from: "c1", to: "c2" },
    { from: "b", to: "s" }, { from: "s", to: "ar" }, { from: "ar", to: "at" },
    { from: "d", to: "st" }, { from: "st", to: "ap" }, { from: "ap", to: "pr10" }, { from: "pr10", to: "pr100" },
    { from: "at", to: "d" },
    { from: "i1", to: "i2" }, { from: "i2", to: "i3" }, { from: "i3", to: "i4" }, { from: "i4", to: "iss" }
  ]
}));

// Viewer page. The diagrams are embedded so the page also works from a local file.
const tabs = D.map((d, i) => `<button class="tab" data-i="${i}">${esc(d.title.split(" (")[0])}</button>`).join("");
const panes = D.map((d, i) => {
  const cfg = { highlight: "#1a73e8", nav: true, resize: true, toolbar: "zoom layers lightbox", edit: "_blank", xml: d.xml };
  return `<section class="pane" id="p${i}" hidden><div class="mxgraph" style="max-width:100%;" data-mxgraph="${esc(JSON.stringify(cfg))}"></div><p class="file">Editable source: <code>${d.name}.drawio</code> (open in diagrams.net or the draw.io desktop app)</p></section>`;
}).join("\n");
writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agamim Catalog on GCP: architecture</title>
<style>
:root{--bg:#fff;--fg:#202124;--muted:#5f6368;--line:#dadce0;--accent:#1a73e8}
@media (prefers-color-scheme: dark){:root{--bg:#171b22;--fg:#e8eaed;--muted:#9aa0a6;--line:#3c4043;--accent:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;padding:20px max(16px,env(safe-area-inset-left))}
h1{font-size:22px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 16px;max-width:75ch}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.tab{border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit}
.tab[aria-selected="true"]{background:var(--accent);color:#fff;border-color:var(--accent)}
.pane{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px}
.file{color:var(--muted);font-size:12px;margin:8px 4px 0}
</style></head><body>
<h1>Agamim Catalog on GCP</h1>
<p class="sub">Target architecture in Israel (me-west1). Use the toolbar to zoom, switch layers or open a diagram full screen. Needs internet access to load the draw.io viewer.</p>
<div class="tabs" role="tablist">${tabs}</div>
${panes}
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tab')),panes=[].slice.call(document.querySelectorAll('.pane'));
  function show(i){tabs.forEach(function(t,k){t.setAttribute('aria-selected',String(k===i))});panes.forEach(function(p,k){p.hidden=k!==i});if(window.GraphViewer)GraphViewer.processElements();location.hash='d'+i}
  tabs.forEach(function(t,k){t.onclick=function(){show(k)}});
  var m=/^#d(\\d)$/.exec(location.hash);show(m?+m[1]:0);
})();
</script></body></html>
`);
console.log("wrote", D.map((d) => d.name + ".drawio").join(", "), "and index.html");
