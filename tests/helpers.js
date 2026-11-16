// Shared helpers for the Playwright tests.

const PROFILE = {
  name: "דנה כהן",
  role: "ראש צוות נתונים",
  rank: "סרן",
  hierarchy: "HFC",
  endDate: "2027-06-30"
};

/**
 * Starts the page already signed in (the app keeps its sign-in in sessionStorage under "auth").
 * Pass { profile: false } to leave the first-visit profile unset.
 */
/**
 * When the back end requires a login, a spec can get a real session. Give the credentials of the two mock accounts in
 * E2E_ADMIN_USER / E2E_ADMIN_PASSWORD and E2E_CONSUMER_USER / E2E_CONSUMER_PASSWORD; the session cookie is set on
 * the browser context through the API. Without them nothing happens (static server, or a back end without login).
 */
async function apiLogin(context, role) {
  const consumer = role === "consumer";
  const user = process.env[consumer ? "E2E_CONSUMER_USER" : "E2E_ADMIN_USER"];
  const password = process.env[consumer ? "E2E_CONSUMER_PASSWORD" : "E2E_ADMIN_PASSWORD"];
  if (!user || !password) return;
  const res = await context.request.post("/api/login", { data: { userId: user, password } });
  if (!res.ok()) throw new Error(`API login failed for the ${consumer ? "consumer" : "admin"} account: ${res.status()}`);
}

async function signIn(page, { profile = true, role = "user" } = {}) {
  // Deliberately no apiLogin here: these tests register and delete datasets, and with a real admin session those
  // changes would be saved on a shared server and leak into other tests. They run against the static server or a
  // back end without login. Only login.spec.js and shared-state.spec.js use real sessions.
  await page.addInitScript(
    ({ withProfile, p, r }) => {
      sessionStorage.setItem("auth", JSON.stringify({ signedIn: true, role: r }));
      if (withProfile && !localStorage.getItem("agamim-profile-v1")) {
        localStorage.setItem("agamim-profile-v1", JSON.stringify(p));
      }
    },
    { withProfile: profile, p: PROFILE, r: role }
  );
}

/** Opens the catalog and waits until the dataset list has rendered. */
async function openCatalog(page) {
  await page.goto("/#/catalog");
  await page.getByText(/מוצגים \d+ מתוך \d+/).waitFor();
}

/** Opens the "add dataset" side panel from the nav and returns the form's frame locator. */
async function openPanel(page) {
  await page.locator("a.agm-add-btn:visible").first().click();
  await page.locator("#agm-drawer").waitFor();
  return page.frameLocator("#agm-drawer iframe");
}

/** Walks the form (inside the panel or standalone) from table pick to the review screen. */
async function fillDataset(form, { table = "curated.public_shelters", purpose, owner, phone }) {
  await form.locator("#f-table").selectOption(table);
  await form.getByRole("button", { name: "המשך לפרטי המאגר" }).click();
  await form.locator("#f-purposeHe").fill(purpose);
  await form.locator("#f-ownerHe").fill(owner);
  await form.locator("#f-ownerPhone").fill(phone);
  await form.getByRole("button", { name: "המשך לסקירה" }).click();
}

module.exports = { PROFILE, signIn, apiLogin, openCatalog, openPanel, fillDataset };
