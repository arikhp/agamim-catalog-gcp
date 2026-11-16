# Agamim data catalog: project state

Last updated: 2026-11-12

## Where we are

Front-end decision deck is done and the next step is standing up a DataHub back end on Azure for a pilot. **Nothing has been created in Azure yet.** No `infra/` folder exists yet.

## Decisions made

| Topic | Decision | Why |
|---|---|---|
| Scope of the deck | Front end (UI) only. Back end is a separate decision. | PM owns the UI. |
| Recommended front end | Option C: our own front end (the mockup), connected through a thin connection layer (BFF). | Only option with working Hebrew right-to-left today. Survives a back-end or cloud change. |
| Back end for the pilot | **DataHub**, self-hosted on Azure. | Free licence, cloud-neutral (Azure now, GCP later), the only catalog we can fully test without a sales process. |
| Purview | Not chosen. | Azure-centric, conflicts with the GCP move. Not offered in Israel Central. Cost on a $100 student credit is a risk. |
| Collibra | Not chosen for the pilot. | No self-serve catalog trial. About $170k-$225k a year licence (third-party estimates, Vendr median about $197k). Total cost estimated at 3x or more. |
| First step scope | Plan and code only. Create nothing in Azure until approved. | Spends credit, hard to undo. |

## Deliverables so far

- Hebrew 2-slide deck, animated, front-end only: https://claude.ai/artifact/BiE8ep3BxBcaYRSm8Se3rv (not yet visually reviewed by the user)
- Architecture diagram, English: https://claude.ai/artifact/24CaY9DCEUAGUouoXFmTMD
- Amplitude dashboard and PM guide: `amplitude-dashboard.html`, plus the Amplitude dashboard (US project "Data Catalog Demo")
- Mock data generator: `tools/mock-amplitude.mjs` (8,079 mock events sent)

## Target architecture

```
Users (Hebrew, right-to-left)
  -> Our front end (the mockup, in the browser)
  -> Connection layer (small service, BFF): sign-in, caching, search, usage events
  -> DataHub (GraphQL / OpenAPI)
  <- ingestion connectors from data sources (Azure today, GCP later)
Side services: Sign-in (SSO), Amplitude usage tracking
```

On the later GCP move only the ingestion connectors change. Users see no change.

## Azure environment (checked read-only)

- Azure CLI 2.92.0 and Terraform are installed. `az` is signed in.
- Subscription type: **Azure for Students**. $100 credit, expires after 12 months. Subscription is disabled when credit runs out.
- Student subscriptions apply region, quota and SKU restrictions. A deployment can fail even in an allowed region. A 4 vCPU quota is reported by other students.
- Microsoft.Purview provider is registered, but Purview is out of scope.
- Docker and Bicep are not installed locally.
- No SSH public key exists in `~/.ssh`.
- VM size check: `Standard_B2ms` returned nothing for West Europe in the query I ran, which may mean it is not available to this subscription. **Not yet confirmed.** The North Europe query timed out. The last check was stopped by the user.

## Update 2026-11-12 (later): region and size resolved, infra code written

- Providers `Microsoft.Compute` and `Microsoft.Network` registered (user approved). `Microsoft.DevTestLab` (needed for auto-shutdown) is **not yet registered**.
- West Europe is a dead end: only D-series v7 sizes are allowed, and their family quota is 0. B-series and v5/v6 are blocked.
- Checked 8 regions. Only **Israel Central** and **Sweden Central** offer an allowed 8 GB size with quota. Chosen: **`Standard_B2s_v2` in Israel Central** (regional limit 6 vCPUs, family 10). Data stays in Israel.
- Pilot data: sample/mock only.
- `infra/` Terraform written and passes `terraform validate`. No `plan` run yet (needs SSH key and DevTestLab registration). Nothing created in Azure.

## Update 2026-11-15: DataHub dropped, pilot is a static site

