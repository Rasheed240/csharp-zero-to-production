/* ============================================================================
   app.js — router, navigation, content loading, search UI, progress UI.

   Content loading strategy (see CONTENT-LOADING.md for the full rationale):
   every module is a classic <script> that calls CSPREP.module({...}). Scripts
   are injected on demand. Classic script loading is the one local-file
   mechanism that is NOT subject to the file:// CORS restrictions that break
   fetch(), XMLHttpRequest, and ES modules.

   Adding a module never requires touching this file. See STYLE-CONTRACT.md §9.
   ========================================================================= */

(function (global) {
  "use strict";

  var CSPREP = global.CSPREP = global.CSPREP || {};
  var store = CSPREP.store;
  var search = CSPREP.search;

  var manifest = global.CSPREP_MANIFEST || { site: {}, tracks: [], modules: [] };
  var site = manifest.site || {};
  var tracks = manifest.tracks || [];
  var mods = manifest.modules || [];

  var registry = Object.create(null);     // id -> loaded content definition
  var loadPromises = Object.create(null); // id -> Promise
  var byId = Object.create(null);         // id -> manifest meta
  var trackByNumber = Object.create(null);

  var el = {};      // cached DOM references
  var currentId = null;
  var tocObserver = null;

  /* -- icons -------------------------------------------------------------- */

  var ICON = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    chevron: '<svg class="track__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    dot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V8M7 12l5-5 5 5M4 4h16"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'
  };

  /* -- small helpers ------------------------------------------------------ */

  function h(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function esc(s) { return CSPREP.escapeHtml(String(s == null ? "" : s)); }

  /**
   * Measured height of the sticky top bar, used to offset anchor scrolling.
   *
   * Read it off the element, never from the --topbar-h custom property: a
   * custom property's computed value is the raw token ("3.5rem"), so parseInt
   * on it returns 3 and every anchor lands underneath the bar.
   */
  function topbarHeight() {
    return el.topbar ? Math.round(el.topbar.getBoundingClientRect().height) : 56;
  }

  function slugify(text) {
    return String(text).toLowerCase().trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function toast(message) {
    var node = el.toast;
    node.textContent = message;
    node.classList.add("is-visible");
    global.clearTimeout(node._timer);
    node._timer = global.setTimeout(function () { node.classList.remove("is-visible"); }, 2200);
  }

  /* -- manifest indexing -------------------------------------------------- */

  function indexManifest() {
    tracks.forEach(function (t) { trackByNumber[t.number] = t; t.moduleIds = []; });

    mods.forEach(function (m, i) {
      m.index = i;
      byId[m.id] = m;
      var t = trackByNumber[m.track];
      if (t) t.moduleIds.push(m.id);
      search.addStub(m, t);
    });
  }

  function trackOf(mod) { return trackByNumber[mod.track]; }

  function hasContent(mod) { return mod.status !== "planned"; }

  /* -- content loading ---------------------------------------------------- */

  /**
   * Called by every file in content/modules/. Registers the module body and
   * deepens the search index.
   */
  CSPREP.module = function (def) {
    if (!def || !def.id) {
      global.console && console.error("CSPREP.module: a module definition needs an id.");
      return;
    }
    if (!byId[def.id]) {
      global.console && console.warn(
        "CSPREP.module: '" + def.id + "' is not listed in content/manifest.js, so it will not " +
        "appear in navigation. Add it to the manifest."
      );
    }
    registry[def.id] = def;
    search.addContent(def.id, def);
  };

  /** Inject a module's content script once. Resolves with the definition or null. */
  function loadModule(id) {
    if (loadPromises[id]) return loadPromises[id];

    var meta = byId[id];
    if (!meta || !hasContent(meta)) {
      loadPromises[id] = Promise.resolve(null);
      return loadPromises[id];
    }
    if (registry[id]) {
      loadPromises[id] = Promise.resolve(registry[id]);
      return loadPromises[id];
    }

    loadPromises[id] = new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = "content/modules/" + id + ".js";
      script.async = false;
      script.onload = function () { resolve(registry[id] || null); };
      script.onerror = function () {
        global.console && console.error(
          "Could not load content/modules/" + id + ".js — the manifest says status '" +
          meta.status + "' but the file is missing."
        );
        resolve(null);
      };
      document.head.appendChild(script);
    });
    return loadPromises[id];
  }

  /**
   * Background-fill the deep search index during idle time. Runs in small
   * batches so it never competes with rendering or scrolling.
   */
  function prefetchAll() {
    var queue = mods.filter(hasContent).map(function (m) { return m.id; });
    var idle = global.requestIdleCallback || function (fn) { return global.setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 24); };

    function step() {
      if (!queue.length) { updateIndexStatus(); return; }
      var batch = queue.splice(0, 3).map(loadModule);
      Promise.all(batch).then(function () {
        updateIndexStatus();
        idle(step);
      });
    }
    idle(step);
  }

  function updateIndexStatus() {
    if (!el.searchMeta) return;
    var s = search.stats();
    var written = mods.filter(hasContent).length;
    el.searchMeta.querySelector("[data-index-status]").textContent =
      s.deep >= written
        ? "Full text indexed"
        : "Indexing " + s.deep + "/" + written;
  }

  /* -- navigation --------------------------------------------------------- */

  function buildNav() {
    var frag = document.createDocumentFragment();
    var open = store.ui.openTracks();

    tracks.forEach(function (track) {
      var wrap = h("div", "track");
      wrap.dataset.track = String(track.number);

      var head = h("button", "track__head");
      head.type = "button";
      head.setAttribute("aria-expanded", "false");
      head.innerHTML =
        ICON.chevron +
        '<span class="track__num">' + esc(track.number) + "</span>" +
        '<span class="track__name">' + esc(track.title) + "</span>" +
        '<span class="track__count" data-track-count></span>';

      var bar = h("div", "track__bar", '<div class="track__bar-fill" data-track-fill></div>');

      var list = h("ul", "track__list");
      list.id = "track-list-" + track.number;
      head.setAttribute("aria-controls", list.id);

      track.moduleIds.forEach(function (id) {
        var mod = byId[id];
        var li = document.createElement("li");
        var a = h("a", "mod-link");
        a.href = "#/m/" + id;
        a.dataset.id = id;
        a.dataset.status = mod.status;
        a.innerHTML =
          '<span class="mod-link__num">' + esc(mod.number) + "</span>" +
          '<span class="mod-link__text">' + esc(mod.title) + "</span>" +
          '<span class="mod-link__state"></span>';
        li.appendChild(a);
        list.appendChild(li);
      });

      head.addEventListener("click", function () {
        var nowOpen = !wrap.classList.contains("is-open");
        wrap.classList.toggle("is-open", nowOpen);
        head.setAttribute("aria-expanded", nowOpen ? "true" : "false");
        persistOpenTracks();
      });

      wrap.appendChild(head);
      wrap.appendChild(bar);
      wrap.appendChild(list);
      frag.appendChild(wrap);
    });

    el.navTracks.appendChild(frag);

    // Restore which tracks were expanded; default to Track 1 only.
    var wanted = open || [tracks.length ? tracks[0].number : 1];
    wanted.forEach(function (num) {
      var node = el.navTracks.querySelector('.track[data-track="' + num + '"]');
      if (node) {
        node.classList.add("is-open");
        node.querySelector(".track__head").setAttribute("aria-expanded", "true");
      }
    });
  }

  function persistOpenTracks() {
    var openNums = [];
    var nodes = el.navTracks.querySelectorAll(".track.is-open");
    for (var i = 0; i < nodes.length; i++) openNums.push(Number(nodes[i].dataset.track));
    store.ui.setOpenTracks(openNums);
  }

  function refreshNavState() {
    // per-module completion marks
    var links = el.navTracks.querySelectorAll(".mod-link");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var status = store.progress.statusOf(link.dataset.id);
      link.dataset.state = status;
      var slot = link.querySelector(".mod-link__state");
      slot.innerHTML = status === "done" ? ICON.check : (status === "reading" ? ICON.dot : "");
    }

    // per-track counts and bars
    tracks.forEach(function (track) {
      var node = el.navTracks.querySelector('.track[data-track="' + track.number + '"]');
      if (!node) return;
      var done = store.progress.countDone(track.moduleIds);
      var total = track.moduleIds.length;
      node.querySelector("[data-track-count]").textContent = done + "/" + total;
      node.querySelector("[data-track-fill]").style.width = total ? (done / total * 100) + "%" : "0%";
    });

    // overall pill
    var allIds = mods.map(function (m) { return m.id; });
    var doneAll = store.progress.countDone(allIds);
    var pct = allIds.length ? Math.round(doneAll / allIds.length * 100) : 0;
    el.progressText.textContent = doneAll + " / " + allIds.length;
    el.progressFill.style.width = pct + "%";
    el.progressPill.title = pct + "% of the curriculum complete";
  }

  function markCurrentInNav(id) {
    var links = el.navTracks.querySelectorAll(".mod-link");
    for (var i = 0; i < links.length; i++) links[i].classList.toggle("is-current", links[i].dataset.id === id);

    var nodes = el.navTracks.querySelectorAll(".track");
    var mod = byId[id];
    for (var j = 0; j < nodes.length; j++) {
      var isCurrent = mod && Number(nodes[j].dataset.track) === mod.track;
      nodes[j].classList.toggle("is-current", !!isCurrent);
      if (isCurrent && !nodes[j].classList.contains("is-open")) {
        nodes[j].classList.add("is-open");
        nodes[j].querySelector(".track__head").setAttribute("aria-expanded", "true");
        persistOpenTracks();
      }
    }

    var active = el.navTracks.querySelector(".mod-link.is-current");
    if (active && active.scrollIntoView) {
      var box = active.getBoundingClientRect();
      var frame = el.sidebar.getBoundingClientRect();
      if (box.top < frame.top || box.bottom > frame.bottom) {
        active.scrollIntoView({ block: "center" });
      }
    }
  }

  /* -- code block rendering ----------------------------------------------- */

  function parseHighlightSpec(spec) {
    var wanted = Object.create(null);
    if (!spec) return wanted;
    String(spec).split(",").forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var range = part.split("-");
      if (range.length === 2) {
        var from = parseInt(range[0], 10);
        var to = parseInt(range[1], 10);
        for (var n = from; n <= to; n++) wanted[n] = true;
      } else {
        wanted[parseInt(part, 10)] = true;
      }
    });
    return wanted;
  }

  function enhanceCodeBlocks(root) {
    var blocks = root.querySelectorAll("pre[data-lang]");

    Array.prototype.forEach.call(blocks, function (pre) {
      var codeEl = pre.querySelector("code") || pre;
      var source = codeEl.textContent.replace(/^\n+/, "").replace(/\s+$/, "");
      var lang = pre.getAttribute("data-lang") || "text";
      var net = pre.getAttribute("data-net");
      var title = pre.getAttribute("data-title");
      var isBad = pre.getAttribute("data-bad") === "true";
      var hl = parseHighlightSpec(pre.getAttribute("data-highlight"));

      var figure = h("figure", "code-block" + (isBad ? " code-block--bad" : ""));

      var head = h("div", "code-head");
      var headHtml = '<span class="code-lang">' + esc(lang) + "</span>";
      if (title) headHtml += '<span class="code-title">' + esc(title) + "</span>";
      headHtml += '<span class="code-head__spacer"></span>';
      if (isBad) headHtml += '<span class="code-badge code-badge--bad">Wrong</span>';
      if (net) headHtml += '<span class="code-badge">.NET ' + esc(net) + "</span>";
      head.innerHTML = headHtml;

      var copyBtn = h("button", "copy-btn", ICON.copy + "<span>Copy</span>");
      copyBtn.type = "button";
      copyBtn.setAttribute("aria-label", "Copy code to clipboard");
      copyBtn.addEventListener("click", function () { copyText(source, copyBtn); });
      head.appendChild(copyBtn);

      var highlighted = CSPREP.highlight(source, lang);
      var lines = highlighted.split("\n");
      var body = lines.map(function (line, i) {
        var num = i + 1;
        return '<span class="code-line' + (hl[num] ? " is-hl" : "") + '">' +
          '<span class="code-ln" aria-hidden="true">' + num + "</span>" +
          (line.length ? line : "&#8203;") +
          "</span>";
      }).join("");

      if (lines.length < 3) figure.setAttribute("data-nolines", "");

      var scroll = h("div", "code-scroll");
      var newPre = document.createElement("pre");
      var newCode = document.createElement("code");
      newCode.innerHTML = body;
      newPre.appendChild(newCode);
      scroll.appendChild(newPre);

      figure.appendChild(head);
      figure.appendChild(scroll);
      pre.parentNode.replaceChild(figure, pre);
    });
  }

  function copyText(text, btn) {
    function ok() {
      var label = btn.querySelector("span");
      var original = label.textContent;
      label.textContent = "Copied";
      btn.classList.add("is-done");
      global.setTimeout(function () { label.textContent = original; btn.classList.remove("is-done"); }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); }
      catch (e) { toast("Copy failed — select the code and press Ctrl+C."); }
      document.body.removeChild(ta);
    }

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(ok, fallback);
    } else {
      fallback();
    }
  }

  /* -- table of contents -------------------------------------------------- */

  function buildToc(prose, moduleId) {
    var headings = prose.querySelectorAll("h2, h3");
    el.tocList.innerHTML = "";
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

    if (!headings.length) { el.toc.hidden = true; return; }
    el.toc.hidden = false;

    var seen = Object.create(null);
    Array.prototype.forEach.call(headings, function (heading) {
      if (!heading.id) {
        var base = slugify(heading.textContent) || "section";
        var candidate = base;
        var n = 2;
        while (seen[candidate] || document.getElementById(candidate)) { candidate = base + "-" + n; n++; }
        heading.id = candidate;
      }
      seen[heading.id] = true;

      // Capture the heading text before the anchor is appended, otherwise the
      // anchor's own "#" ends up in the contents list.
      var headingText = heading.textContent.trim();

      // hover anchor that produces a linkable, bookmarkable URL
      var anchor = h("a", "heading-anchor", "#");
      anchor.href = "#/m/" + moduleId + "::" + heading.id;
      anchor.setAttribute("aria-label", "Link to this section");
      heading.appendChild(anchor);

      var li = h("li", heading.tagName === "H3" ? "lvl-3" : "lvl-2");
      var link = h("a", null, esc(headingText));
      link.href = "#/m/" + moduleId + "::" + heading.id;
      link.dataset.target = heading.id;
      li.appendChild(link);
      el.tocList.appendChild(li);
    });

    if (!global.IntersectionObserver) return;
    var visible = Object.create(null);
    tocObserver = new global.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      var first = null;
      for (var i = 0; i < headings.length; i++) {
        if (visible[headings[i].id]) { first = headings[i].id; break; }
      }
      var links = el.tocList.querySelectorAll("a");
      for (var j = 0; j < links.length; j++) {
        links[j].classList.toggle("is-active", links[j].dataset.target === first);
      }
    }, { rootMargin: "-" + topbarHeight() + "px 0px -70% 0px" });

    Array.prototype.forEach.call(headings, function (heading) { tocObserver.observe(heading); });
  }

  /* -- rendering ---------------------------------------------------------- */

  function renderHome() {
    currentId = null;
    document.title = site.title || "Curriculum";
    markCurrentInNav(null);
    el.toc.hidden = true;
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

    var allIds = mods.map(function (m) { return m.id; });
    var done = store.progress.countDone(allIds);
    var written = mods.filter(hasContent).length;
    var minutes = mods.reduce(function (sum, m) { return sum + (m.minutes || 0); }, 0);

    var wrap = h("div", "home");
    wrap.innerHTML =
      '<div class="home__hero">' +
        "<h1>" + esc(site.title || "Curriculum") + "</h1>" +
        "<p>" + esc(site.blurb || "") + "</p>" +
      "</div>" +
      '<div class="stat-row">' +
        '<div class="stat"><div class="stat__num">' + mods.length + '</div><div class="stat__label">modules</div></div>' +
        '<div class="stat"><div class="stat__num">' + tracks.length + '</div><div class="stat__label">tracks</div></div>' +
        '<div class="stat"><div class="stat__num">' + written + '</div><div class="stat__label">written</div></div>' +
        '<div class="stat"><div class="stat__num">' + done + '</div><div class="stat__label">completed</div></div>' +
        '<div class="stat"><div class="stat__num">' + Math.round(minutes / 60) + '</div><div class="stat__label">est. hours</div></div>' +
      "</div>";

    var grid = h("div", "track-grid");
    tracks.forEach(function (track) {
      var trackDone = store.progress.countDone(track.moduleIds);
      var total = track.moduleIds.length;
      var first = track.moduleIds[0];
      var card = h("a", "track-card");
      card.href = "#/m/" + first;
      card.innerHTML =
        '<span class="track-card__num">' + esc(track.number) + "</span>" +
        '<div class="track-card__name">' + esc(track.title) + "</div>" +
        '<div class="track-card__desc">' + esc(track.blurb || "") + "</div>" +
        '<div class="track-card__foot">' +
          "<span>" + trackDone + "/" + total + "</span>" +
          '<span class="track-card__bar"><span class="track-card__fill" style="width:' +
            (total ? Math.round(trackDone / total * 100) : 0) + '%"></span></span>' +
        "</div>";
      grid.appendChild(card);
    });
    wrap.appendChild(grid);

    var tools = h("div", "home__tools");
    var exportBtn = h("button", "btn", ICON.download + "<span>Export progress</span>");
    exportBtn.type = "button";
    exportBtn.addEventListener("click", exportProgress);

    var importBtn = h("button", "btn", ICON.upload + "<span>Import progress</span>");
    importBtn.type = "button";
    importBtn.addEventListener("click", function () { el.fileInput.click(); });

    var resetBtn = h("button", "btn btn--danger", ICON.trash + "<span>Reset progress</span>");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", function () {
      if (global.confirm("Reset all progress? This clears every completed and in-progress mark.")) {
        store.progress.reset();
        toast("Progress reset.");
      }
    });

    tools.appendChild(exportBtn);
    tools.appendChild(importBtn);
    tools.appendChild(resetBtn);
    wrap.appendChild(tools);

    if (!store.isPersistent()) {
      wrap.appendChild(h("div", "notice",
        "This browser is blocking local storage for <code>file://</code> pages, so progress will " +
        "not survive a refresh. Use <strong>Export progress</strong> to save it to a file, or open " +
        "the site in Chrome, Edge, or Firefox."));
    }

    el.article.innerHTML = "";
    el.article.appendChild(wrap);
    updateReadProgress();
  }

  function renderPlaceholder(mod) {
    var track = trackOf(mod);
    var wrap = h("div");
    wrap.innerHTML =
      '<div class="crumbs">Track ' + esc(mod.track) + " · " + esc(track ? track.title : "") +
        " · Module " + esc(mod.number) + "</div>" +
      '<h1 class="page-title">' + esc(mod.title) + "</h1>" +
      '<div class="placeholder">' +
        "<h2>Not written yet</h2>" +
        "<p>This module is listed in <code>CURRICULUM.md</code> with status " +
          "<strong>" + esc(mod.status) + "</strong>. The site renders this placeholder " +
          "automatically from the manifest — no machinery changes are needed when the " +
          "content file lands.</p>" +
        '<div class="placeholder__scope"><strong>Planned scope:</strong> ' + esc(mod.scope || "") + "</div>" +
        "<p>To write it: create <code>content/modules/" + esc(mod.id) + ".js</code> and change " +
          "this module's <code>status</code> in <code>content/manifest.js</code>.</p>" +
      "</div>";
    return wrap;
  }

  function renderModule(mod, def) {
    var track = trackOf(mod);
    var wrap = h("div");

    var crumbs = h("div", "crumbs",
      '<a href="#/">Home</a> · Track ' + esc(mod.track) + " · " + esc(track ? track.title : ""));
    wrap.appendChild(crumbs);

    var title = h("h1", "page-title", esc(mod.title));
    wrap.appendChild(title);

    var summary = (def && def.summary) || mod.scope || "";
    if (summary) wrap.appendChild(h("p", "page-lede", esc(summary)));

    var meta = h("div", "meta-row");
    var metaHtml =
      '<span class="chip">' + ICON.layers + "Module " + esc(mod.number) + " of " + track.moduleIds.length + "</span>";
    var minutes = (def && def.minutes) || mod.minutes;
    if (minutes) metaHtml += '<span class="chip">' + ICON.clock + "~" + esc(minutes) + " min</span>";
    metaHtml += '<span class="chip chip--net">.NET ' + esc(site.netVersion || "10") + "</span>";
    if (def && def.updated) metaHtml += '<span class="chip">Updated ' + esc(def.updated) + "</span>";
    meta.innerHTML = metaHtml;

    var markBtn = h("button", "mark-btn");
    markBtn.type = "button";
    function paintMark() {
      var done = store.progress.isDone(mod.id);
      markBtn.classList.toggle("is-done", done);
      markBtn.innerHTML = ICON.check + "<span>" + (done ? "Completed" : "Mark complete") + "</span>";
      markBtn.setAttribute("aria-pressed", done ? "true" : "false");
    }
    paintMark();
    markBtn.addEventListener("click", function () {
      var nowDone = store.progress.toggleDone(mod.id);
      paintMark();
      toast(nowDone ? "Marked complete." : "Marked as in progress.");
    });
    meta.appendChild(markBtn);
    wrap.appendChild(meta);

    if (def && def.html) {
      var prose = h("article", "prose");
      prose.innerHTML = def.html;
      wrap.appendChild(prose);
    } else {
      wrap.appendChild(renderPlaceholder(mod));
    }

    // prev / next
    var pager = h("nav", "pager");
    pager.setAttribute("aria-label", "Module navigation");
    var prev = mods[mod.index - 1];
    var next = mods[mod.index + 1];
    if (prev) {
      var pa = h("a", "pager__link pager__link--prev",
        '<div class="pager__dir">Previous</div><div class="pager__name">' + esc(prev.title) + "</div>");
      pa.href = "#/m/" + prev.id;
      pager.appendChild(pa);
    }
    if (next) {
      var na = h("a", "pager__link pager__link--next",
        '<div class="pager__dir">Next</div><div class="pager__name">' + esc(next.title) + "</div>");
      na.href = "#/m/" + next.id;
      pager.appendChild(na);
    }
    wrap.appendChild(pager);

    el.article.innerHTML = "";
    el.article.appendChild(wrap);

    var proseNode = wrap.querySelector(".prose");
    if (proseNode) {
      enhanceCodeBlocks(proseNode);
      buildToc(proseNode, mod.id);
    } else {
      el.toc.hidden = true;
      el.tocList.innerHTML = "";
    }

    document.title = mod.title + " · " + (site.shortTitle || site.title || "");
    store.progress.touch(mod.id);
    markCurrentInNav(mod.id);
  }

  /* -- routing ------------------------------------------------------------ */

  function parseHash() {
    var raw = String(global.location.hash || "").replace(/^#/, "");
    if (!raw || raw === "/" ) return { route: "home" };
    var m = raw.match(/^\/m\/([^:]+)(?:::(.+))?$/);
    if (m) return { route: "module", id: m[1], section: m[2] || null };
    return { route: "home" };
  }

  /**
   * Scroll to a section.
   *
   * `behavior: "auto"` does NOT mean "instant" — it defers to the CSS
   * scroll-behavior, which is `smooth` here. Arriving at a deep link would then
   * animate through the whole document. So: instant when landing on a freshly
   * rendered module, smooth only when moving within the module the reader is
   * already on (a contents-rail click).
   */
  function scrollToSection(sectionId, smooth) {
    var behavior = smooth ? "smooth" : "instant";
    var target = sectionId ? document.getElementById(sectionId) : null;
    if (!target) { global.scrollTo({ top: 0, behavior: behavior }); return; }
    var top = target.getBoundingClientRect().top + global.pageYOffset - (topbarHeight() + 16);
    global.scrollTo({ top: top, behavior: behavior });
  }

  function route() {
    closeSearch();
    document.body.classList.remove("nav-open");

    var r = parseHash();

    if (r.route === "home") {
      renderHome();
      global.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    var mod = byId[r.id];
    if (!mod) { renderHome(); return; }

    // Same module, different section: glide there without re-rendering.
    if (currentId === mod.id) { scrollToSection(r.section, true); return; }
    currentId = mod.id;

    loadModule(mod.id).then(function (def) {
      if (currentId !== mod.id) return; // navigated away while loading
      renderModule(mod, def);
      scrollToSection(r.section, false);
      updateReadProgress();
    });
  }

  /* -- search UI ---------------------------------------------------------- */

  var searchTimer = null;
  var activeHit = -1;

  function runSearch() {
    var q = el.searchInput.value.trim();
    if (!q) { closeSearch(); return; }

    var results = search.query(q, 12);
    activeHit = -1;
    el.searchResults.innerHTML = "";

    if (!results.length) {
      el.searchResults.appendChild(h("div", "search__empty", "No matches for “" + esc(q) + "”."));
    } else {
      results.forEach(function (hit) {
        var a = h("a", "search__hit");
        a.href = "#/m/" + hit.id;
        a.innerHTML =
          '<div class="search__hit-track">Track ' + esc(hit.trackNum) + " · " + esc(hit.trackTitle) +
            (hit.status === "planned" ? " · not yet written" : "") + "</div>" +
          '<div class="search__hit-title">' + esc(hit.title) + "</div>" +
          (hit.snippet ? '<div class="search__hit-snip">' + hit.snippet + "</div>" : "");
        el.searchResults.appendChild(a);
      });
    }

    el.searchCount.textContent = results.length + (results.length === 1 ? " result" : " results");
    el.searchPanel.hidden = false;
    updateIndexStatus();
  }

  function closeSearch() {
    el.searchPanel.hidden = true;
    activeHit = -1;
  }

  function moveHit(delta) {
    var hits = el.searchResults.querySelectorAll(".search__hit");
    if (!hits.length) return;
    if (activeHit >= 0 && hits[activeHit]) hits[activeHit].classList.remove("is-active");
    activeHit = (activeHit + delta + hits.length) % hits.length;
    hits[activeHit].classList.add("is-active");
    hits[activeHit].scrollIntoView({ block: "nearest" });
  }

  function wireSearch() {
    el.searchInput.addEventListener("input", function () {
      global.clearTimeout(searchTimer);
      searchTimer = global.setTimeout(runSearch, 110);
    });

    el.searchInput.addEventListener("focus", function () {
      if (el.searchInput.value.trim()) runSearch();
    });

    el.searchInput.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveHit(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveHit(-1); }
      else if (e.key === "Enter") {
        var hits = el.searchResults.querySelectorAll(".search__hit");
        if (activeHit >= 0 && hits[activeHit]) { e.preventDefault(); hits[activeHit].click(); }
        else if (hits.length) { e.preventDefault(); hits[0].click(); }
        el.searchInput.blur();
      } else if (e.key === "Escape") {
        closeSearch();
        el.searchInput.blur();
      }
    });

    document.addEventListener("click", function (e) {
      if (!el.search.contains(e.target)) closeSearch();
    });
  }

  /* -- progress import / export ------------------------------------------- */

  function exportProgress() {
    var payload = {
      kind: "csprep-progress",
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: store.progress.snapshot()
    };
    var blob = new global.Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = global.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "csprep-progress-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
    toast("Progress exported.");
  }

  function wireImport() {
    el.fileInput.addEventListener("change", function () {
      var file = el.fileInput.files && el.fileInput.files[0];
      if (!file) return;
      var reader = new global.FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          var data = parsed && parsed.progress ? parsed.progress : parsed;
          var applied = store.progress.merge(data);
          toast(applied + " module" + (applied === 1 ? "" : "s") + " updated from file.");
        } catch (e) {
          toast("That file is not a valid progress export.");
        }
        el.fileInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  /* -- reading progress bar ----------------------------------------------- */

  function updateReadProgress() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - doc.clientHeight;
    var pct = scrollable > 40 ? Math.min(100, Math.max(0, global.pageYOffset / scrollable * 100)) : 0;
    el.readProgress.style.width = pct + "%";
  }

  /* -- keyboard ----------------------------------------------------------- */

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }

  function go(delta) {
    if (!currentId) {
      if (mods.length) global.location.hash = "#/m/" + mods[0].id;
      return;
    }
    var mod = byId[currentId];
    var target = mods[mod.index + delta];
    if (target) global.location.hash = "#/m/" + target.id;
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
        return;
      }
      if (isTyping(e.target)) return;

      if (e.key === "/") { e.preventDefault(); el.searchInput.focus(); }
      else if (e.key === "[") { go(-1); }
      else if (e.key === "]") { go(1); }
      else if (e.key === "Escape") { closeSearch(); document.body.classList.remove("nav-open"); }
    });
  }

  /* -- theme -------------------------------------------------------------- */

  function paintThemeButton() {
    var dark = store.theme.resolved() === "dark";
    el.themeBtn.innerHTML = dark ? ICON.sun : ICON.moon;
    el.themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    el.themeBtn.title = dark ? "Light theme" : "Dark theme";
  }

  /* -- boot --------------------------------------------------------------- */

  function cacheDom() {
    el.article = document.getElementById("article");
    el.sidebar = document.getElementById("sidebar");
    el.navTracks = document.getElementById("navTracks");
    el.toc = document.getElementById("toc");
    el.tocList = document.getElementById("tocList");
    el.search = document.getElementById("search");
    el.searchInput = document.getElementById("searchInput");
    el.searchPanel = document.getElementById("searchPanel");
    el.searchResults = document.getElementById("searchResults");
    el.searchMeta = document.getElementById("searchMeta");
    el.searchCount = document.getElementById("searchCount");
    el.themeBtn = document.getElementById("themeBtn");
    el.navToggle = document.getElementById("navToggle");
    el.scrim = document.getElementById("scrim");
    el.progressPill = document.getElementById("progressPill");
    el.progressText = document.getElementById("progressText");
    el.progressFill = document.getElementById("progressFill");
    el.readProgress = document.getElementById("readProgress");
    el.toast = document.getElementById("toast");
    el.fileInput = document.getElementById("fileInput");
    el.topbar = document.querySelector(".topbar");
    el.brandTitle = document.getElementById("brandTitle");
    el.brandSub = document.getElementById("brandSub");
  }

  function boot() {
    cacheDom();
    store.theme.apply();
    paintThemeButton();

    if (el.brandTitle) el.brandTitle.textContent = site.shortTitle || site.title || "Curriculum";
    if (el.brandSub) el.brandSub.textContent = site.subtitle || "";

    if (!mods.length) {
      el.article.innerHTML =
        '<div class="placeholder"><h2>No manifest found</h2><p>' +
        "<code>content/manifest.js</code> did not load, or it defines no modules. " +
        "The site cannot render navigation without it.</p></div>";
      return;
    }

    indexManifest();
    buildNav();
    refreshNavState();
    store.progress.onChange(function () {
      refreshNavState();
      if (!currentId) renderHome();
    });

    wireSearch();
    wireImport();
    wireKeyboard();

    el.themeBtn.addEventListener("click", function () {
      store.theme.toggle();
      paintThemeButton();
    });

    el.navToggle.innerHTML = ICON.menu;
    el.navToggle.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      el.navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) el.sidebar.focus();
    });
    el.scrim.addEventListener("click", function () {
      document.body.classList.remove("nav-open");
    });

    global.addEventListener("hashchange", route);
    global.addEventListener("scroll", updateReadProgress, { passive: true });
    global.addEventListener("resize", updateReadProgress);

    try {
      global.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (store.theme.preference() === "system") { store.theme.apply(); paintThemeButton(); }
      });
    } catch (e) { /* older browsers: no live system-theme updates */ }

    route();
    updateIndexStatus();
    prefetchAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
