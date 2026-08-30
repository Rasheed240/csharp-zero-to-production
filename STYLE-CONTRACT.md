# STYLE-CONTRACT.md

**Binding on every module.** If a module and this file disagree, this file wins and the module
is wrong. If this file needs to change in a way that affects already-`frozen` modules, that is a
cross-cutting change: **stop and flag it before editing anything**.

---

## 1. Reader model

Assume the reader has **genuine amnesia**. They retain nothing about programming, .NET, or
computer science. This is not a politeness convention — it is a hard rule:

- Every term is defined **at first use in that module**, in plain language, before it is used
  casually. Modules must be self-sufficient: do not rely on "as we saw in Track 1" to carry a
  definition. Cross-link for depth, but re-define in one sentence locally.
- "Obvious" terms are defined too: *compile*, *runtime*, *memory*, *reference*, *thread*,
  *null*, *allocate*, *instance*.
- Jargon is never used to explain jargon. If a definition needs another undefined term, define
  that one first.

At the same time, **the reader's ceiling is a senior backend interview**. Accessibility is added
to depth; depth is never traded for accessibility. When a concept is genuinely hard, it gets
**more words, not fewer**. Never write "this is beyond the scope of this article".

---

## 2. Mandatory lesson shape

Every module follows this order. Sections may be repeated (a module can have several
explanation → example cycles) but the order within a cycle never changes, and the module-level
bookends (§2.1, §2.9, §2.10) appear exactly once.

| # | Section | Requirement |
| --- | --- | --- |
| 2.1 | **The problem this exists to solve** | Opens the module. Written **before any syntax appears**. A concrete situation where the reader would get stuck without this concept. No code. |
| 2.2 | **Plain-language explanation** | The mental model, with a real-world analogy. Analogies must be *labelled as analogies* and their limits stated. |
| 2.3 | **Minimal example** | The smallest complete runnable program that shows the concept and nothing else. |
| 2.4 | **Realistic production example** | The same concept inside code that looks like a real service — named domain types, error handling, DI, logging as appropriate. |
| 2.5 | **What goes wrong** | Failure modes stated concretely. Wrong code shown and **explicitly labelled wrong**. |
| 2.6 | **How to debug it** | The observable symptom → the tool → the reading of the tool's output → the fix. Name actual tools and actual output. |
| 2.7 | **Why this matters in a real system** | At least one, grounded in a specific scenario with numbers (request rates, data sizes, latency, cost). Not "this is important for performance". |
| 2.8 | **Misconceptions and anti-patterns** | Stated explicitly, each as a claim the reader may believe, then dismantled. |
| 2.9 | **Exercises** | At least three, ascending difficulty. Every one has a worked solution **hidden until revealed**. Solutions are complete, not sketches. |
| 2.10 | **Recall check** | Short. Questions the reader should be able to answer from memory. Answers hidden until revealed. |

Track 6 problem modules additionally require, per problem: difficulty label, pattern name,
brute-force approach and **why it fails**, the unlocking insight, full commented C# solution,
complexity analysis (time and space, derived not asserted), common wrong turns, and a
**"how would I have recognised this cold?"** section.

---

## 3. Tone rules

- Direct, second person, present tense. "You call `Dispose`", not "one may invoke `Dispose`".
- No marketing. No "blazingly fast", "simply", "just", "obviously", "of course".
  The word *just* is banned outright — it implies the reader should already find it easy.
- **"Easy" is banned as a claim about the reader's experience, not as a word.** The test is who
  the ease belongs to. Asserting that the *material* is easy tells a struggling reader they are
  failing at something simple, which is the whole reason these words are banned:

  | Banned | Allowed |
  | --- | --- |
  | "Syntax is the easy half" | "easy to miss" |
  | "this is easy once you see it" | "easy to get wrong" |
  | "easy enough", "easily done" | "easy to forget" |
  | "X is easy to understand/remember/use" | "easy to introduce by accident" |

  The allowed forms describe how readily a *mistake* happens. They are sympathetic to the
  reader; the banned forms are not. `verification/lint-module.js` enforces this narrowed rule
  mechanically — a bare "easy" is not itself an error.
- No hedging where the answer is known. If there is a right answer, give it and say why.
  If it genuinely depends, say what it depends on and give a default.
- Honest about trade-offs, including about .NET itself. If a framework feature is awkward,
  say so.
- British spelling in prose (*behaviour*, *serialise*, *optimisation*, *initialise*).
  **Code always uses the API's real spelling** (`SerializeAsync`, `Color`, `Initialize`).
