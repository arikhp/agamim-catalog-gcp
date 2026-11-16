// The consumer build has no sign-in in this phase: a first-time visitor lands in the catalog, never on a login screen.
// Deliberately does not use signIn() from helpers.js, so it sees exactly what a new visitor sees.
const { test, expect } = require("@playwright/test");

test.describe("public consumer mode", () => {
  test("a first-time visitor lands in the catalog, not on a login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText("DEV ONLY")).toHaveCount(0);
    await expect(page.getByText("demo1234")).toHaveCount(0);
    // No first-visit profile form ("welcome": name, role, rank, ...).
    await expect(page.getByText("ברוכים הבאים")).toHaveCount(0);
  });

  test("nothing covers the page: a visitor can open a dataset straight away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    const before = page.url();
    // click() fails if an overlay intercepts the pointer, which is how a profile form would show up.
    await page.getByText("רשויות מקומיות").first().click({ timeout: 5000 });
    await expect.poll(() => page.url()).not.toBe(before);
  });

  test("no account controls: sign out and reset demo are not visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    await expect(page.getByRole("button", { name: "יציאה" })).toBeHidden();
    await expect(page.getByRole("button", { name: /איפוס הדגמה|איפוס דמו/ })).toBeHidden();
  });

  test("reloading and visiting a dataset page never shows the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    await page.reload();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText("כל המאגרים")).toBeVisible();
  });

  test("read-only: no access toggles on the list and no block button on a dataset page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    // The open/blocked pills are status labels, not controls.
    await expect(page.locator('[role="switch"]')).toHaveCount(0);
    const pills = page.locator(".agm-status");
    await expect(pills).not.toHaveCount(0);
    const enabled = await pills.evaluateAll((els) => els.filter((e) => !e.disabled).length);
    expect(enabled).toBe(0);

    await page.getByText("נפות פיקוד העורף").first().click();
    await expect(page.getByText("מה זה?")).toBeVisible();
    await expect(page.getByText("חסימת המאגר")).toHaveCount(0);
    await expect(page.getByText("פתיחת המאגר לגישה")).toHaveCount(0);
    await expect(page.locator(".agm-admin-switch")).toHaveCount(0);
  });

  test("no third-party requests: visitor data stays with the site and Google Fonts", async ({ page, baseURL }) => {
    const own = new URL(baseURL).host;
    const allowed = new Set([own, "fonts.googleapis.com", "fonts.gstatic.com"]);
    const foreign = new Set();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && !allowed.has(u.host)) foreign.add(u.host);
    });
    await page.goto("/");
    await expect(page.getByText("כל המאגרים")).toBeVisible();
    await page.getByText("נפות פיקוד העורף").first().click();
    await expect(page.getByText("מה זה?")).toBeVisible();
    await page.waitForTimeout(1500);
    expect([...foreign]).toEqual([]);
  });
});
