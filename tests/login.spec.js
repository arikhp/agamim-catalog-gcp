// The real sign-in screen. Runs only against a back end that requires a login, with the two mock accounts'
// credentials in E2E_ADMIN_USER / E2E_ADMIN_PASSWORD / E2E_CONSUMER_USER / E2E_CONSUMER_PASSWORD.
// On the static test server it skips itself.
const { test, expect } = require("@playwright/test");
const { PROFILE } = require("./helpers");

const ENV = process.env;
const HAVE_CREDENTIALS = ENV.E2E_ADMIN_USER && ENV.E2E_ADMIN_PASSWORD && ENV.E2E_CONSUMER_USER && ENV.E2E_CONSUMER_PASSWORD;

async function visit(browser) {
  const context = await browser.newContext({ locale: "he-IL" });
  // a finished profile, so the first-visit profile form does not get in the way
  await context.addInitScript((p) => { if (!localStorage.getItem("agamim-profile-v1")) localStorage.setItem("agamim-profile-v1", JSON.stringify(p)); }, PROFILE);
  const page = await context.newPage();
  await page.goto("/");
  return { context, page };
}

// The app's own (old) splash sits underneath with similar fields, so everything is scoped to the new form.
async function signInWith(page, user, password) {
  const form = page.locator("#agm-login");
  await form.getByLabel("שם משתמש").fill(user);
  await form.getByLabel("סיסמה").fill(password);
  await form.getByRole("button", { name: "כניסה" }).click();
}

test.describe("sign-in screen", () => {
  test.skip(!HAVE_CREDENTIALS, "set the E2E_* credentials to run against a back end that requires a login");

  test.beforeEach(async ({ request }) => {
    const html = await (await request.get("/")).text();
    test.skip(!html.includes("__AGAMIM_LOGIN_REQUIRED=true"), "this server does not require a login");
  });

  test("a visitor without a session sees the form and cannot read the data", async ({ browser }) => {
    const { context, page } = await visit(browser);
    await expect(page.locator("#agm-login")).toBeVisible();
    await expect(page.locator("#agm-login").getByRole("heading", { name: "כניסה למערכת" })).toBeVisible();
    expect((await page.request.get("/data/consumer/repositories.json")).status()).toBe(401);
    expect((await page.request.get("/api/state")).status()).toBe(401);
    await context.close();
  });

  test("a wrong password is refused with a clear message and no session", async ({ browser }) => {
    const { context, page } = await visit(browser);
    await signInWith(page, ENV.E2E_ADMIN_USER, "definitely-wrong");
    await expect(page.locator("#agm-err")).toHaveText("שם משתמש או סיסמה שגויים");
    await expect(page.locator("#agm-login")).toBeVisible();
    expect((await page.request.get("/api/me")).status()).toBe(401);
    await context.close();
  });

  test("the admin signs in and reaches the catalog", async ({ browser }) => {
    const { context, page } = await visit(browser);
    await signInWith(page, ENV.E2E_ADMIN_USER, ENV.E2E_ADMIN_PASSWORD);
    await expect(page.locator("ol.card li:not(.agm-lake)")).toHaveCount(3, { timeout: 15000 });
    await expect(page.locator("#agm-login")).toHaveCount(0);
    expect((await (await page.request.get("/api/me")).json()).role).toBe("admin");
    await context.close();
  });

  test("a consumer signs in but is kept out of the admin page", async ({ browser }) => {
    const { context, page } = await visit(browser);
    await signInWith(page, ENV.E2E_CONSUMER_USER, ENV.E2E_CONSUMER_PASSWORD);
    await expect(page.locator("ol.card li:not(.agm-lake)")).toHaveCount(3, { timeout: 15000 });
    expect((await (await page.request.get("/api/me")).json()).role).toBe("consumer");
    await page.goto("/add-dataset.html");
    await page.waitForURL((url) => !url.pathname.endsWith("add-dataset.html"));
    const write = await page.request.put("/api/state/deleted", { data: [1] });
    expect(write.status()).toBe(403);
    await context.close();
  });

  test("signing out returns to the form and closes the data", async ({ browser }) => {
    const { context, page } = await visit(browser);
    await signInWith(page, ENV.E2E_ADMIN_USER, ENV.E2E_ADMIN_PASSWORD);
    await expect(page.locator("ol.card li:not(.agm-lake)")).toHaveCount(3, { timeout: 15000 });
    await page.evaluate(() => sessionStorage.removeItem("auth")); // what the app's sign-out does
    await expect(page.locator("#agm-login")).toBeVisible({ timeout: 15000 });
    expect((await page.request.get("/data/consumer/repositories.json")).status()).toBe(401);
    await context.close();
  });
});