- No emoji in prose or headings.
- Numbers over adjectives: "adds ~40 ns and 32 bytes per call" beats "adds overhead".

---

## 4. Code conventions

- **Every snippet targets .NET 10** and says so via the `data-net` attribute, which renders as a
  version badge. Where .NET 8 or 9 behaves meaningfully differently, add an inline note — do not
  leave the reader to discover it.
- **Teaching code must be complete enough to run.** No `// ...rest of implementation`,
  no `// etc.`, no undefined helper types. If a snippet needs a type, the type is shown, either
  in the same block or an adjacent one that is explicitly linked.
- File-scoped namespaces, top-level statements where they reduce noise, `var` only when the
  type is obvious from the right-hand side.
- Nullable reference types enabled in all examples.
- Braces on their own line (Allman), four-space indent, `_camelCase` private fields,
  `PascalCase` for everything public, `I`-prefixed interfaces, `Async` suffix on async methods.
- Async examples always accept and honour a `CancellationToken` unless the module is
  specifically about code that cannot.
- Domain names in production examples are drawn from a single recurring fictional system —
  **Ledger**, a payments and invoicing service — so examples compound across modules instead of
  resetting. Recurring types: `Invoice`, `Payment`, `Customer`, `Money`, `LedgerDbContext`,
  `IPaymentGateway`.
- Wrong code is marked with `data-bad="true"`, which renders a red rail and a **WRONG** label.
  Never show wrong code without that marker.
- Console output shown as a separate block with `data-lang="console"`.

---

## 5. Design tokens

Defined once in `assets/css/site.css` as CSS custom properties. **Modules never introduce
colours, fonts, or spacing values.** They use the component classes in §6 only.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#faf9f7` | `#14161a` | Page background |
| `--bg-raised` | `#ffffff` | `#1b1e24` | Cards, code blocks, sidebar |
| `--bg-sunken` | `#f1efeb` | `#101216` | Inset areas, search field |
| `--ink` | `#1b1a18` | `#e7e4df` | Body text |
| `--ink-soft` | `#5c5851` | `#a6a29b` | Secondary text |
| `--ink-faint` | `#8a857c` | `#76726c` | Metadata, line numbers |
| `--rule` | `#e2ded7` | `#2a2e36` | Borders and dividers |
| `--accent` | `#0f6e63` | `#4fd1bd` | Links, current position, focus |
| `--accent-soft` | `#e3f1ef` | `#16302d` | Accent backgrounds |
| `--warn` | `#a35a12` | `#e0a35c` | Gotchas, warnings |
| `--danger` | `#a32820` | `#f08a80` | Wrong code, errors |
| `--good` | `#2f6d34` | `#7cc47f` | Correct code, completion |

Type scale (`rem`): 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25.
Spacing scale (`rem`): 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4.
Prose measure: `68ch`. Body size `1.0625rem`, line-height `1.7`.

---

## 6. Content component vocabulary

Modules author **HTML**, using only these constructs. Anything not on this list must be added
here first (that is a cross-cutting change — flag it).

### Structure

```html
<section id="stable-slug">
  <h2>Section heading</h2>
  <p>Prose.</p>
</section>
```

`<h2>` for sections, `<h3>` for sub-sections, `<h4>` sparingly. **Never `<h1>`** — the site
renders the module title as the page `<h1>`. Every `<section>` needs a stable `id`; the
right-hand "On this page" rail is built from `<h2>`/`<h3>` automatically.

### Definitions

```html
<p class="define"><span class="define__term">Heap</span> The region of memory where …</p>
```

Use for **every** first-use term. Renders with a left rule and the term in accent colour.

### Callouts

```html
<div class="callout callout--why">    <h4>Why this matters in a real system</h4> … </div>
<div class="callout callout--gotcha"> <h4>Gotcha</h4> … </div>
<div class="callout callout--warn">   <h4>Warning</h4> … </div>
<div class="callout callout--note">   <h4>Note</h4> … </div>
<div class="callout callout--myth">   <h4>Misconception</h4> … </div>
<div class="callout callout--debug">  <h4>How to debug it</h4> … </div>
```

Every module has at least one `callout--why`. The `<h4>` inside a callout is required.

### Code

```html
<pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>…escaped code…</code></pre>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Don't do this"><code>…</code></pre>
<pre data-lang="console"><code>…</code></pre>
```

