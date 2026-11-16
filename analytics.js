/*
 * One tracking entry point, two destinations: Amplitude (already on the page) and Mixpanel.
 *
 *   window.__agamimTrack(name, props)   -> sends the event to both tools, returns Amplitude's result
 *
 * Keeping every event going through this one function is what keeps the event names identical in
 * both tools. Never call amplitude.track or mixpanel.track directly from page code.
 *
 * Mixpanel is OFF while MIXPANEL_TOKEN is empty (Mixpanel > Settings > Project settings > Project token).
 * The project token is a public client-side key, like the Amplitude key in index.html.
 *
 * Mixpanel is also OFF for automated browsers (Playwright sets navigator.webdriver), so test runs
 * never pollute the project.
 *
 * Mixpanel conventions (Mixpanel setup skill): event names are snake_case, so "Dataset Viewed" is sent to
 * Mixpanel as dataset_viewed (Amplitude keeps Title Case). Null and empty properties are dropped.
 * reset() runs on sign-out so the next person on a shared device is not merged into the previous one.
 * identify() is NOT called: the demo has no real user IDs, and the role is not an identity.
 * When real accounts exist, call mixpanel.identify(<database user id>) after sign-in.
 *
 * Privacy: Mixpanel autocapture and session recording are off. Callers must never pass credentials,
 * codes, names, emails or anything the user typed. Every call is wrapped so analytics can't break the page.
 */
(function () {
  "use strict";

  var MIXPANEL_TOKEN = "9c8d7eebb4f7f4218e46703256a51d94"; // Mixpanel project token (public client-side key)
  // The project lives in Mixpanel's EU data region (it opens at eu.mixpanel.com), so events must go to the EU host.
  // Events sent to the default US host never show up in an EU project.
  var MIXPANEL_API_HOST = "https://api-eu.mixpanel.com";
  var MIXPANEL_SRC = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
  var AUTH_KEY = "auth";

  var enabled = !!MIXPANEL_TOKEN && !navigator.webdriver;
  var ready = false;
  var queue = []; // [fn] run once the Mixpanel library has loaded
  var lastRole = null;

  function role() {
    try { return (JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null") || {}).role || null; } catch (e) { return null; }
  }

  function env() {
    var h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" ? "local" : "demo";
  }

  // "Dataset Viewed" -> "dataset_viewed". Only ever applied to fixed names written in code.
  function snake(name) {
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  // Drop null / undefined / empty values instead of sending them.
  function clean(props) {
    var out = {};
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === "") return;
      out[k] = v;
    });
    return out;
  }

  function mp(fn) {
    if (!enabled) return;
    if (ready) { try { fn(window.mixpanel); } catch (e) {} } else queue.push(fn);
  }

  function loadMixpanel() {
    if (!enabled) return;
    try {
      // Minimal form of Mixpanel's loader snippet: the CDN library finishes initialising from this stub.
      var stub = (window.mixpanel = window.mixpanel || []);
      stub._i = [];
      stub.init = function (token, config, name) { stub._i.push([token, config, name || "mixpanel"]); };
      stub.__SV = 1.2;
      stub.init(MIXPANEL_TOKEN, {
        api_host: MIXPANEL_API_HOST,
        autocapture: false,
        record_sessions_percent: 0,
        track_pageview: false, // hash routes are tracked by explicit events (analytics-journey.js)
        debug: env() === "local",
        persistence: "localStorage",
        ignore_dnt: false
      });
    } catch (e) { enabled = false; return; }
    var s = document.createElement("script");
    s.async = true;
    s.src = MIXPANEL_SRC;
    s.onload = function () {
      try {
        if (typeof window.mixpanel.track !== "function") throw new Error("mixpanel not initialised");
        window.mixpanel.register({ app_env: env() });
        ready = true;
        queue.splice(0).forEach(function (fn) { try { fn(window.mixpanel); } catch (e) {} });
      } catch (e) { enabled = false; queue = []; }
    };
    s.onerror = function () { enabled = false; queue = []; };
    document.head.appendChild(s);
  }

  // The role is the property that separates admins from consumers in every report, so it travels
  // with every event (Mixpanel super property, Amplitude user property) as soon as it is known.
  function syncRole() {
    var r = role();
    if (!r && lastRole) {
      // signed out: start a fresh anonymous identity
      lastRole = null;
      mp(function (m) { m.reset(); m.register({ app_env: env() }); });
      return;
    }
    if (!r || r === lastRole) return;
    lastRole = r;
    mp(function (m) { m.register({ role: r }); });
    try {
      var a = window.amplitude;
      if (a && a.identify && a.Identify) a.identify(new a.Identify().set("role", r));
    } catch (e) {}
  }

  window.__agamimTrack = function (name, props, opts) {
    props = clean(props);
    var result;
    syncRole();
    try {
      if (window.amplitude && window.amplitude.track) result = window.amplitude.track(name, props);
    } catch (e) {}
    mp(function (m) { m.track(snake(name), props, opts && opts.beacon ? { transport: "sendBeacon" } : undefined); });
    return result;
  };

  loadMixpanel();
  window.setInterval(syncRole, 1000); // notices sign-in and sign-out even when no event fires
})();
