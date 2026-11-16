// End to end against the real back end: an admin's changes are stored on the server and a different
// browser sees them. Runs only against the database-backed server (BASE_URL=... API_ADMIN_KEY=...);
// on the static test server it skips itself.
const { test, expect } = require("@playwright/test");
const { apiLogin } = require("./helpers");

const KEY = process.env.API_ADMIN_KEY || "";
const PROFILE = { name: "בודק", role: "מנהל", rank: "-", hierarchy: "-", endDate: "2099-01-01" };

async function hasBackend(request) {
  const res = await request.get("/api/health").catch(() => null);
  if (!res || !res.ok()) return false;
  return (await res.json().catch(() => ({}))).ok === true;
}

async function visitor(browser, { role, key }) {
  const context = await browser.newContext({ locale: "he-IL" });
  await apiLogin(context, role === "consumer" ? "consumer" : "admin"); // only when the back end needs a login
  await context.addInitScript(
    ({ r, k, p }) => {
      sessionStorage.setItem("auth", JSON.stringify({ signedIn: true, role: r }));
      if (k) sessionStorage.setItem("agamim-admin-key", k);
      if (!localStorage.getItem("agamim-profile-v1")) localStorage.setItem("agamim-profile-v1", JSON.stringify(p));
    },
    { r: role, k: key, p: PROFILE }
  );
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss()); // a prompt for the key is dismissed, like pressing cancel
  await page.goto("/");
  return { context, page };
}

const readKey = { "x-admin-key": KEY };

const clearState = async (request) => {
  for (const [name, empty] of [["access", {}], ["edits", {}], ["deleted", []], ["datasets", []]]) {
    await request.put(`/api/state/${name}`, { headers: { "x-admin-key": KEY }, data: empty });
  }
};

test.describe("shared state on the back end", () => {
  // The tests share one server-side state, so they must not run at the same time.
  test.describe.configure({ mode: "serial" });
  test.skip(!KEY, "set API_ADMIN_KEY and BASE_URL to run against the back end");

  test.beforeEach(async ({ request }) => {
    test.skip(!(await hasBackend(request)), "no back end at this address");
    await clearState(request);
  });
  test.afterEach(async ({ request }) => { await clearState(request); });

  test("what an admin changes is what another browser sees", async ({ browser, request }) => {
    const admin = await visitor(browser, { role: "user", key: KEY });
    await admin.page.evaluate(async () => {
      window.__agamimAccess.set(1, true);
      window.__agamimEdits.set(2, { nameHe: "שם שנערך בשרת" });
      window.__agamimDeleted.add(3);
      await window.__agamimSync.flush();
    });

    const saved = await (await request.get("/api/state", { headers: readKey })).json();
    expect(saved.access["1"].blocked).toBe(true);
    expect(saved.edits["2"].nameHe).toBe("שם שנערך בשרת");
    expect(saved.deleted).toEqual(["3"]);

    // a different person, a different browser, no local changes
    const other = await visitor(browser, { role: "consumer", key: "" });
    const list = await other.page.evaluate(async () => (await fetch("./data/consumer/repositories.json")).json());
    expect(list.items.find((r) => r.id === 1).accessState).toBe("blocked");
    expect(list.items.find((r) => r.id === 2).nameHe).toBe("שם שנערך בשרת");
    expect(list.items.some((r) => r.id === 3)).toBe(false);

    await admin.context.close();
    await other.context.close();
  });

  test("a restore on the server reaches a browser that had the old state", async ({ browser, request }) => {
    const admin = await visitor(browser, { role: "user", key: KEY });
    await admin.page.evaluate(async () => { window.__agamimDeleted.add(3); await window.__agamimSync.flush(); });
    const second = await visitor(browser, { role: "consumer", key: "" });
    expect((await second.page.evaluate(async () => (await fetch("./data/consumer/repositories.json")).json())).items.some((r) => r.id === 3)).toBe(false);

    await request.put("/api/state/deleted", { headers: { "x-admin-key": KEY }, data: [] }); // restored on the server
    await second.page.reload();
    expect((await second.page.evaluate(async () => (await fetch("./data/consumer/repositories.json")).json())).items.some((r) => r.id === 3)).toBe(true);

    await admin.context.close();
    await second.context.close();
  });

  test("with a wrong key nothing is stored and the admin is told", async ({ browser, request }) => {
    // With a login, a valid admin session authorizes the save and the key is not needed.
    test.skip(!!process.env.E2E_ADMIN_USER, "a signed-in admin does not need the key");
    const admin = await visitor(browser, { role: "user", key: "not-the-key" });
    await admin.page.evaluate(async () => { window.__agamimDeleted.add(2); await window.__agamimSync.flush(); });
    await expect(admin.page.locator("#agamim-sync-note")).toContainText("בדפדפן הזה");
    expect((await (await request.get("/api/state", { headers: readKey })).json()).deleted).toEqual([]);
    await admin.context.close();
  });

  test("the harvested list of source tables is served", async ({ request }) => {
    const doc = await (await request.get("/data/staging/db-tables.json", { headers: readKey })).json();
    expect(doc.tables.length).toBeGreaterThanOrEqual(3);
    for (const t of doc.tables) expect(t.columns.filter((c) => c.pk)).toHaveLength(1);
  });
});