- `data-lang`: `csharp` | `sql` | `json` | `xml` | `bash` | `console` | `text`
- `data-net`: the .NET version the snippet was written against. Required on `csharp` blocks.
- `data-title`: optional filename or label shown in the block header.
- `data-bad="true"`: marks wrong code.
- `data-highlight="3,7-9"`: optional emphasised lines.
- Code content **must be HTML-escaped**: `&lt;` `&gt;` `&amp;`. Generics and comparisons will
  break the page otherwise.

The site adds language label, version badge, copy button, and line numbers. Modules do not.

### Tables, diagrams, comparisons

```html
<div class="table-wrap"><table> … </table></div>
<pre class="diagram"><code>…monospace box drawing…</code></pre>
<div class="compare">
  <div class="compare__side compare__side--bad"><h4>Wrong</h4> … </div>
  <div class="compare__side compare__side--good"><h4>Right</h4> … </div>
</div>
```

Tables are always wrapped in `.table-wrap` so they scroll horizontally on mobile rather than
breaking the page.

### Exercises and recall

```html
<div class="exercise">
  <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
       <span class="pill pill--easy">Easy</span></div>
  <p>The task.</p>
  <details class="reveal"><summary>Show worked solution</summary>
    <div class="reveal__body"> … full solution, with code and explanation … </div>
  </details>
</div>

<ol class="recall">
  <li><p>Question?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Answer.</p></div></details></li>
</ol>
```

Difficulty pills: `pill--easy`, `pill--medium`, `pill--hard`.

### Inline

`<code>` for identifiers, `<strong>` for the load-bearing claim in a paragraph, `<em>` for
emphasis, `<a href="#/m/&lt;id&gt;">` for cross-module links. No inline `style` attributes, ever.

---

## 7. Content file format

One module = one file at `content/modules/<ID>.js`. Shape:

```js
CSPREP.module({
  id: "t1-03-value-vs-reference",
  minutes: 45,
  updated: "2026-08-29",
  summary: "One-sentence plain-language summary, shown in search results and cards.",
  terms: ["value type", "reference type", "stack", "heap", "boxing"],
  html: `
    <section id="the-problem"> … </section>
  `
});
```

**Authoring rules for the `html` template literal:**

1. It is a JavaScript backtick string. A literal **backtick** inside it ends the string —
   never use one. Use `<code>` for inline code instead of Markdown backticks.
2. The two-character sequence `${` starts an interpolation and will break the file.
   C# interpolated strings are safe (`$"{name}"` has no `${`), but if you ever need a literal
   `${` — for example in a Bash snippet — write it as `\${`.
3. Escape `<`, `>`, and `&` **inside code blocks** as `&lt;` `&gt;` `&amp;`.
4. A backslash is an escape character in a template literal. In code samples that need a literal
   backslash (Windows paths, regex), write `\\`.

`minutes` is an honest reading-and-working estimate, used for the sidebar and progress totals.
`terms` feeds the search index with weight, so list the terms the module *defines*.

---

## 8. Search and progress contract

- `summary`, `title`, `terms`, and the module's full prose are all indexed. Headings are
  weighted above body text; the title and `terms` above headings.
- Progress is stored per module ID. **Never change an ID.** Renaming a module's *title* is safe.

---

## 9. Adding a module is a data change

The site is a renderer. Adding module two requires exactly:

1. A row in `CURRICULUM.md`.
2. An entry in the `modules` array of `content/manifest.js`.
3. A file at `content/modules/<ID>.js`.

**No file in `assets/` or `index.html` may need editing to add content.** If it ever does, the
machinery is wrong and must be fixed rather than worked around.

---

## 10. Freeze rule

A module marked `frozen` in `CURRICULUM.md` is closed. Later sessions must not restructure it,
re-theme it, "modernise" it, or adjust its wording for consistency with newer modules.

If a genuine defect is found in a frozen module — a factually wrong statement, code that does
not compile — **report it and wait**. Do not fix it silently.

Cross-cutting changes (design tokens, component vocabulary, lesson shape, content format) affect
every module including frozen ones. These require explicit approval **before** any file changes.

---

## 11. Verification bar before a module is marked `written`

- [ ] Every C# snippet compiles and runs on .NET 10, verified by actually building it.
- [ ] Every term used is defined in that module before casual use.
- [ ] All ten sections in §2 are present in order.
- [ ] At least one `callout--why` with concrete numbers.
- [ ] Wrong code carries `data-bad="true"`.
- [ ] Three or more exercises, all with complete revealed solutions.
- [ ] No banned words (§3). No `<h1>`. No inline styles.
- [ ] Page opens from `file://` with zero network requests.