- Decision (user): **no catalog back end for the pilot.** Host the existing static site, with its JSON mock data, on **Azure Static Web Apps (Free plan)**. Reason: keep it as simple as possible, and no new datasets will be added through the admin site at this stage.
- DataHub, Purview, OpenMetadata and a custom catalog were all considered. Purview is not offered in Israel Central and has a billing floor (about $300 a month from memory, unverified). Revisit a real back end when real metadata is needed. The front end only needs the same data from a URL instead of a file.
- **Static Web Apps failed.** The subscription's policy "Allowed resource deployment regions" permits only Switzerland North, Germany West Central, France Central, Poland Central and Israel Central. Static Web Apps is offered in none of them (West Europe was rejected with `RequestDisallowedByAzure`).
- **Deployed instead: an Azure Storage static website in Israel Central** (resource group `agamim-catalog-rg`, account `agamimcatdc3eee23`, Standard LRS). Cost is cents a month (not verified against a price page). Live at https://agamimcatdc3eee23.z39.web.core.windows.net/ (deployed 2026-11-15, 64 files).
- `microsoft.Web` was registered for the Static Web Apps attempt and is not needed now. Compute and Network are registered and unused.
- `infra/` holds the Terraform (resource group plus storage account). The static website setting is switched on by `infra/deploy.sh` with the Azure CLI, because the Terraform provider's `static_website` block returned 404s from Azure's API in Israel Central. The VM code is shelved in `infra/_shelved-datahub-vm/`.
- Release: `./infra/deploy.sh` uploads a cleaned copy of the site (no hidden files, tests, tooling, node_modules, mock event files, or the Amplitude PM dashboard). Re-run it after any site change.
- The site is **public**: anyone with the link can open it. Mock data only.
- Open: which catalog back end to use when real metadata arrives (Purview not offered in Israel Central), sign-in beyond the in-page role switch, whether the public link needs protection.
- Architecture diagram (current): https://claude.ai/artifact/K7SpCUg9YkTUUhR9dv2hyd
- The older sections below describe the abandoned DataHub plan and are kept for history.

## Update 2026-11-15 (evening): back end plan approved, local slice built

- **User wants a fully operating back end** (source SQL database -> catalog -> API -> UI, with real writes), Azure only. Plan: `~/.claude/plans/read-project-state-md-and-let-s-valiant-tide.md`.
- Phase 0 done. `Microsoft.Sql` registered. Azure SQL is offered in Israel Central (Free, Basic, serverless) and not in Switzerland North. App Service plans are offered in all five allowed regions; quota is unknown until a plan is created. Entra app registration: can read the tenant, creation untested.
- **Built locally (no Azure spend), under `server/`:** `db.js` (async interface, SQLite driver; Azure SQL driver still to add), `schema.sqlite.sql`, `seed.js`, `materialize.js`, `index.js` (static site plus `/data/*` from the database plus `/api/health`, never serves private files).
- **Tests:** `npm run test:server` (6 pass). A parity test regenerates every file under `data/` from the database and compares it with the fixtures. The full Playwright suite runs against the database-backed server with `BASE_URL=http://127.0.0.1:<port> npx playwright test`: 131 pass, 1 fails. The failing test (`tests/qa.spec.js:374`, navigation-bar alert height, expected 45 got 88) fails the same way against the old static server, so it predates this work.
- A leftover `http-server` (not started by me) may be bound to 127.0.0.1:4173 and shadows other servers on that port. Use another port.
- Not built yet: harvester, write endpoints, front-end changes in `datasets-overlay.js` / `admin-actions.js` / `add-dataset.js`, Azure SQL driver, `infra/` for App Service and SQL.
- Approvals given 2026-11-15: create the App Service plan and Azure SQL database, all under one resource group.

## Update 2026-11-15 (night): back end deployed

