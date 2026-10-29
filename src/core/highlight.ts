// Small syntax highlighter for code shown in transcripts (fenced blocks, diffs, file previews).
// A per-language table drives one scanner; it is line-oriented but carries block comments and
// multi-line strings across lines. Agents map token kinds to their own colors.
import type { Span } from "./types.js";

export type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "type"
  | "constant"
  | "builtin"
  | "property"
  | "variable"
  | "operator"
  | "punct"
  | "tag"
  | "attr";

export interface Token {
  t: string;
  k: TokenKind;
}

export type SyntaxTheme = Partial<Record<TokenKind, Partial<Span>>>;

interface Lang {
  keywords: Set<string>;
  types?: Set<string>;
  constants?: Set<string>;
  builtins?: Set<string>;
  /** Line comment starters. */
  line?: string[];
  block?: [string, string];
  /** Quote delimiters, longest first; those in `multiline` may span lines. */
  quotes: string[];
  multiline?: string[];
  /** Capitalized identifiers are types. */
  capsTypes?: boolean;
  /** Keys followed by ":" are properties (JSON, YAML, CSS). */
  props?: boolean;
  shell?: boolean;
  markup?: boolean;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE_CONSTANTS = words("true false null nullptr NULL nil undefined NaN Infinity");

const JS: Lang = {
  keywords: words(`
    async await break case catch class const continue debugger default delete do else enum export
    extends finally for from function if implements import in instanceof interface let new of
    package private protected public readonly return static super switch this throw try type
    typeof var void while with yield as satisfies declare namespace abstract keyof infer is get set`),
  types: words("string number boolean any unknown never object symbol bigint void"),
  constants: words("true false null undefined NaN Infinity"),
  builtins: words("console process require module exports window document globalThis JSON Math Promise Object Array"),
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ["`", "\"", "'"],
  multiline: ["`"],
  capsTypes: true,
};

const PYTHON: Lang = {
  keywords: words(`
    and as assert async await break class continue def del elif else except finally for from global
    if import in is lambda nonlocal not or pass raise return try while with yield match case`),
  types: words("int float str bool bytes list dict set tuple object"),
  constants: words("True False None"),
  builtins: words("print len range open self cls super isinstance enumerate zip map filter sorted"),
  line: ["#"],
  quotes: ["\"\"\"", "'''", "\"", "'"],
  multiline: ["\"\"\"", "'''"],
  capsTypes: true,
};

const RUST: Lang = {
  keywords: words(`
    as async await break const continue crate dyn else enum extern fn for if impl in let loop match
    mod move mut pub ref return self Self static struct super trait type unsafe use where while`),
  types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box"),
  constants: words("true false None Some Ok Err"),
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ["\""],
  multiline: ["\""],
  capsTypes: true,
};

const GO: Lang = {
  keywords: words(`
    break case chan const continue default defer else fallthrough for func go goto if import
    interface map package range return select struct switch type var`),
  types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any"),
  constants: words("true false nil iota"),
  builtins: words("append cap close copy delete len make new panic print println recover"),
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ["`", "\"", "'"],
  multiline: ["`"],
  capsTypes: false,
};

const C_FAMILY: Lang = {
  keywords: words(`
    abstract break case catch class const continue default do else enum extends final finally for
    if implements import in instanceof interface namespace new override package private protected
    public return sealed static struct super switch template this throw throws try typedef typename
    union using virtual void volatile while fun val var when object companion data func let guard
    defer extension protocol init deinit inline constexpr auto sizeof goto extern register signed
    unsigned operator friend async await yield is as get set where`),
  types: words("int long short char float double bool boolean byte void string String Int Long Double Float Boolean Unit Any size_t"),
  constants: C_LIKE_CONSTANTS,
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ["\"\"\"", "\"", "'"],
  multiline: ["\"\"\""],
  capsTypes: true,
};

const RUBY: Lang = {
  keywords: words(`
    alias and begin break case class def defined do else elsif end ensure for if in module next not
    or redo rescue retry return self super then undef unless until when while yield require attr_reader
    attr_accessor private protected public`),
  constants: words("true false nil"),
  line: ["#"],
  quotes: ["\"", "'"],
  capsTypes: true,
};

const SHELL: Lang = {
  keywords: words("if then else elif fi for in do done while until case esac function return local export select time"),
  builtins: words("echo cd exit set unset source alias read printf test"),
  line: ["#"],
  quotes: ["\"", "'"],
  multiline: ["\"", "'"],
  shell: true,
};

const JSON_LANG: Lang = {
  keywords: new Set(),
  constants: words("true false null"),
  quotes: ["\""],
  props: true,
};

const YAML: Lang = {
  keywords: new Set(),
  constants: words("true false null yes no on off ~"),
  line: ["#"],
  quotes: ["\"", "'"],
  props: true,
};

const TOML: Lang = { ...YAML, constants: words("true false") };

const CSS: Lang = {
  keywords: words("important media import supports keyframes from to and not only"),
  line: [],
  block: ["/*", "*/"],
  quotes: ["\"", "'"],
  props: true,
};

const SQL: Lang = {
  keywords: words(`
    select from where and or not insert into values update set delete create table alter drop index
    join left right inner outer on as group by order having limit offset union all distinct primary
    key foreign references default null is in exists between like case when then else end returning
    begin commit rollback with SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE
    TABLE ALTER DROP INDEX JOIN LEFT RIGHT INNER OUTER ON AS GROUP BY ORDER HAVING LIMIT OFFSET UNION
    ALL DISTINCT PRIMARY KEY FOREIGN REFERENCES DEFAULT NULL IS IN EXISTS BETWEEN LIKE CASE WHEN THEN
    ELSE END RETURNING BEGIN COMMIT ROLLBACK WITH`),
  types: words("int integer text varchar boolean timestamp serial bigint real date INT INTEGER TEXT VARCHAR BOOLEAN TIMESTAMP SERIAL BIGINT REAL DATE"),
  constants: words("true false TRUE FALSE"),
  line: ["--"],
  block: ["/*", "*/"],
  quotes: ["'", "\""],
};

const LUA: Lang = {
  keywords: words("and break do else elseif end for function goto if in local not or repeat return then until while"),
  constants: words("true false nil"),
  line: ["--"],
  quotes: ["\"", "'"],
};

const MARKUP: Lang = { keywords: new Set(), quotes: ["\"", "'"], markup: true };

const LANGS: Record<string, Lang> = {
  js: JS, jsx: JS, mjs: JS, cjs: JS, javascript: JS, ts: JS, tsx: JS, mts: JS, cts: JS, typescript: JS,
  py: PYTHON, python: PYTHON, pyi: PYTHON,
  rs: RUST, rust: RUST,
  go: GO, golang: GO,
  c: C_FAMILY, h: C_FAMILY, cc: C_FAMILY, cpp: C_FAMILY, hpp: C_FAMILY, cxx: C_FAMILY, "c++": C_FAMILY,
  java: C_FAMILY, kt: C_FAMILY, kts: C_FAMILY, kotlin: C_FAMILY, swift: C_FAMILY, cs: C_FAMILY,
  csharp: C_FAMILY, scala: C_FAMILY, dart: C_FAMILY, m: C_FAMILY, zig: C_FAMILY,
  rb: RUBY, ruby: RUBY,
  sh: SHELL, bash: SHELL, zsh: SHELL, shell: SHELL, console: SHELL, fish: SHELL,
  json: JSON_LANG, jsonc: JSON_LANG, json5: JSON_LANG, jsonl: JSON_LANG,
  yaml: YAML, yml: YAML, toml: TOML, ini: TOML,
  css: CSS, scss: CSS, sass: CSS, less: CSS,
  sql: SQL,
  lua: LUA,
  html: MARKUP, htm: MARKUP, xml: MARKUP, svg: MARKUP, vue: MARKUP, svelte: MARKUP, astro: MARKUP,
};

const FILENAMES: Record<string, string> = { Dockerfile: "sh", Makefile: "sh", ".bashrc": "sh", ".zshrc": "sh" };

/** Language from a fence tag ("ts") or a file path ("src/a.ts"); null when unknown. */
export function langFor(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const tag = hint.trim().toLowerCase();
  if (LANGS[tag]) return tag;
  const base = hint.split("/").pop() ?? hint;
  if (FILENAMES[base]) return FILENAMES[base]!;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANGS[ext] ? ext : null;
}

const IDENT = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/;
const OPERATOR = /^(?:=>|->|::|[+\-*/%=&|<>!?^~]+)/;

/**
 * A stateful highlighter: feed it consecutive lines of one file or block and it returns tokens
 * per line. Unknown languages come back as a single plain token.
 */
export function highlighter(lang: string | null): (line: string) => Token[] {
  const L = lang ? LANGS[lang] : undefined;
  if (!L) return (line) => [{ t: line, k: "plain" }];
  let inBlock = false;
  let inString: string | null = null;
  let inTag = false;

  return (line) => {
    const out: Token[] = [];
    const push = (t: string, k: TokenKind) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && last.k === k) last.t += t;
      else out.push({ t, k });
    };
    // index just past the closing quote, or -1 if the string runs on
    const closeString = (from: number, q: string): number => {
      for (let j = from; j < line.length; j++) {
        // backslash escapes, except inside shell single quotes
        if (line[j] === "\\" && !(L.shell && q === "'")) {
          j++;
          continue;
        }
        if (line.startsWith(q, j)) return j + q.length;
      }
      return -1;
    };
    const nextNonSpace = (from: number) => line.slice(from).match(/^\s*(.)/)?.[1] ?? "";
    let i = 0;
    let commandPos = true; // shell: the next word is a command name

