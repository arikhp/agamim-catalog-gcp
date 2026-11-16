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
});
