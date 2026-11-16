"use strict";
// A nightly trigger that lives inside the app (the web app is always on). It fires at a local time in a
// time zone, for example 02:00 in Asia/Jerusalem, and re-arms itself after every run.

function clockIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

// Milliseconds from "now" until the next HH:MM in the given time zone (never zero: if it is exactly
// that time, the next one is tomorrow).
function msUntilNext(now, hour, minute, timeZone) {
  const c = clockIn(now, timeZone);
  let delta = hour * 3600 + minute * 60 - (c.h * 3600 + c.m * 60 + c.s);
  if (delta <= 0) delta += 86400;
  return delta * 1000 - now.getMilliseconds();
}

function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function startNightly({ at = "02:00", timeZone = "Asia/Jerusalem", run, log = console.log, now = () => new Date() }) {
  const t = parseTime(at);
  if (!t) { log(`Nightly schedule not started: "${at}" is not HH:MM`); return { stop() {} }; }
  let timer = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    const wait = msUntilNext(now(), t.hour, t.minute, timeZone);
    log(`Next nightly run in ${Math.round(wait / 60000)} minutes (${at} ${timeZone})`);
    timer = setTimeout(async () => {
      try { await run(); } catch (err) { log(`Nightly run failed: ${err && err.message}`); }
      arm();
    }, Math.min(wait, 2 ** 31 - 1));
  };
  arm();
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { msUntilNext, parseTime, startNightly };
