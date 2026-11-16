/*
 * Public consumer mode. Added only to dist/index.html by tools/build-consumer.mjs; never part of the source pages.
 *
 * This phase has no sign-in. The compiled app shows a login screen (with demo quick-logins) unless it finds a
 * signed-in session, so we start every visit already signed in as a plain consumer, keep it that way, and remove the
 * controls that only make sense with accounts (sign out, reset demo).
 */
(function () {
  "use strict";
  var SESSION = JSON.stringify({ signedIn: true, role: "user" });

  function ensureSession() {
    try { if (!sessionStorage.getItem("auth")) sessionStorage.setItem("auth", SESSION); } catch (e) { /* storage blocked */ }
  }
  ensureSession();

  // The app clears "auth" on sign out; make that a no-op so the login screen can never come back.
  try {
    var remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (this === window.sessionStorage && key === "auth") return;
      return remove.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }

  // Hebrew labels of the account-only controls: "sign out" and "reset demo".
  var HIDE = { "יציאה": 1, "איפוס הדגמה": 1, "איפוס דמו": 1 };
  function sweep() {
    var els = document.querySelectorAll("button, a, [role=button]");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").replace(/\s+/g, " ").trim();
      if (HIDE[t]) els[i].style.display = "none";
    }
  }
  function start() {
    sweep();
    new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
