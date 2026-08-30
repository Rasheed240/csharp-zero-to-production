/* ============================================================================
   store.js — persistence for theme, progress, and UI state.

   localStorage is available under file:// in Chromium and Firefox (verified —
   see CONTENT-LOADING.md). Safari blocks it for file:// origins, so every
   access is guarded and falls back to an in-memory store for the session, with
   the UI told so it can warn the reader and offer export/import instead.
   ========================================================================= */

(function (global) {
  "use strict";

  var CSPREP = global.CSPREP = global.CSPREP || {};

  var PREFIX = "csprep.v1.";
  var memory = {};
  var persistent = true;

  try {
    var probe = PREFIX + "__probe";
    global.localStorage.setItem(probe, "1");
    global.localStorage.removeItem(probe);
  } catch (e) {
    persistent = false;
  }

  function read(key) {
    if (!persistent) return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    try { return global.localStorage.getItem(PREFIX + key); }
    catch (e) { return null; }
  }

  function write(key, value) {
    if (!persistent) { memory[key] = value; return; }
    try { global.localStorage.setItem(PREFIX + key, value); }
    catch (e) { persistent = false; memory[key] = value; }
  }

  function remove(key) {
    delete memory[key];
    if (!persistent) return;
    try { global.localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  function readJson(key, fallback) {
    var raw = read(key);
    if (raw === null) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || typeof parsed !== "object" ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  /* -- progress ----------------------------------------------------------- */

  // Shape: { "<module-id>": { status: "reading" | "done", at: "<iso>" } }
  var progress = readJson("progress", {});
  var listeners = [];

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad listener must not stop the rest */ }
    }
  }

  var Progress = {
    /** Subscribe to any change. Returns an unsubscribe function. */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },

    /** "none" | "reading" | "done" */
    statusOf: function (id) {
      var entry = progress[id];
      return entry && entry.status ? entry.status : "none";
    },

    isDone: function (id) { return this.statusOf(id) === "done"; },

    /** Record that a module was opened, without downgrading a completed one. */
    touch: function (id) {
      if (progress[id] && progress[id].status === "done") return;
      progress[id] = { status: "reading", at: new Date().toISOString() };
      this.save();
    },

    setDone: function (id, done) {
      if (done) progress[id] = { status: "done", at: new Date().toISOString() };
      else if (progress[id]) progress[id] = { status: "reading", at: new Date().toISOString() };
      this.save();
    },

    toggleDone: function (id) {
      var next = this.statusOf(id) !== "done";
      this.setDone(id, next);
      return next;
    },

    countDone: function (ids) {
      var n = 0;
      for (var i = 0; i < ids.length; i++) if (this.statusOf(ids[i]) === "done") n++;
      return n;
    },

    reset: function () {
      progress = {};
      remove("progress");
      emit();
    },

    save: function () {
      write("progress", JSON.stringify(progress));
      emit();
    },

    snapshot: function () {
      return JSON.parse(JSON.stringify(progress));
    },

    /** Merge an imported snapshot. Later `at` timestamps win. */
    merge: function (incoming) {
      if (!incoming || typeof incoming !== "object") return 0;
      var applied = 0;
      Object.keys(incoming).forEach(function (id) {
        var entry = incoming[id];
        if (!entry || typeof entry !== "object") return;
        if (entry.status !== "done" && entry.status !== "reading") return;
        var current = progress[id];
        if (!current || String(entry.at || "") > String(current.at || "")) {
          progress[id] = { status: entry.status, at: entry.at || new Date().toISOString() };
          applied++;
        }
      });
      this.save();
      return applied;
    }
  };

  /* -- theme -------------------------------------------------------------- */

  var Theme = {
    /** "light" | "dark" | "system" */
    preference: function () {
      var v = read("theme");
      return v === "light" || v === "dark" ? v : "system";
    },

    resolved: function () {
      var pref = this.preference();
      if (pref !== "system") return pref;
      try {
        return global.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } catch (e) {
        return "light";
      }
    },

    apply: function () {
      var theme = this.resolved();
      document.documentElement.setAttribute("data-theme", theme);
      var meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute("content", theme === "dark" ? "dark light" : "light dark");
      return theme;
    },

    set: function (pref) {
      if (pref === "system") remove("theme");
      else write("theme", pref);
      return this.apply();
    },

    /** Cycle light -> dark -> light, pinning an explicit choice. */
    toggle: function () {
      return this.set(this.resolved() === "dark" ? "light" : "dark");
    }
  };

  /* -- collapsed sidebar tracks ------------------------------------------- */

  var Ui = {
    openTracks: function () { return readJson("openTracks", null); },
    setOpenTracks: function (arr) { write("openTracks", JSON.stringify(arr)); }
  };

  CSPREP.store = {
    isPersistent: function () { return persistent; },
    progress: Progress,
    theme: Theme,
    ui: Ui,
    raw: { read: read, write: write, remove: remove }
  };
})(window);
