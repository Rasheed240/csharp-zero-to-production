/* ============================================================================
   search.js — client-side full-text search.

   Two-stage index, which is what keeps the site fast with the full curriculum
   present:

     Stage 1 (instant, at boot): title + track + summary + declared terms for
       every module in the manifest. Available before any content file loads.
     Stage 2 (background): the module's real prose, added as each content file
       arrives. app.js prefetches every written module during idle time, so the
       deep index fills in within a second or two of first paint without ever
       blocking the first render.

   Scoring is field-weighted. All query tokens must match somewhere (AND); if
   that yields nothing we fall back to OR so a typo in one word still returns
   something useful.
   ========================================================================= */

(function (global) {
  "use strict";

  var CSPREP = global.CSPREP = global.CSPREP || {};

  var records = Object.create(null); // id -> record
  var order = [];                    // ids in curriculum order

  var WEIGHT = { title: 12, terms: 9, heading: 5, summary: 4, body: 1 };
  var BODY_CAP = 12; // stop counting body hits past this, so long pages don't dominate

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase();
  }

  function tokenize(q) {
    return norm(q).split(/[^a-z0-9#+._<>-]+/).filter(function (t) { return t.length > 0; });
  }

  /** Strip tags and collapse whitespace, giving searchable plain text. */
  function htmlToText(html) {
    var holder = document.createElement("div");
    holder.innerHTML = html;
    var revealed = holder.querySelectorAll("summary");
    for (var i = 0; i < revealed.length; i++) revealed[i].textContent = " " + revealed[i].textContent + " ";
    return (holder.textContent || "").replace(/\s+/g, " ").trim();
  }

  function extractHeadings(html) {
    var holder = document.createElement("div");
    holder.innerHTML = html;
    var nodes = holder.querySelectorAll("h2, h3, h4");
    var out = [];
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i].textContent.trim());
    return out;
  }

  var Search = {
    /** Register manifest-level metadata. Called once per module at boot. */
    addStub: function (mod, track) {
      var rec = {
        id: mod.id,
        title: mod.title,
        trackTitle: track ? track.title : "",
        trackNum: track ? track.number : 0,
        number: mod.number,
        status: mod.status,
        summary: mod.scope || "",
        terms: (mod.terms || []).join(" "),
        headings: "",
        body: "",
        deep: false
      };
      rec.hTitle = norm(rec.title);
      rec.hTerms = norm(rec.terms);
      rec.hSummary = norm(rec.summary);
      rec.hHeadings = "";
      rec.hBody = "";
      records[mod.id] = rec;
      order.push(mod.id);
    },

    /** Upgrade a record with the module's real content once its file loads. */
    addContent: function (id, def) {
      var rec = records[id];
      if (!rec || rec.deep) return;
      if (def.summary) { rec.summary = def.summary; rec.hSummary = norm(def.summary); }
      if (def.terms && def.terms.length) {
        rec.terms = def.terms.join(" ");
        rec.hTerms = norm(rec.terms);
      }
      var headings = extractHeadings(def.html);
      rec.headings = headings.join(" · ");
      rec.hHeadings = norm(rec.headings);
      rec.body = htmlToText(def.html);
      rec.hBody = norm(rec.body);
      rec.deep = true;
    },

    stats: function () {
      var deep = 0;
      for (var i = 0; i < order.length; i++) if (records[order[i]].deep) deep++;
      return { total: order.length, deep: deep };
    },

    get: function (id) { return records[id]; },

    /**
     * Run a query. Returns [{ id, title, trackTitle, score, snippet, status }].
     */
    query: function (q, limit) {
      var tokens = tokenize(q);
      if (!tokens.length) return [];
      limit = limit || 12;

      var strict = [];
      var loose = [];

      for (var i = 0; i < order.length; i++) {
        var rec = records[order[i]];
        var score = 0;
        var matchedTokens = 0;

        for (var t = 0; t < tokens.length; t++) {
          var tok = tokens[t];
          var hit = 0;

          if (rec.hTitle.indexOf(tok) >= 0) hit += WEIGHT.title;
          if (rec.hTerms.indexOf(tok) >= 0) hit += WEIGHT.terms;
          if (rec.hHeadings.indexOf(tok) >= 0) hit += WEIGHT.heading;
          if (rec.hSummary.indexOf(tok) >= 0) hit += WEIGHT.summary;

          if (rec.hBody) {
            var count = 0;
            var from = rec.hBody.indexOf(tok);
            while (from >= 0 && count < BODY_CAP) {
              count++;
              from = rec.hBody.indexOf(tok, from + tok.length);
            }
            if (count) hit += WEIGHT.body * count;
          }

          // whole-word matches in the title are worth more than substrings
          if (hit && new RegExp("\\b" + tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(rec.hTitle)) {
            hit += 6;
          }

          if (hit > 0) { matchedTokens++; score += hit; }
        }

        if (!score) continue;
        var result = {
          id: rec.id,
          title: rec.title,
          trackTitle: rec.trackTitle,
          trackNum: rec.trackNum,
          number: rec.number,
          status: rec.status,
          score: score,
          snippet: this.snippet(rec, tokens)
        };
        if (matchedTokens === tokens.length) strict.push(result);
        else loose.push(result);
      }

      var chosen = strict.length ? strict : loose;
      chosen.sort(function (a, b) { return b.score - a.score || a.trackNum - b.trackNum || a.number - b.number; });
      return chosen.slice(0, limit);
    },

    /** Build a highlighted excerpt around the best token occurrence. */
    snippet: function (rec, tokens) {
      var source = rec.body || rec.summary || "";
      var lower = rec.hBody || rec.hSummary || "";
      if (!source) return "";

      var best = -1;
      var bestTok = "";
      for (var i = 0; i < tokens.length; i++) {
        var at = lower.indexOf(tokens[i]);
        if (at >= 0 && (best < 0 || tokens[i].length > bestTok.length)) { best = at; bestTok = tokens[i]; }
      }
      if (best < 0) { best = 0; }

      var radius = 90;
      var start = Math.max(0, best - radius);
      var end = Math.min(source.length, best + radius);
      // avoid cutting mid-word
      if (start > 0) {
        var sp = source.indexOf(" ", start);
        if (sp >= 0 && sp < start + 20) start = sp + 1;
      }
      var text = source.slice(start, end).trim();
      if (start > 0) text = "…" + text;
      if (end < source.length) text = text + "…";

      return this.mark(text, tokens);
    },

    /** HTML-escape then wrap query tokens in <mark>. */
    mark: function (text, tokens) {
      var escaped = CSPREP.escapeHtml(text);
      var uniq = tokens.slice().sort(function (a, b) { return b.length - a.length; });
      for (var i = 0; i < uniq.length; i++) {
        var safe = uniq[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Skip anything already inside a <mark> tag we just inserted.
        escaped = escaped.replace(new RegExp("(?![^<]*>)(" + safe + ")", "gi"), "<mark>$1</mark>");
      }
      return escaped;
    }
  };

  CSPREP.search = Search;
})(window);
