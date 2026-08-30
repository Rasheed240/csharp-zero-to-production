# Zero to Production Backend Engineering in C# / .NET

An offline, single-folder curriculum. **Double-click `index.html`.** That is the whole setup —
no server, no build step, no package manager, no internet connection.

---

## Reading it

| | |
| --- | --- |
| Open | `index.html` |
| Search | Click the search box, or press <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> |
| Next / previous module | <kbd>]</kbd> and <kbd>[</kbd> |
| Close search or the mobile menu | <kbd>Esc</kbd> |
| Theme | The sun/moon button, top right. Remembered between visits. |
| Progress | **Mark complete** on any module. Survives refresh; reset from the home page. |

Progress is stored in your browser for this folder. If you move the folder or switch browsers,
use **Export progress** on the home page to save a JSON file and **Import progress** to restore
it.

## What is here

```
index.html                  Open this.
CURRICULUM.md               Every track and module, with scope and status. Source of truth.
STYLE-CONTRACT.md           The rules every module obeys. Binding.
CONTENT-LOADING.md          Why content loads the way it does under file://.

assets/css/site.css         Design tokens and all styling.
assets/js/highlight.js      Hand-written syntax highlighter (C#, SQL, JSON, XML, Bash).
assets/js/store.js          Theme and progress persistence.
assets/js/search.js         Search index and query engine.
assets/js/app.js            Router, navigation, rendering.

content/manifest.js         The module registry. A data file.
content/modules/<id>.js     One file per module. The content.

verification/               Runnable C# for every published snippet, plus the linter.
```

## Adding a module

Three steps, none of which touch site machinery:

1. Add a row to the relevant track table in `CURRICULUM.md`.
2. Add an entry to the `modules` array in `content/manifest.js`, and set `status` to something
   other than `planned`.
3. Create `content/modules/<id>.js`, following `STYLE-CONTRACT.md`.

Then check it:

```bash
node verification/lint-module.js <id>
```

The linter enforces the authoring format, required lesson sections, code-block escaping, the
`.NET` version badge, and the banned-word list. A module that fails the linter is not ready.

Modules with `status: "planned"` need no file at all — the site generates a placeholder from the
scope line in the manifest. That is why all 179 modules are already navigable.

## Verifying the code

Every C# snippet in a written module has a runnable source under `verification/<module-id>/`.
These are .NET 10 file-based apps:

```bash
cd verification/t1-03-value-vs-reference
dotnet run 01-copy-semantics.cs
```

See `verification/README.md` for the full list and which ones need a Release build.

## Constraints this project holds to

- Runs from `file://`. No server, no build, no package manager, no framework.
- Fully offline. **Zero network requests** — no CDN, no web fonts, no analytics.
- All code targets **.NET 10**, with .NET 8/9 differences noted inline where they matter.
- Every code sample is complete enough to run. No elisions in teaching code.
- Adding content never requires editing site machinery.

Browser support: Chrome, Edge, and Firefox are fully supported. Safari blocks `localStorage` for
`file://` pages, so progress will not persist there — the site detects this, says so, and offers
export/import instead.
