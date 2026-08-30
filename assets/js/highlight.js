/* ============================================================================
   highlight.js — dependency-free syntax highlighter.

   Written by hand rather than vendored because every third-party highlighter
   ships as an ES module or expects a bundler, and neither survives file://.
   See CONTENT-LOADING.md.

   Public API:
     CSPREP.highlight(sourceText, langName) -> HTML string (already escaped)

   Approach: a per-language ordered rule list of sticky regexes. At each
   position the first matching rule wins. Anything unmatched is emitted as an
   escaped literal character. O(n x rules), which is far below perceptible for
   the code sizes used here.
   ========================================================================= */

(function (global) {
  "use strict";

  var CSPREP = global.CSPREP = global.CSPREP || {};

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  CSPREP.escapeHtml = esc;

  /* -- rule helpers ------------------------------------------------------- */

  function r(cls, source) {
    return { cls: cls, re: new RegExp(source, "y") };
  }
  function words(list) {
    return "(?:" + list.join("|") + ")\\b";
  }

  /* -- C# ----------------------------------------------------------------- */

  var CS_KEYWORDS = [
    "abstract", "as", "async", "await", "base", "bool", "break", "byte", "case", "catch",
    "char", "checked", "class", "const", "continue", "decimal", "default", "delegate", "do",
    "double", "dynamic", "else", "enum", "event", "explicit", "extern", "false", "file",
    "finally", "fixed", "float", "for", "foreach", "get", "global", "goto", "if", "implicit",
    "in", "init", "int", "interface", "internal", "is", "lock", "long", "nameof", "namespace",
    "new", "nint", "not", "notnull", "nuint", "null", "object", "operator", "out", "override",
    "params", "partial", "private", "protected", "public", "readonly", "record", "ref",
    "required", "return", "sbyte", "scoped", "sealed", "set", "short", "sizeof", "stackalloc",
    "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof", "uint",
    "ulong", "unchecked", "unmanaged", "unsafe", "ushort", "using", "value", "var", "virtual",
    "void", "volatile", "when", "where", "while", "with", "yield"
  ];

  var csharpRules = [
    // XML doc comment, then ordinary comments
    r("cmt", "///[^\\n]*"),
    r("cmt", "//[^\\n]*"),
    r("cmt", "/\\*[\\s\\S]*?\\*/"),
    // preprocessor directives
    r("pre", "#[ \\t]*(?:if|else|elif|endif|define|undef|warning|error|line|region|endregion|pragma|nullable)[^\\n]*"),
    // raw string literals (C# 11+): """ ... """ — non-greedy, allows newlines
    r("str", '"""[\\s\\S]*?"""'),
    // verbatim strings, interpolated or not: @"..", $@"..", @$".." — "" is an escaped quote
    r("str", '(?:\\$@|@\\$|@)"(?:[^"]|"")*"'),
    // interpolated and regular strings; \\" is escaped
    r("str", '\\$?"(?:\\\\.|[^"\\\\\\n])*"'),
    // character literals
    r("str", "'(?:\\\\.|[^'\\\\\\n])'"),
    // attribute usage at the start of a line: [Route("x")]
    r("attr", "^[ \\t]*\\[[A-Za-z_][\\w.]*(?:\\([^\\)\\n]*\\))?[^\\]\\n]*\\]"),
    // numbers: hex, binary, decimal with separators and suffixes
    r("num", "\\b0[xX][0-9a-fA-F_]+[uUlLfFdDmM]*\\b"),
    r("num", "\\b0[bB][01_]+[uUlL]*\\b"),
    r("num", "\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?[uUlLfFdDmM]*\\b"),
    // keywords
    r("kw", words(CS_KEYWORDS)),
    // method / invocation names: identifier immediately before ( or <
    r("func", "\\b[A-Za-z_]\\w*(?=\\s*(?:<[^<>()\\n]*>)?\\s*\\()"),
    // PascalCase identifiers read as types
    r("type", "\\b[A-Z]\\w*\\b"),
    // everything else: plain identifiers consumed in one go so we don't
    // re-test a keyword rule mid-identifier
    r(null, "\\b[a-z_]\\w*\\b")
  ];

  /* -- SQL ---------------------------------------------------------------- */

  var SQL_KEYWORDS = [
    "ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "BEGIN", "BETWEEN", "BY", "CASE", "CAST",
    "CHECK", "COLUMN", "COMMIT", "CONSTRAINT", "CREATE", "CROSS", "CTE", "DECLARE", "DEFAULT",
    "DELETE", "DESC", "DISTINCT", "DROP", "ELSE", "END", "EXCEPT", "EXEC", "EXISTS", "FALSE",
    "FETCH", "FILTER", "FOR", "FOREIGN", "FROM", "FULL", "GROUP", "HAVING", "IF", "IN", "INDEX",
    "INNER", "INSERT", "INTERSECT", "INTO", "IS", "ISOLATION", "JOIN", "KEY", "LEFT", "LEVEL",
    "LIKE", "LIMIT", "MERGE", "NOT", "NULL", "NULLS", "OFFSET", "ON", "OR", "ORDER", "OUTER",
    "OVER", "PARTITION", "PRIMARY", "PROCEDURE", "READ", "RECURSIVE", "REFERENCES", "RETURNING",
    "RIGHT", "ROLLBACK", "ROW", "ROWS", "SELECT", "SET", "SNAPSHOT", "TABLE", "THEN", "TOP",
    "TRAN", "TRANSACTION", "TRUE", "UNION", "UNIQUE", "UPDATE", "USING", "VALUES", "VIEW",
    "WHEN", "WHERE", "WITH", "WITHIN"
  ];
  var SQL_FUNCS = [
    "ABS", "AVG", "COALESCE", "CONCAT", "COUNT", "DATEADD", "DATEDIFF", "DENSE_RANK", "FIRST_VALUE",
    "GETDATE", "GETUTCDATE", "IIF", "ISNULL", "LAG", "LAST_VALUE", "LEAD", "LEN", "LOWER", "MAX",
    "MIN", "NOW", "NTILE", "NULLIF", "RANK", "ROW_NUMBER", "SUM", "UPPER"
  ];

  var sqlRules = [
    r("cmt", "--[^\\n]*"),
    r("cmt", "/\\*[\\s\\S]*?\\*/"),
    r("str", "N?'(?:''|[^'])*'"),
    r("type", "\\[[^\\]\\n]*\\]"),
    r("num", "\\b\\d+(?:\\.\\d+)?\\b"),
    r("attr", "@[A-Za-z_]\\w*"),
    r("func", "\\b(?:" + SQL_FUNCS.join("|") + ")\\b(?=\\s*\\()"),
    r("func", "\\b(?:" + SQL_FUNCS.map(function (w) { return w.toLowerCase(); }).join("|") + ")\\b(?=\\s*\\()"),
    r("kw", words(SQL_KEYWORDS)),
    r("kw", words(SQL_KEYWORDS.map(function (w) { return w.toLowerCase(); }))),
    r(null, "\\b\\w+\\b")
  ];

  /* -- JSON --------------------------------------------------------------- */

  var jsonRules = [
    r("attr", '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)'),
    r("str", '"(?:\\\\.|[^"\\\\])*"'),
    r("num", "-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"),
    r("kw", "\\b(?:true|false|null)\\b"),
    r("cmt", "//[^\\n]*")
  ];

  /* -- XML / csproj ------------------------------------------------------- */

  var xmlRules = [
    r("cmt", "<!--[\\s\\S]*?-->"),
    r("str", '"(?:[^"\\n])*"'),
    r("str", "'(?:[^'\\n])*'"),
    r("kw", "</?[A-Za-z_][\\w.:-]*"),
    r("kw", "/?>"),
    r("attr", "\\b[A-Za-z_][\\w.:-]*(?=\\s*=)"),
    r(null, "\\b\\w+\\b")
  ];

  /* -- Bash / shell ------------------------------------------------------- */

  var BASH_KEYWORDS = [
    "cd", "curl", "docker", "dotnet", "echo", "elif", "else", "exit", "export", "fi",
    "for", "git", "grep", "if", "in", "kubectl", "ls", "mkdir", "npm", "rm", "set", "sudo",
    "then", "while"
  ];

  var bashRules = [
    r("cmt", "#[^\\n]*"),
    r("str", '"(?:\\\\.|[^"\\\\])*"'),
    r("str", "'[^'\\n]*'"),
    r("attr", "\\$\\{?[A-Za-z_]\\w*\\}?"),
    r("kw", words(BASH_KEYWORDS)),
    r("num", "\\s--?[A-Za-z][\\w-]*"),
    r(null, "\\b\\w+\\b")
  ];

  /* -- console output ----------------------------------------------------- */

  var consoleRules = [
    r("cmt", "^[ \\t]*(?:#|//)[^\\n]*"),
    r("err", "\\b(?:Unhandled exception|error|Error|ERROR|FAIL|Failed|System\\.\\w+Exception)\\b[^\\n]*"),
    r("num", "\\b\\d+(?:[.,]\\d+)*(?:\\s?(?:ns|us|ms|s|B|KB|MB|GB))?\\b"),
    r("str", "'[^'\\n]*'")
  ];

  var LANGS = {
    csharp: csharpRules,
    cs: csharpRules,
    sql: sqlRules,
    json: jsonRules,
    xml: xmlRules,
    csproj: xmlRules,
    bash: bashRules,
    sh: bashRules,
    shell: bashRules,
    console: consoleRules
  };

  /* -- scanner ------------------------------------------------------------ */

  var NL = "\n";

  /**
   * Emit a token as HTML. A token that spans newlines is split so that no
   * <span> element ever contains a newline. app.js relies on being able to
   * split the highlighted HTML on newlines to build per-line rows with line
   * numbers, which multi-line comments and raw string literals would otherwise
   * break.
   */
  function emit(cls, text) {
    if (!cls) return esc(text);
    var parts = text.split(NL);
    for (var i = 0; i < parts.length; i++) {
      parts[i] = parts[i].length
        ? '<span class="tok-' + cls + '">' + esc(parts[i]) + "</span>"
        : "";
    }
    return parts.join(NL);
  }

  function tokenize(src, rules) {
    var out = "";
    var i = 0;
    var n = src.length;
    var pending = "";

    while (i < n) {
      var hit = null;
      for (var k = 0; k < rules.length; k++) {
        var rule = rules[k];
        rule.re.lastIndex = i;
        var m = rule.re.exec(src);
        if (m && m[0].length > 0) { hit = { cls: rule.cls, text: m[0] }; break; }
      }

      if (hit) {
        if (pending) { out += esc(pending); pending = ""; }
        out += emit(hit.cls, hit.text);
        i += hit.text.length;
      } else {
        pending += src[i];
        i++;
      }
    }
    if (pending) out += esc(pending);
    return out;
  }

  /**
   * Highlight source text. Unknown languages fall back to plain escaped text,
   * which is always safe.
   */
  CSPREP.highlight = function (source, lang) {
    var rules = LANGS[(lang || "").toLowerCase()];
    if (!rules) return esc(source);
    try {
      return tokenize(source, rules);
    } catch (e) {
      // A malformed pattern must never take the page down.
      return esc(source);
    }
  };

  CSPREP.knownLanguages = Object.keys(LANGS);
})(window);