- **Live app:** https://agamim-catalog-dc3eee23.azurewebsites.net (App Service B1 Linux, Node 22, Israel Central). `/api/health` reports the `mssql` driver. It serves the site and every `/data/*` file from Azure SQL.
- **Resource group `agamim-catalog-rg`** holds everything: web app, App Service plan, SQL server `agamim-sql-dc3eee23`, database `catalog` (Basic tier), storage account `agamimcatdc3eee23` (old static site, kept as fallback), and the portal dashboard `agamim-catalog-overview` (the dashboard resource sits in Germany West Central because dashboards are not offered in Israel Central).
- **Free SQL offer not used:** the AzureRM provider cannot create it. Basic tier instead (about $5 a month, unverified). App Service B1 is about $13 a month (unverified). Subscription has a spending limit on, so resources are disabled when credit runs out.
- **Verified:** `node server/scripts/live-parity.js <url>` shows all 41 data files match the fixtures from Azure SQL. Private paths return 404. Playwright against live: 130 pass; the navigation-bar tests in `tests/qa.spec.js` (lines 374 and 401) fail intermittently (layout read before it settles). They also failed intermittently on the old static server. `tests/sort.spec.js` default-order test now waits for the final order (a race exposed by network latency).
- **Not verified:** the portal dashboard was created and its 6 tiles are stored, but I could not view it (browser extension not connected). Cost tiles are links; native cost tiles need a one-time "pin" from Cost analysis. No budget yet (needs an alert e-mail: `terraform apply -var alert_email=...`).
- **Deploy:** `infra/deploy-app.sh` builds the bundle and zip-deploys. `infra/deploy.sh` still updates the old storage site.
- **Secrets:** SQL password and admin key are generated by Terraform and live in the local `infra/terraform.tfstate` (git-ignored) and the web app settings. The SQL firewall allows Azure services only. Read the admin key with `terraform output -raw admin_key`. The admin key does nothing yet: write endpoints are not built.
- **Still to build:** real sign-in, a harvester schedule, retire the storage site.

## Update 2026-11-15 (late): source tables, harvester and shared writes are live

- **Source tables:** schema `curated` in Azure SQL holds `public_shelters`, `siren_zones`, `evacuation_routes` (created from `data/staging/db-tables.json`, 6 rows each, geometry stored as WKT text). Descriptions, owners and quality scores that structure cannot tell us live in table `source_meta`.
- **Harvester** (`server/harvest.js`): reads structure and statistics from `curated` and rebuilds `/data/staging/db-tables.json`. Runs at startup and on `POST /api/admin/harvest` (admin key). Row counts are now the real counts (6), not the fixture's 9640. A new table or column appears after the next harvest, with defaults for anything undescribed. Runs are recorded in `harvest_run`.
- **Shared admin changes:** registered datasets, access overrides, edits and deletions are stored in `app_state` (one JSON document each). The server embeds the state in every HTML page (`window.__AGAMIM_STATE`, plus `<meta name="agamim-api">`), and `datasets-overlay.js` loads it into localStorage at start and sends every change back with `PUT /api/state/<name>`. A browser's unsent local changes are never overwritten. On a static host none of it runs (CI unchanged).
- **Admin key:** header `x-admin-key`, asked once per tab with a prompt and kept in sessionStorage. Failures are throttled (10 a minute per IP), bodies capped at 2 MB, input validated, every write recorded in `audit`. It is a stopgap, not sign-in: anyone with the key is an admin. The key is the `admin_key` Terraform output.
- **Verified live (Azure SQL):** startup created the source tables and harvested 3 tables; `live-parity` 41 files match (staging list compared by structure); `tests/shared-state.spec.js` passes against the live app (needs `BASE_URL` and `API_ADMIN_KEY`; skips itself otherwise); full Playwright suite against live: 130 pass, same 2 intermittent navigation-bar tests fail; static mode: 132 pass.
- **Test changes:** `tests/add-dataset.spec.js` reads the expected row count from the served data instead of hard-coding 9,640. `tests/sort.spec.js` default-order test waits for the final order.
- **Server tests:** `npm run test:server` (18 pass: parity, HTTP, API, harvest).
## Update 2026-11-15 (night): mock sign-in, nightly harvest, old work retired

