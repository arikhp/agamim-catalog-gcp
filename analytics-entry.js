/*
 * Amplitude tracking for the entry funnel: login -> two-step verification (MFA).
 *
 * The login and MFA screens live in the compiled app bundle, so this file watches the page instead
 * of editing the bundle. It recognises each screen by its own heading and fields.
 * "Sign In Completed", "Profile Screen Viewed" and "Profile Completed" are tracked in onboarding.js.
 *
 * Privacy: never send the username, password, phone digits, the verification code or anything typed.
 * Every call is wrapped so analytics can never break sign-in.
 */
(function () {
  "use strict";

  var entry = (window.__agamimEntry = { loginViewedAt: 0 });

  // analytics.js owns window.__agamimTrack and sends to both Amplitude and Mixpanel.
  function track(name, props) {
    try { if (window.__agamimTrack) return window.__agamimTrack(name, props || {}); } catch (e) {}
  }

  var screen = null; // "login" | "mfa" | null
  var lastLoginError = "";
  var lockedShown = false;

  function detectScreen() {
    var h = document.querySelector("form h2");
    var txt = h ? h.textContent.trim() : "";
    var next = txt === "כניסה" ? "login" : txt.indexOf("אימות דו") === 0 ? "mfa" : null;
    // Session Replay can be switched on by the Amplitude project's remote settings. Keep these screens out of it.
    if (next && h.closest("form")) h.closest("form").classList.add("amp-block");
    if (next === screen) return;
    screen = next;
    if (next === "login") {
      if (!entry.loginViewedAt) entry.loginViewedAt = Date.now();
      track("Login Viewed");
    } else if (next === "mfa") {
      track("MFA Viewed");
    }
  }

  function detectLoginErrors() {
    var err = document.getElementById("lg-pass-err");
    var text = err ? err.textContent : "";
    if (text && text !== lastLoginError) {
      var m = /נותרו\s+(\d+)/.exec(text);
      track("Login Failed", { reason: "invalid_credentials", attempts_left: m ? Number(m[1]) : null });
    }
    lastLoginError = text;

    var form = document.querySelector("form");
    var locked = !!(form && form.querySelector("#lg-user") && form.textContent.indexOf("ניתן לנסות שוב בעוד") !== -1);
    // Not "החשבון ננעל": the ordinary wrong-password message also contains that phrase.
    if (locked && !lockedShown) track("Login Failed", { reason: "account_locked" });
    lockedShown = locked;
  }

  var pending = false;
  function scan() {
    pending = false;
    try { detectScreen(); detectLoginErrors(); } catch (e) {}
  }
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(scan);
  }

  // Capture phase, so we see the event even if the app stops it from bubbling.
  document.addEventListener("submit", function (ev) {
    try {
      var f = ev.target;
      if (!f || !f.querySelector) return;
      if (f.querySelector("#lg-user")) track("Login Submitted");
      else if (f.querySelector('[aria-label="קוד אימות"]')) track("MFA Code Submitted");
    } catch (e) {}
  }, true);

  document.addEventListener("click", function (ev) {
    try {
      var b = ev.target && ev.target.closest && ev.target.closest("button");
      if (b && b.textContent.trim() === "שלחו שוב") track("MFA Code Resent");
    } catch (e) {}
  }, true);

  function start() {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
