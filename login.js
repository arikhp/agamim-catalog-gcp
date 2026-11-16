/*
 * Sign-in screen. The server adds window.__AGAMIM_LOGIN_REQUIRED and window.__AGAMIM_SESSION to every
 * page when it requires a login. With a valid session the app starts signed in (the app keeps its own
 * sign-in marker in sessionStorage under "auth"). Without one, a full-screen form asks for a user ID and
 * password and posts them to /api/login. On a static host (no marker) this file does nothing.
 */
(function () {
  "use strict";
  if (!window.__AGAMIM_LOGIN_REQUIRED) return;

  var AUTH = "auth";
  var session = window.__AGAMIM_SESSION;

  function signOut() {
    var go = function () { window.location.reload(); };
    try {
      fetch("/api/logout", { method: "POST", keepalive: true }).then(go, go);
      setTimeout(go, 1500);
    } catch (e) { go(); }
  }

  if (session && session.userId) {
    // "admin" is the app's portal admin ("user"); anyone else only browses ("consumer").
    try { sessionStorage.setItem(AUTH, JSON.stringify({ signedIn: true, role: session.role === "admin" ? "user" : "consumer" })); } catch (e) {}
    // The app's own sign-out clears its marker: end the server session too.
    if (typeof Storage !== "undefined") {
      var proto = Storage.prototype;
      var set = proto.setItem;
      var remove = proto.removeItem;
      proto.removeItem = function (k) {
        var r = remove.apply(this, arguments);
        if (this === window.sessionStorage && k === AUTH) signOut();
        return r;
      };
      proto.setItem = function (k, v) {
        var r = set.apply(this, arguments);
        if (this === window.sessionStorage && k === AUTH) {
          try { var a = JSON.parse(v); if (a && a.signedIn === false) signOut(); } catch (e) {}
        }
        return r;
      };
    }
    return;
  }

  // No session: forget any sign-in left in this tab and ask for credentials.
  try { sessionStorage.removeItem(AUTH); } catch (e) {}

  var CSS =
    "#agm-login{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;" +
    "background:linear-gradient(160deg,#002a5c,#0a4a9a);font-family:Heebo,Rubik,system-ui,sans-serif;direction:rtl}" +
    "#agm-login form{width:100%;max-width:380px;background:#fff;color:#1a2230;border-radius:12px;padding:28px 24px;box-shadow:0 12px 40px rgba(0,0,0,.35)}" +
    "#agm-login img{display:block;height:56px;margin:0 auto 12px}" +
    "#agm-login h1{margin:0 0 4px;font-size:22px;text-align:center}" +
    "#agm-login p{margin:0 0 20px;color:#586478;font-size:14px;text-align:center}" +
    "#agm-login label{display:block;margin:12px 0 4px;font-size:14px;font-weight:500}" +
    "#agm-login input{box-sizing:border-box;width:100%;padding:10px 12px;font:inherit;font-size:16px;border:1px solid #9aa6b8;border-radius:8px;background:#fff;color:#1a2230;direction:ltr;text-align:right}" +
    "#agm-login input:focus-visible,#agm-login button:focus-visible{outline:3px solid #7fb3ff;outline-offset:1px}" +
    "#agm-login button{width:100%;margin-top:20px;padding:11px;font:inherit;font-size:16px;font-weight:600;border:0;border-radius:8px;background:#003c80;color:#fff;cursor:pointer}" +
    "#agm-login button:disabled{opacity:.6;cursor:default}" +
    "#agm-login .err{margin-top:12px;padding:8px 10px;border-radius:6px;background:#fdecec;color:#8a1c1c;font-size:14px}";

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    var root = document.createElement("div");
    root.id = "agm-login";
    root.lang = "he";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "agm-login-title");
    root.innerHTML =
      '<form novalidate>' +
      '<img src="./agamim-logo.png" alt="">' +
      '<h1 id="agm-login-title">כניסה למערכת</h1>' +
      '<p>מפעל הנתונים הלאומי · הדגמה</p>' +
      '<label for="agm-user">שם משתמש</label>' +
      '<input id="agm-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>' +
      '<label for="agm-pass">סיסמה</label>' +
      '<input id="agm-pass" name="password" type="password" autocomplete="current-password" required>' +
      '<div id="agm-err" class="err" role="alert" hidden></div>' +
      '<button type="submit">כניסה</button>' +
      '</form>';
    document.head.appendChild(style);
    document.body.appendChild(root);
    document.documentElement.style.overflow = "hidden";
    return root;
  }

  function show() {
    var root = build();
    var form = root.querySelector("form");
    var user = root.querySelector("#agm-user");
    var pass = root.querySelector("#agm-pass");
    var err = root.querySelector("#agm-err");
    var button = root.querySelector("button");

    function fail(message) { err.textContent = message; err.hidden = false; pass.focus(); pass.select(); }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      err.hidden = true;
      if (!user.value.trim() || !pass.value) { fail("יש להזין שם משתמש וסיסמה"); return; }
      button.disabled = true;
      fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.value.trim(), password: pass.value })
      }).then(function (res) {
        if (res.ok) { window.location.reload(); return; }
        button.disabled = false;
        if (res.status === 429) fail("יותר מדי ניסיונות. נסו שוב בעוד דקה");
        else if (res.status === 401) fail("שם משתמש או סיסמה שגויים");
        else fail("אירעה תקלה. נסו שוב");
      }).catch(function () {
        button.disabled = false;
        fail("אין חיבור לשרת. נסו שוב");
      });
    });
    user.focus();
  }

  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
})();