- **Mock sign-in (live):** the site now needs a user ID and password. Two mock accounts, not real users: `admin` (portal admin) and `consumer` (read only). Passwords are generated by Terraform (`random_password`) and are read with `terraform -chdir=infra output -raw mock_admin_password` (and `mock_consumer_password`); the server stores only scrypt hashes in table `app_user`. A session is a signed HttpOnly, SameSite=Lax, Secure cookie, 8 hours. Without a session `/data/*`, `/api/state`, `/api/me` return 401 and the page shows `login.js`'s form. Failed logins are throttled (10 a minute per IP), identical error for a wrong user or password, every login recorded in `audit`.
- **Authorization:** a signed-in admin can save changes and run the harvest (cookie, same-origin check); a consumer gets 403; the shared `x-admin-key` still works for scripts. The key prompt in the browser is gone when login is required. The existing bundle's old splash/6-digit sign-in is hidden: with a session the app starts already signed in. Its own sign-out ends the server session too.
- **Nightly trigger (live):** the web app harvests the source tables every night at 02:00 Asia/Jerusalem (`harvest_at`, `harvest_tz` Terraform variables; `off` disables) and at every start; skipped if one ran in the last 30 minutes. It lives inside the app (B1 is always on). Confirmed in the log: "Next nightly run in 388 minutes".
- **Old work retired:** the storage-account static site was destroyed in Azure (64 files, only a copy of the site), `infra/deploy.sh`, `infra/_shelved-datahub-vm/` (DataHub VM Terraform, never committed) and the saved plan file were deleted. The resource group now holds: web app, App Service plan, SQL server, database, dashboard. Not touched: `.github/workflows/ci.yml` (still deploys the static site to GitHub Pages), the unrelated storage account `sthealthdemo04410` in `rg-customer-health-demo`, the decks and Amplitude work.
- **Verified live (API level, mock credentials):** no session 401 on data, state and me; wrong password and unknown user 401; both logins 200; cookie is HttpOnly, SameSite=Lax, Secure; admin and consumer sessions read data; consumer write and harvest 403; admin write, restore and harvest 200; page with a session embeds session and state; 41 data files still match the originals (`ADMIN_KEY=... node server/scripts/live-parity.js <url>`).
- **Verified locally (browser):** `tests/login.spec.js` (5 pass: form shown, wrong password, admin and consumer sign-in, consumer kept out of the admin page and refused writes, sign-out) against a login-required server with test accounts; `tests/shared-state.spec.js` passes in login mode; whole legacy suite passes on the static server and a no-login database server (132 each, 9 skipped). The browser login screen was not driven against the live Azure host.
- **Test notes:** the legacy specs do not use real sessions (their helper `signIn` stays on the fake sessionStorage sign-in) so their registrations can never be saved to a shared server; against a login-required server they fail at the login form, by design. `x-frame-options` is SAMEORIGIN because the admin drawer embeds the form in an iframe.
- **Server tests:** `npm run test:server` (28 pass, including accounts, sessions, authorization, throttling, the scheduler's time zone math).
- **Behaviour changes to know:** the old splash's "Sign In Completed" analytics event no longer fires (the splash is bypassed). Not done: real sign-in with Microsoft Entra ID, automatic deployment from the repository.
- **Not covered by automated tests on Azure SQL:** the T-SQL paths were exercised only by the live run (startup, harvest endpoint, shared-state spec), not by a local test, because the database accepts connections from Azure services only.

## Planned DataHub setup (abandoned, see 2026-11-15 update)

- One Linux VM running DataHub with Docker. DataHub needs about 2 CPUs, 8 GB RAM, 2 GB swap and 10 GB disk.
- Terraform in `infra/`: resource group, network, firewall limited to the user's own IP, public IP, VM, auto-shutdown schedule to protect credit.
- Then the connection layer and a first end-to-end test: Hebrew search, a dataset page, and the data-origin screen.
- Estimated cost: about $60 a month for an 8 GB VM running all the time (from memory, unverified). Stop the VM when idle.

## Open questions

1. Which VM size and region does the student subscription actually allow? Run the commands below to find out.
2. Does Terraform need anything else, such as an SSH key? (Yes, see below.)
3. Where will real data come from for the pilot, and what must stay in Israel?
4. Whether to add the Hebrew architecture diagram as a third slide.

## Next steps (run in a terminal)

Check what the subscription allows. These are read-only:

```bash
az account show --query "{name:name, state:state}" -o table
az vm list-skus -l westeurope --resource-type virtualMachines \
  --query "[?starts_with(name,'Standard_B2') || starts_with(name,'Standard_D2')].{size:name, blocked:restrictions[0].reasonCode}" -o table
az vm list-usage -l westeurope -o table | head -20
```

Create an SSH key if none exists:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agamim_datahub -N ""
```

Then tell Claude which sizes show no "blocked" value and which region to use, and the infrastructure code can be written and checked with `terraform plan`.

## Sources used

- Collibra pricing: Vendr, CostBench, Toolradar, AWS Marketplace listing (third-party estimates, small samples)
- Collibra trial options: Collibra trial page (tour and demo only for the catalog)
- Azure for Students: Microsoft FAQ and forum reports
