/*
 * Discovery journey events for the home / catalog app (the compiled bundle in assets/).
 * Needs analytics.js loaded first. It watches the address bar and tab clicks instead of editing the bundle.
 *
 * Funnel:  Search Performed -> Dataset Viewed -> Dataset Tab Viewed
 * "Dataset Viewed" is the value event used for retention and cohorts.
 *
 * Privacy: only the length of a search is sent, never the text. Tab names are fixed UI labels.
 */
(function () {
  "use strict";

  var AUTH_KEY = "auth";
  var lastKey = null;
  var lastKind = null;
  var current = { kind: null, id: null };

  function signedIn() {
    try { return !!(JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null") || {}).signedIn; } catch (e) { return false; }
  }

  function track(name, props) {
    try { if (window.__agamimTrack) window.__agamimTrack(name, props || {}); } catch (e) {}
  }

  function parse(hash) {
    var h = String(hash || "").replace(/^#/, "") || "/";
    var qi = h.indexOf("?");
    var path = qi === -1 ? h : h.slice(0, qi);
    var query = qi === -1 ? "" : h.slice(qi + 1);
    var m;
    if ((m = /^\/repo\/([^/]+)/.exec(path))) return { kind: "dataset", id: decodeURIComponent(m[1]) };
    if ((m = /^\/layer\/([^/]+)/.exec(path))) return { kind: "layer", id: decodeURIComponent(m[1]) };
    if (path === "/search") {
      var q = "";
      query.split("&").forEach(function (kv) {
        var p = kv.split("=");
        if (p[0] === "q") { try { q = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); } catch (e) { q = p[1] || ""; } }
      });
      return { kind: "search", query: q };
    }
    if (path === "/catalog") return { kind: "catalog" };
    if (path === "/data") return { kind: "data" };
    return { kind: "home" };
  }

  // Where did the visitor come from when they opened a dataset?
  function source() {
    var s = window.__agamimLastSuggest;
    if (s && Date.now() - s < 3000) return "suggestion";
    return lastKind || "direct";
  }

  function check() {
    if (!signedIn()) return;
    var key = location.hash;
    if (key === lastKey) return;
    lastKey = key;
    var r = parse(key);
    current = r;
    if (r.kind === "search") {
      var words = r.query.trim() ? r.query.trim().split(/\s+/).length : 0;
      track("Search Performed", { query_length: r.query.trim().length, query_words: words });
    } else if (r.kind === "catalog") {
      track("Catalog Viewed");
    } else if (r.kind === "dataset") {
      track("Dataset Viewed", { dataset_id: r.id, source: source() });
    }
    lastKind = r.kind;
  }

  window.addEventListener("hashchange", check);
  // Also catches a deep link that only becomes visible after sign-in (no hashchange fires then).
  window.setInterval(check, 1000);
  check();

  // Tabs on the dataset page (overview, tables, lineage, contract...).
  document.addEventListener("click", function (ev) {
    try {
      var t = ev.target && ev.target.closest && ev.target.closest('[role="tab"]');
      if (!t || current.kind !== "dataset") return;
      if (t.getAttribute("aria-selected") === "true") return; // already open
      track("Dataset Tab Viewed", { dataset_id: current.id, tab: t.textContent.trim().slice(0, 40) });
    } catch (e) {}
  }, true);
})();
