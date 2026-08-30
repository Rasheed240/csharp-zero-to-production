# CONTENT-LOADING.md

**Decision: content files are classic `<script>` files that call `CSPREP.module({...})`, injected on demand.**

This document records what was tested, what the results were, and why the alternatives were
rejected. It exists so the decision is not quietly revisited in a later session.

---

## 1. The constraint

The site is opened by double-clicking `index.html`. The page origin is therefore `file://`, and
browsers treat `file://` as an **opaque origin** — it is not `localhost`, and it does not behave
like a web server. Several mechanisms that are completely standard on the web are either blocked
outright or silently degraded there.

The brief required verifying this before committing to an approach rather than discovering it
later. So it was measured, not assumed.

## 2. What was actually tested

A probe page was written to `file://` and loaded in headless **Chrome 141** and
**Edge (Chromium)**, both on Windows 11. It attempted every plausible content-loading mechanism
and reported the outcome.

| Mechanism | Chrome | Edge | Verdict |
| --- | --- | --- | --- |
| `<script src="sub/file.js">` — static, relative | ✅ ran | ✅ ran | **Usable** |
| `<script>` element injected at runtime with a relative `src` | ✅ ran | ✅ ran | **Usable** |
| `fetch("sub/data.json")` | ❌ `TypeError: Failed to fetch` | ❌ same | Unusable |
| `XMLHttpRequest` → `sub/data.json` | ❌ `error` event, status 0 | ❌ same | Unusable |
| `<script type="module" src="sub/mod.mjs">` | ❌ blocked by CORS | ❌ same | Unusable |
| `localStorage` read/write | ✅ worked | ✅ worked | Usable, with a guard |
| `sessionStorage` | ✅ worked | ✅ worked | Usable |
| `window.location.origin` | `"file://"` | `"file://"` | Confirms opaque origin |

The reason `fetch` and `XMLHttpRequest` fail is that a request from an opaque origin to a
`file://` URL is treated as cross-origin, and there is no server to return an
`Access-Control-Allow-Origin` header. The reason ES modules fail is that module scripts are
*always* fetched with CORS semantics, even for same-directory relative paths — which is why a
plain `<script>` works and `<script type="module">` does not, for the identical file.

Service workers were not tested because they are specified to require a secure origin and
`file://` does not qualify. They are excluded by design.

Firefox is not installed on this machine, so its behaviour was not measured directly. The
chosen mechanism is the most conservative of the options — Firefox's `file://` policy is
*stricter* than Chromium's for `fetch`/`XHR` (it blocks them too), and classic script tags with
relative paths work there as they do everywhere. Safari is the one engine that additionally
blocks `localStorage` on `file://`, which is why storage is wrapped (see §5).

## 3. The chosen approach

Each module is one JavaScript file that calls a global registration function:

```js
// content/modules/t1-03-value-vs-reference.js
CSPREP.module({
  id: "t1-03-value-vs-reference",
  minutes: 55,
  summary: "…",
  terms: ["value type", "boxing", …],
  html: `  …the lesson, as HTML…  `
});
```

`content/manifest.js` is a plain data file assigning `window.CSPREP_MANIFEST`. It is loaded by a
static `<script>` tag in `index.html` and lists every module in the curriculum.

When a module is opened, `app.js` injects a `<script>` pointing at that module's file. The file
executes, calls `CSPREP.module(...)`, and the router renders it. Each module is fetched at most
once and then cached in memory.

**Why this works:** classic script loading is not a CORS-governed fetch. It is the same
mechanism that has loaded scripts since 1996, and it is deliberately exempt from the
restrictions that block `fetch`. It is the only local-file loading path that behaves identically
across every browser without flags.

## 4. Why the alternatives were rejected

| Alternative | Why not |
| --- | --- |
| JSON content files loaded with `fetch` | Blocked. Measured above. This is the approach most static site tutorials use, and it is exactly what breaks under `file://`. |
| ES modules with `import` | Blocked. Module scripts are always CORS-fetched. |
| Inlining all content into `index.html` | Works, but violates "content lives in a form I can edit by hand without touching site machinery" — every module edit would mean editing the shell, and the file would grow past comfortable editing size. |
| Markdown files + a vendored parser | The loading problem is unchanged (still needs `fetch` to read the `.md`), and it would add a parser dependency that cannot be downloaded offline. |
| A build step that compiles content into a bundle | Explicitly forbidden by the brief — no build step, no package manager. |
| `iframe` per module + `postMessage` | Works, but each module would be a separate document with its own styling, breaking search, the contents rail, and print. |

## 5. Consequences accepted

**Content is authored as HTML inside a JavaScript template literal.** This is the real cost of
the decision. It means three authoring rules, documented in `STYLE-CONTRACT.md` §7: no literal
backticks, escape `\${`, and escape `<` `>` `&` inside code blocks. In exchange, content files
stay hand-editable, need no parser, and load instantly. A lint script
(`verification/lint-module.js`) checks all three rules mechanically.

**Search is indexed in two stages.** Module metadata — title, track, scope, declared terms — is
indexed at boot from the manifest, so search works immediately across all 179 modules. Full
prose is added per module as its file loads, and `app.js` prefetches every written module during
browser idle time. This is what keeps the first render fast as the curriculum grows: opening a
module never waits for the rest of the library.

**Storage is guarded.** `localStorage` works in Chromium and Firefox under `file://` but is
blocked by Safari. Every access is wrapped in `try`/`catch` and falls back to an in-memory store
for the session; the home page then shows a notice and offers **Export progress** /
**Import progress** as a manual path. Progress is never silently lost without the reader being
told.

**Zero network requests.** There are no CDN links, no web fonts, no analytics, and no external
images. Typography uses system font stacks. Syntax highlighting is hand-written
(`assets/js/highlight.js`) rather than vendored, because every mainstream highlighter ships as
an ES module or expects a bundler. Verified: loading the site with a network monitor attached
produced an empty request list.

## 6. How to re-verify

The probe used for the table in §2 is reproducible. To confirm the site itself makes no network
requests: open `index.html`, press F12, open the Network tab, and reload. The list stays empty.
Disconnecting from the network entirely and reloading produces an identical page.

---

**Status: settled.** Changing this is a cross-cutting change and requires sign-off first
(`STYLE-CONTRACT.md` §10).