    if (inBlock && L.block) {
      const end = line.indexOf(L.block[1]);
      if (end < 0) return [{ t: line, k: "comment" }];
      push(line.slice(0, end + L.block[1].length), "comment");
      i = end + L.block[1].length;
      inBlock = false;
    } else if (inString) {
      const end = closeString(0, inString);
      if (end < 0) return [{ t: line, k: "string" }];
      push(line.slice(0, end), "string");
      i = end;
      inString = null;
    }

    while (i < line.length) {
      const rest = line.slice(i);
      const ch = line[i]!;
      const prev = i > 0 ? line[i - 1]! : "";

      if (/\s/.test(ch)) {
        const ws = rest.match(/^\s+/)![0];
        push(ws, "plain");
        i += ws.length;
        continue;
      }

      if (L.markup) {
        if (rest.startsWith("<!--")) {
          const end = line.indexOf("-->", i + 4);
          const stop = end < 0 ? line.length : end + 3;
          push(line.slice(i, stop), "comment");
          i = stop;
          continue;
        }
        const open = rest.match(/^<\/?([A-Za-z][\w:.-]*)/);
        if (open) {
          push(open[0].slice(0, open[0].length - open[1]!.length), "punct");
          push(open[1]!, "tag");
          i += open[0].length;
          inTag = true;
          continue;
        }
        if (inTag && (rest.startsWith("/>") || ch === ">")) {
          const t = rest.startsWith("/>") ? "/>" : ">";
          push(t, "punct");
          i += t.length;
          inTag = false;
          continue;
        }
        if (inTag) {
          const attr = rest.match(/^[@:#]?[A-Za-z_][\w:.-]*/);
          if (attr) {
            push(attr[0], "attr");
            i += attr[0].length;
            continue;
          }
          if (ch === "\"" || ch === "'") {
            const end = line.indexOf(ch, i + 1);
            const stop = end < 0 ? line.length : end + 1;
            push(line.slice(i, stop), "string");
            i = stop;
            continue;
          }
          push(ch, ch === "=" ? "operator" : "punct");
          i++;
          continue;
        }
        const text = rest.match(/^[^<]+/)?.[0] ?? ch;
        push(text, "plain");
        i += text.length;
        continue;
      }

      if (L.line?.some((s) => rest.startsWith(s)) && (!L.shell || !prev || /\s/.test(prev))) {
        push(rest, "comment");
        break;
      }
      if (L.block && rest.startsWith(L.block[0])) {
        const end = line.indexOf(L.block[1], i + L.block[0].length);
        if (end < 0) {
          push(rest, "comment");
          inBlock = true;
          break;
        }
        push(line.slice(i, end + L.block[1].length), "comment");
        i = end + L.block[1].length;
        continue;
      }

      const q = L.quotes.find((s) => rest.startsWith(s));
      if (q) {
        const end = closeString(i + q.length, q);
        if (end < 0) {
          push(rest, "string");
          if (L.multiline?.includes(q)) inString = q;
          break;
        }
        const s = line.slice(i, end);
        push(s, L.props && nextNonSpace(end) === ":" ? "property" : "string");
        i = end;
        commandPos = false;
        continue;
      }

      if (L.shell && ch === "$") {
        const v = rest.match(/^\$(?:\{[^}]*\}|\w+|[@#?*!$0-9])/)?.[0];
        if (v) {
          push(v, "variable");
          i += v.length;
          commandPos = false;
          continue;
        }
      }

      if (/\d/.test(ch) && !/[\w$]/.test(prev)) {
        const n = rest.match(NUMBER)![0];
        push(n, "number");
        i += n.length;
        continue;
      }

      const id = rest.match(L.shell ? /^[\w./~-][\w./~:@%+=-]*/ : IDENT)?.[0];
      if (id) {
        const after = nextNonSpace(i + id.length);
        let k: TokenKind = "plain";
        if (L.shell) {
          if (L.keywords.has(id)) k = "keyword";
          else if (commandPos && !id.includes("=")) k = "function";
          else if (id.startsWith("-")) k = "constant";
          commandPos = L.keywords.has(id);
        } else if (L.props && after === ":" && !L.keywords.has(id)) k = "property";
        else if (L.keywords.has(id)) k = "keyword";
        else if (L.constants?.has(id)) k = "constant";
        else if (L.types?.has(id)) k = "type";
        else if (L.builtins?.has(id) && after !== ":") k = "builtin";
        else if (after === "(" || (lang === "rs" || lang === "rust") && after === "!") k = "function";
        else if (L.capsTypes && /^[A-Z][a-z]/.test(id)) k = "type";
        else if (/^[A-Z][A-Z\d_]+$/.test(id) && id.length > 1) k = "constant";
        push(id, k);
        i += id.length;
        continue;
      }

      if (L.shell && /[|;&(`]/.test(ch)) {
        const op = rest.match(/^(?:\|\||&&|\$\(|[|;&(`])/)![0];
        push(op, "operator");
        i += op.length;
        commandPos = true;
        continue;
      }

      const op = rest.match(OPERATOR)?.[0];
      if (op) {
        push(op, "operator");
        i += op.length;
        continue;
      }
      push(ch, "punct");
      i++;
    }
    return out;
  };
}

/** Highlighted spans for one line, styled by `theme` over `base`. */
export function codeSpans(tokens: Token[], theme: SyntaxTheme, base: Partial<Span> = {}): Span[] {
  return tokens.map((tok) => ({ ...base, ...theme[tok.k], t: tok.t }));
}

/** Highlight a whole block: one span list per line. */
export function highlightLines(code: string, lang: string | null, theme: SyntaxTheme, base: Partial<Span> = {}): Span[][] {
  const hl = highlighter(lang);
  return code.split("\n").map((l) => codeSpans(hl(l), theme, base));
}
