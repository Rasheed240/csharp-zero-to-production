/* ============================================================================
   lint-module.js — mechanical checks against STYLE-CONTRACT.md.

   This is an anti-drift tool. It cannot judge whether a lesson is good, but it
   catches every rule that can be checked without reading: authoring-format
   hazards that would break the page, missing required sections, unescaped code,
   and banned words.

   Usage:
     node verification/lint-module.js                       # every module file
     node verification/lint-module.js t1-03-value-vs-reference

   Exit code 0 = clean, 1 = at least one error.
   ========================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(ROOT, "content", "modules");

// STYLE-CONTRACT.md §3. "just" is banned outright; the rest imply the reader
// should already find something easy.
const BANNED_WORDS = ["just", "obviously", "blazingly", "simply", "trivially", "of course"];

// STYLE-CONTRACT.md §3, the narrowed "easy" rule. A bare "easy" is fine — what
// is banned is claiming the MATERIAL is easy. "easy to miss" describes how
// readily a mistake happens and is sympathetic to the reader; "the easy half"
// tells a struggling reader they are failing at something simple.
const EASY_ALLOWED_AFTER = "miss|forget|overlook|lose|break|confuse|introduce|" +
  "get\\s+wrong|write\\s+by\\s+accident|do\\s+by\\s+accident";

const EASY_BANNED = [
  // "the easy half", "the easy part", "the easy case"
  { re: /\bthe\s+easy\b/gi, why: '"the easy ..." claims the material is easy' },
  // "is easy", "it's pretty easy" — unless followed by a mistake verb
  {
    re: new RegExp(
      "\\b(?:is|are|was|were|it's|its|seems|looks)\\s+" +
      "(?:pretty\\s+|quite\\s+|very\\s+|fairly\\s+|really\\s+)?easy\\b" +
      "(?!\\s+to\\s+(?:" + EASY_ALLOWED_AFTER + "))",
      "gi"
    ),
    why: '"is easy" claims the material is easy'
  },
  // "easy enough", "easily done"
  { re: /\beasy\s+enough\b/gi, why: '"easy enough"' },
  { re: /\beasily\s+done\b/gi, why: '"easily done"' },
  // "easy to understand/remember/use/learn"
  {
    re: /\beasy\s+to\s+(?:understand|remember|use|learn|follow|grasp)\b/gi,
    why: '"easy to understand/remember/use" claims the material is easy'
  }
];

// STYLE-CONTRACT.md §2. Checked by presence of the marker, not by order, because
// a module may legitimately repeat explanation/example cycles.
const REQUIRED = [
  { what: "a why-this-matters callout", test: (s) => /callout--why/.test(s) },
  { what: "at least one definition (p.define)", test: (s) => /class="define"/.test(s) },
  { what: "at least three exercises", test: (s) => (s.match(/class="exercise"/g) || []).length >= 3 },
  { what: "hidden solutions (details.reveal)", test: (s) => /class="reveal"/.test(s) },
  { what: "a recall check (ol.recall)", test: (s) => /class="recall"/.test(s) },
  // STYLE-CONTRACT.md §2.10 and §6: recall answers are hidden until revealed.
  // Checked separately from the exercise reveals, because a module can satisfy
  // one and miss the other — t1-09 originally did.
  {
    what: "hidden answers inside the recall list (§2.10)",
    test: (s) => {
      const m = s.match(/<ol class="recall">([\s\S]*?)<\/ol>/);
      if (!m) return false;
      const items = (m[1].match(/<li[\s>]/g) || []).length;
      const answers = (m[1].match(/<details class="reveal">/g) || []).length;
      return items > 0 && answers >= items;
    }
  },
  { what: "a what-goes-wrong section", test: (s) => /data-bad="true"/.test(s) },
  { what: "a how-to-debug callout", test: (s) => /callout--debug/.test(s) }
];

function lintFile(file) {
  const name = path.basename(file);
  const src = fs.readFileSync(file, "utf8");
  const errors = [];
  const warnings = [];

  // --- the file must parse at all -----------------------------------------
  try {
    new Function("CSPREP", src);
  } catch (e) {
    errors.push(`does not parse as JavaScript: ${e.message}`);
    return { name, errors, warnings };
  }

  // --- pull out the html template literal ----------------------------------
  const start = src.indexOf("html: `");
  if (start < 0) {
    errors.push("no `html:` template literal found");
    return { name, errors, warnings };
  }
  const html = src.slice(start + 7, src.lastIndexOf("`"));

  // --- authoring-format hazards (STYLE-CONTRACT.md §7) ---------------------
  if (html.includes("`")) errors.push("contains a literal backtick inside the html literal — it will end the string early");
  if (/(^|[^\\])\$\{/.test(html)) errors.push("contains an unescaped ${ — it will be treated as an interpolation");

  // --- code blocks ---------------------------------------------------------
  const blockRe = /<pre([^>]*)><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  let blocks = 0;
  while ((m = blockRe.exec(html)) !== null) {
    blocks++;
    const attrs = m[1];
    const body = m[2];

    const stripped = body.replace(/&lt;|&gt;|&amp;|&quot;|&#\d+;/g, "");
    if (/[<>&]/.test(stripped)) {
      const sample = (stripped.match(/.{0,50}[<>&].{0,50}/) || [""])[0].replace(/\s+/g, " ");
      errors.push(`code block ${blocks} has an unescaped < > or & near: "${sample.trim()}"`);
    }
    if (/data-lang="csharp"/.test(attrs) && !/data-net=/.test(attrs)) {
      errors.push(`code block ${blocks} is C# but has no data-net attribute`);
    }
    if (/\/\/\s*\.\.\.|\/\*\s*\.\.\.|\.\.\.rest of|etc\.\s*$/im.test(body)) {
      errors.push(`code block ${blocks} looks elided — teaching code must be complete enough to run`);
    }
  }
  if (blocks === 0) warnings.push("no code blocks found");

  // --- structure -----------------------------------------------------------
  if (/<h1[\s>]/.test(html)) errors.push("contains an <h1> — the site renders the module title as the page h1");
  if (/\sstyle="/.test(html)) errors.push("contains an inline style attribute");

  const sections = html.match(/<section id="/g) || [];
  if (sections.length < 6) warnings.push(`only ${sections.length} sections — the lesson shape expects more`);

  // STYLE-CONTRACT.md §Callouts: "The <h4> inside a callout is required." An
  // earlier house style led with <p><strong>…</strong> instead, which renders
  // as body text and gives the reader nothing to scan.
  const calloutsMissingHeading = [...html.matchAll(/<div class="callout callout--([a-z]+)">([\s\S]*?)<\/div>/g)]
    .filter((c) => !/<h4[\s>]/.test(c[2]));
  if (calloutsMissingHeading.length) {
    errors.push(
      `${calloutsMissingHeading.length} callout(s) with no <h4> heading ` +
      `(STYLE-CONTRACT.md §Callouts): ${[...new Set(calloutsMissingHeading.map((c) => "callout--" + c[1]))].join(", ")}`
    );
  }

  const sectionIds = [...html.matchAll(/<section id="([^"]+)"/g)].map((x) => x[1]);
  const seen = new Set();
  sectionIds.forEach((id) => {
    if (seen.has(id)) errors.push(`duplicate section id: ${id}`);
    seen.add(id);
  });

  REQUIRED.forEach((rule) => {
    if (!rule.test(html)) errors.push(`missing ${rule.what}`);
  });

  // --- tone ----------------------------------------------------------------
  // Strip code blocks first: prose rules do not apply to code or console output.
  // "Just-In-Time" is the JIT compiler's actual name, not the banned dismissive
  // "just", so it is removed before the word check rather than reported forever.
  const prose = html
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/just-in-time/gi, " ");
  BANNED_WORDS.forEach((word) => {
    const hits = prose.match(new RegExp(`\\b${word}\\b`, "gi"));
    if (hits) errors.push(`banned word "${word}" x${hits.length} (STYLE-CONTRACT.md §3)`);
  });

  // The narrowed "easy" rule. Exercise difficulty pills are required markup, so
  // strip them before checking.
  const easyProse = prose.replace(/<span class="pill pill--easy">Easy<\/span>/g, " ");
  EASY_BANNED.forEach((rule) => {
    const hits = easyProse.match(rule.re);
    if (hits) {
      errors.push(
        `${rule.why} (STYLE-CONTRACT.md §3): ${hits.map((h) => `"${h.trim()}"`).join(", ")}`
      );
    }
  });

  // --- manifest agreement --------------------------------------------------
  const idMatch = src.match(/id:\s*"([^"]+)"/);
  const id = idMatch ? idMatch[1] : null;
  if (!id) errors.push("no id field");
  else if (id !== path.basename(file, ".js")) {
    errors.push(`id "${id}" does not match filename "${path.basename(file, ".js")}"`);
  }

  const manifestSrc = fs.readFileSync(path.join(ROOT, "content", "manifest.js"), "utf8");
  if (id && !manifestSrc.includes(`"${id}"`)) {
    errors.push(`id "${id}" is not listed in content/manifest.js — it will not appear in navigation`);
  }
  if (id) {
    const entry = manifestSrc.match(new RegExp(`\\{ id: "${id}"[\\s\\S]{0,240}?\\}`));
    if (entry && /status: "planned"/.test(entry[0])) {
      errors.push(`content file exists but manifest still says status "planned" for ${id}`);
    }
  }

  return { name, errors, warnings, blocks, sections: sections.length };
}

// --- run ---------------------------------------------------------------------

const arg = process.argv[2];
let files = fs.existsSync(MODULE_DIR)
  ? fs.readdirSync(MODULE_DIR).filter((f) => f.endsWith(".js")).map((f) => path.join(MODULE_DIR, f))
  : [];

if (arg) files = files.filter((f) => path.basename(f, ".js") === arg.replace(/\.js$/, ""));

if (!files.length) {
  console.log(arg ? `No module file matching "${arg}".` : "No module files found.");
  process.exit(1);
}

let failed = 0;
files.forEach((file) => {
  const r = lintFile(file);
  const status = r.errors.length ? "FAIL" : "ok  ";
  console.log(`${status}  ${r.name}` + (r.blocks != null ? `  (${r.blocks} code blocks, ${r.sections} sections)` : ""));
  r.errors.forEach((e) => console.log(`        error:   ${e}`));
  r.warnings.forEach((w) => console.log(`        warning: ${w}`));
  if (r.errors.length) failed++;
});

console.log("");
console.log(`${files.length} module(s) checked, ${failed} failing.`);
process.exit(failed ? 1 : 0);
