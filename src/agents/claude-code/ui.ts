// Claude Code's terminal UI as styled rows. Everything here returns rows of spans for a terminal
// `cols` wide; the core renderer turns them into pixels. Matches Claude Code 2.x's dark theme.
import path from "node:path";
import { codeSpans, highlighter, langFor, type SyntaxTheme } from "../../core/highlight.js";
import { padTo, spansText, spansWidth, strWidth, truncate, wrap } from "../../core/text.js";
import { changedRanges, markRanges, type Range } from "../../core/worddiff.js";
import type { Row, SessionEvent, SessionMeta, Span, Theme } from "../../core/types.js";

export type ToolEvent = Extract<SessionEvent, { kind: "tool" }>;
type Data = Record<string, any>; // tool inputs and results are loosely shaped

export const C = {
  bg: "#1c1c1e",
  text: "#ffffff",
  body: "#e8e8e8", // the terminal's default foreground
  inactive: "#999999",
  subtle: "#505050",
  claude: "#d77757",
  claudeShimmer: "#eb9f7f",
  clawdBg: "#000000",
  success: "#4eba65",
  error: "#ff6b80",
  permission: "#b1b9f9",
  promptBorder: "#888888",
  userBg: "#373737",
  diffAdded: "#225c2b",
  diffRemoved: "#7a2936",
  diffAddedMark: "#50c850",
  diffAddedWord: "#38a660",
  diffRemovedWord: "#b3596b",
  diffRemovedMark: "#dc5a5a",
};

export const theme: Theme = { bg: C.bg, body: C.body, accent: C.claude };

// Diffs and file previews: the default "Monokai Extended" syntax theme.
const SYNTAX: SyntaxTheme = {
  plain: { fg: "#f8f8f2" },
  keyword: { fg: "#f92672" },
  string: { fg: "#e6db74" },
  comment: { fg: "#75715e" },
  number: { fg: "#ae81ff" },
  constant: { fg: "#ae81ff" },
  function: { fg: "#a6e22e" },
  type: { fg: "#66d9ef", italic: true },
  builtin: { fg: "#66d9ef" },
  property: { fg: "#f8f8f2" },
  variable: { fg: "#f8f8f2" },
  operator: { fg: "#f92672" },
  punct: { fg: "#f8f8f2" },
  tag: { fg: "#f92672" },
  attr: { fg: "#a6e22e" },
};

// Fenced code blocks in replies: highlight.js classes in the terminal's ANSI colors.
const ANSI = { blue: "#5c9cf5", cyan: "#4fc1d6", green: "#5fbf6f", red: "#e5686f", yellow: "#e2c46a", grey: "#8a8a8a" };
const MD_SYNTAX: SyntaxTheme = {
  keyword: { fg: ANSI.blue },
  string: { fg: ANSI.red },
  comment: { fg: ANSI.green },
  number: { fg: ANSI.green },
  constant: { fg: ANSI.blue },
  function: { fg: ANSI.yellow },
  type: { fg: ANSI.cyan },
  builtin: { fg: ANSI.cyan },
  property: { fg: ANSI.blue },
  tag: { fg: ANSI.grey },
  attr: { fg: ANSI.cyan },
};

const S = (t: string, o: Partial<Span> = {}): Span => ({ t, fg: C.body, ...o });
const dim = (t: string, o: Partial<Span> = {}): Span => S(t, { fg: C.inactive, ...o });
const bold = (t: string, o: Partial<Span> = {}): Span => S(t, { bold: true, ...o });
const plural = (n: number, word: string, many = `${word}s`) => (n === 1 ? word : many);
const NBSP = " ";

// Result gutter: "  ⎿  " on the first line, a 5-column indent after.
const R1 = (): Span[] => [dim(`  ⎿ ${NBSP}`)];
const RN = (): Span[] => [S("     ")];
const result = (spans: Span[], cols: number): Row[] => wrap(spans, cols, R1(), RN());
const more = (n: number, extra = "") => dim(`… +${n} ${plural(n, "line")}${extra} (ctrl+o to expand)`);

export const isV2 = (meta: SessionMeta) => Number((meta.version ?? "2").split(".")[0]) >= 2;

export function title(meta: SessionMeta): string {
  return `claude — ${tildify(meta.cwd ?? "")}`;
}

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");

/** "claude-opus-4-5-20251101" → "Opus 4.5" */
export function modelLabel(model: string | null): string | null {
  const m = model?.match(/claude-(?:([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?|(\d+)(?:-(\d{1,2}))?-([a-z]+))/);
  if (!m) return model;
  const [family, major, minor] = m[1] ? [m[1], m[2], m[3]] : [m[6]!, m[4], m[5]];
  return `${family[0]!.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

/** Claude Code's byte sizes: "512 bytes", "1.5KB", "2MB". */
export function formatBytes(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${trim(n / 1024)}KB`;
  return `${trim(n / 1024 / 1024)}MB`;
}

// --- header --------------------------------------------------------------------------------

// Clawd, default pose: the eye cells sit on a black background so the missing quadrants of "▛"
// read as eyes. [text, columns on black].
const MASCOT: Array<[string, [number, number] | null]> = [
  [" ▐▛███▛█ ", [2, 8]],
  ["▝▜██████▀", [2, 7]],
  [" ▝▝   ▝▝ ", null],
];

function mascotSpans([text, eyes]: (typeof MASCOT)[number]): Span[] {
  const chars = [...text];
  if (!eyes) return [S(text, { fg: C.claude })];
  return [
    S(chars.slice(0, eyes[0]).join(""), { fg: C.claude }),
    S(chars.slice(eyes[0], eyes[1]).join(""), { fg: C.claude, bg: C.clawdBg }),
    S(chars.slice(eyes[1]).join(""), { fg: C.claude }),
  ];
}

export function headerRows(meta: SessionMeta, cols: number): Row[] {
  const cwd = tildify(meta.cwd ?? "~");
  if (isV2(meta)) {
    const right = [
      [bold("Claude Code", { fg: C.text }), dim(meta.version ? ` v${meta.version}` : "")],
      [dim(modelLabel(meta.model) ?? "Claude")],
      [dim(truncateMiddle(cwd, cols - 11))],
    ];
    return MASCOT.map((m, i) => ({ spans: [...mascotSpans(m), S("  "), ...right[i]!] }));
  }
  const w = Math.min(cols, 58);
  const inner = w - 4;
  const line = (spans: Span[] = []): Row => ({
    spans: [S("│ ", { fg: C.claude }), ...padTo(spans, inner), S(" │", { fg: C.claude })],
  });
  return [
    { spans: [S(`╭${"─".repeat(w - 2)}╮`, { fg: C.claude })] },
    line([S("✻", { fg: C.claude }), S(" Welcome to ", { fg: C.text }), bold("Claude Code", { fg: C.text }), S("!", { fg: C.text })]),
    line(),
    line([dim("  /help for help, /status for your current setup", { italic: true })]),
    line(),
    line([dim(`  ${truncate(`cwd: ${cwd}`, inner - 2)}`)]),
    { spans: [S(`╰${"─".repeat(w - 2)}╯`, { fg: C.claude })] },
  ];
}

function truncateMiddle(s: string, width: number): string {
  if (strWidth(s) <= width) return s;
  const keep = Math.max(1, width - 1);
  const head = Math.ceil(keep / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

// --- markdown ------------------------------------------------------------------------------

function inline(text: string, base: Partial<Span> = {}): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|~~[^~\n]+~~|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<!\w)_[^_\s][^_\n]*_(?!\w)|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push(S(text.slice(last, m.index), base));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) spans.push(S(tok.slice(2, -2), { ...base, bold: true }));
    else if (tok.startsWith("`")) spans.push(S(tok.slice(1, -1), { ...base, fg: C.permission }));
    else if (tok.startsWith("~~")) spans.push(S(tok.slice(2, -2), { ...base, strike: true }));
    else if (tok.startsWith("[")) spans.push(S(tok.slice(1, tok.indexOf("]")), { ...base, underline: true }));
    else spans.push(S(tok.slice(1, -1), { ...base, italic: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push(S(text.slice(last), base));
  return spans;
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const listMarker = (depth: number, n: number) =>
  depth === 0 ? `${n}.` : depth === 1 ? `${String.fromCharCode(96 + ((n - 1) % 26) + 1)}.` : `${ROMAN[(n - 1) % ROMAN.length]}.`;

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const tableCells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function tableRows(lines: string[], width: number): Row[] {
  const [head, , ...body] = lines.map(tableCells);
  const rows = [head!, ...body];
  const n = Math.max(...rows.map((r) => r.length));
  const plain = (c: string) => spansText(inline(c));
  const widths = Array.from({ length: n }, (_, i) => Math.max(3, ...rows.map((r) => strWidth(plain(r[i] ?? "")))));
  const total = widths.reduce((a, w) => a + w + 3, 1);
  if (total > width) {
    // too wide: Claude Code falls back to "Header: value" lines per row
    return body.flatMap((r, ri) => [
      ...(ri > 0 ? [{ spans: [] }] : []),
      ...r.flatMap((c, i) => wrap([bold(`${head![i] ?? ""}: `), ...inline(c)], width)),
    ]);
  }
  const line = (l: string, m: string, r: string) => ({ spans: [S(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r)] });
  const cellRow = (r: string[], center: boolean): Row => {
    const spans: Span[] = [S("│")];
    widths.forEach((w, i) => {
      const content = inline(r[i] ?? "", center ? { bold: true } : {});
      const pad = w - spansWidth(content);
      const left = center ? Math.floor(pad / 2) : 0;
      spans.push(S(` ${" ".repeat(left)}`), ...content, S(`${" ".repeat(pad - left)} │`));
    });
    return { spans };
  };
  const out: Row[] = [line("┌", "┬", "┐"), cellRow(head!, true)];
  for (const r of body) out.push(line("├", "┼", "┤"), cellRow(r, false));
  out.push(line("└", "┴", "┘"));
  return out;
}

function markdownRows(text: string, cols: number, first: Span[], rest: Span[]): Row[] {
  const rows: Row[] = [];
  const src = text.split("\n");
  const counters: number[] = [];
  let fence: ((line: string) => Span[]) | null = null;
  let isFirst = true;
  const emit = (r: Row[]) => {
    if (!r.length) return;
    rows.push(...r);
    isFirst = false;
  };
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const gutter = isFirst ? first : rest;
    const width = cols - spansWidth(gutter);
    const fenceMatch = line.match(/^\s*```\s*(\S*)/);
    if (fenceMatch) {
      const lang = langFor(fenceMatch[1]);
      const hl = highlighter(lang);
      fence = fence ? null : lang ? (l) => codeSpans(hl(l), MD_SYNTAX, { fg: C.body }) : (l) => [S(l, fenceMatch[1] ? {} : { fg: C.permission })];
      continue;
    }
    if (fence) {
      emit(wrap(fence(line), cols, gutter, rest));
      continue;
    }
    if (isTableRow(line) && i + 1 < src.length && isTableRule(src[i + 1]!)) {
      let j = i;
      while (j < src.length && (isTableRow(src[j]!) || isTableRule(src[j]!))) j++;
      emit(tableRows(src.slice(i, j), width).map((r, k) => ({ ...r, spans: [...(k === 0 ? gutter : rest), ...r.spans], prefix: 1 })));
      i = j - 1;
      continue;
    }
    if (!line.trim()) {
      counters.length = 0;
      rows.push({ spans: [...gutter], prefix: gutter.length });
      isFirst = false;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (heading) {
      const h1 = heading[1]!.length === 1;
      emit(wrap(inline(heading[2]!, { bold: true, italic: h1, underline: h1 }), cols, gutter, rest));
    } else if (bullet) {
      const depth = Math.floor(bullet[1]!.length / 2);
      const lead = `${"  ".repeat(depth)}- `;
      emit(wrap([S(lead), ...inline(bullet[2]!)], cols, gutter, [...rest, S(" ".repeat(lead.length))]));
    } else if (ordered) {
      const depth = Math.min(2, Math.floor(ordered[1]!.length / 2));
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? 0) + 1;
      const lead = `${"  ".repeat(depth)}${listMarker(depth, counters[depth]!)} `;
      emit(wrap([S(lead), ...inline(ordered[2]!)], cols, gutter, [...rest, S(" ".repeat(lead.length))]));
    } else if (/^>\s?/.test(line)) {
      emit(wrap(inline(line.replace(/^>\s?/, ""), { italic: true }), cols, [...gutter, dim("▎ ")], [...rest, dim("▎ ")]));
    } else {
      emit(wrap(inline(line), cols, gutter, rest));
    }
  }
  return rows;
}

// --- tool calls ----------------------------------------------------------------------------

function rel(p: unknown, cwd: string | null): string {
  if (typeof p !== "string") return "";
  if (cwd && p === cwd) return ".";
  if (cwd && p.startsWith(`${cwd}/`)) return path.relative(cwd, p);
  return tildify(p);
}

/** Bash commands show at most 2 lines / 160 characters. */
function commandArg(command: string): string {
  const ls = command.split("\n");
  let s = ls.slice(0, 2).join("\n");
  let cut = ls.length > 2;
  if (s.length > 160) {
    s = s.slice(0, 160);
    cut = true;
  }
  return cut ? `${s}…` : s;
}

const AGENT_ALIASES = new Set(["general-purpose", "worker"]);

/** Header name and argument, or null for tools Claude Code doesn't show (TodoWrite). */
export function toolTitle(ev: ToolEvent, cwd: string | null): [string, string | null] | null {
  const i = ev.input as Data;
  const search = () => `pattern: "${i.pattern}"${i.path ? `, path: "${rel(i.path, cwd)}"` : ""}`;
  switch (ev.name) {
    case "Bash": return ["Bash", commandArg(String(i.command ?? ""))];
    case "Read": return ["Read", rel(i.file_path, cwd)];
    case "Edit": return [i.old_string === "" ? "Create" : "Update", rel(i.file_path, cwd)];
    case "MultiEdit": return ["Update", rel(i.file_path, cwd)];
    case "Write": return ["Write", rel(i.file_path, cwd)];
    case "Grep": case "Glob": return ["Search", search()];
    case "TodoWrite": return null;
    case "Task": case "Agent": {
      const type = typeof i.subagent_type === "string" ? i.subagent_type : "";
      const desc = typeof i.description === "string" ? i.description.replace(/\s+/g, " ").trim() : null;
      return [!type || AGENT_ALIASES.has(type) ? "Agent" : type, desc];
    }
    case "WebFetch": return ["Fetch", i.url ?? null];
    case "WebSearch": return ["Web Search", `"${i.query}"`];
    case "NotebookEdit": return ["Edit Notebook", rel(i.notebook_path, cwd)];
    case "Skill": return ["Skill", i.skill ?? i.command ?? null];
    default: {
      const args = Object.entries(i).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
      if (ev.name.startsWith("mcp__")) {
        const [, server, tool] = ev.name.split("__");
        return [`${server} - ${tool} (MCP)`, args];
      }
      return [ev.name, args];
    }
  }
}

const lines = (s: unknown) => String(s ?? "").replace(/\s+$/, "").split("\n");

/**
 * Tool output under the result gutter, counted in wrapped rows: up to `max + 1` rows show in
 * full, more show `max` rows then "… +N lines".
 */
function outputRows(text: string, cols: number, max: number, style: Partial<Span> = {}): Row[] {
  const ls = lines(text).filter((l, i, a) => !(i === 0 && !l.trim() && a.length > 1));
  const rows = ls.flatMap((l, i) => wrap([S(l, style)], cols, i === 0 ? R1() : RN(), RN()));
  if (rows.length <= max + 1) return rows;
  const hidden = ls.length - lineCountIn(rows.slice(0, max), ls);
  return [...rows.slice(0, max), ...wrap([more(Math.max(1, hidden))], cols, RN())];
}

// How many source lines the first rows cover (rows from one long line count once).
function lineCountIn(rows: Row[], ls: string[]): number {
  let covered = 0;
  let used = 0;
  for (const l of ls) {
    const needed = Math.max(1, Math.ceil(strWidth(l) / 1e9));
    if (used + needed > rows.length) break;
    used += needed;
    covered++;
  }
  return Math.min(covered, rows.length);
}

const isRejection = (text: string) => /^The user doesn't want to proceed|^User rejected|^\[Request interrupted/.test(text);

function resultRows(ev: ToolEvent, cols: number, cwd: string | null): Row[] {
  const r = ev.result;
  if (!r) return [];
  const d = (r.data ?? {}) as Data;
  const input = ev.input as Data;

  if (r.isError) {
    const text = r.text.replace(/<\/?tool_use_error>/g, "").trim();
    if (isRejection(text)) {
      if (ev.name === "Edit" || ev.name === "MultiEdit" || ev.name === "Write") {
        const verb = ev.name === "Write" ? "write" : "update";
        return result([S(`User rejected ${verb} to `, { fg: C.subtle }), bold(rel(input.file_path, cwd), { fg: C.subtle })], cols);
      }
      return result([dim("Interrupted · What should Claude do instead?")], cols);
    }
    if (/InputValidationError/.test(text)) return result([S("Invalid tool parameters", { fg: C.error })], cols);
    return outputRows(`Error: ${text}`, cols, 10, { fg: C.error });
  }

  switch (ev.name) {
    case "Read": {
      if (d.type === "image") return result([S(`Read image (${formatBytes(d.file?.originalSize ?? 0)})`)], cols);
      if (d.type === "pdf") return result([S(`Read PDF (${formatBytes(d.file?.originalSize ?? 0)})`)], cols);
      if (d.type === "notebook") return result([S("Read "), bold(String(d.file?.cells?.length ?? 0)), S(" cells")], cols);
      const n = d.file?.numLines ?? lines(r.text).length;
      return result([S("Read "), bold(String(n)), S(` ${plural(n, "line")}`)], cols);
    }
    case "Grep": case "Glob": {
      const n = d.numFiles ?? d.filenames?.length ?? Math.max(0, lines(r.text).length - 1);
      return result([S("Found "), bold(`${n} `), S(plural(n, "file")), ...(n > 0 ? [dim(" (ctrl+o to expand)")] : [])], cols);
    }
    case "Edit": case "MultiEdit":
      return diffRows(d.structuredPatch ?? [], cols, input.file_path);
    case "Write": {
      if (d.type === "update" && Array.isArray(d.structuredPatch)) return diffRows(d.structuredPatch, cols, input.file_path);
      const content = String(input.content ?? d.content ?? "");
      const ls = lines(content);
      const rows = result([S("Wrote "), bold(String(ls.length)), S(` ${plural(ls.length, "line")} to `), bold(rel(input.file_path, cwd))], cols);
      const shown = ls.slice(0, 10);
      const gw = String(shown.length).length;
      const hl = highlighter(langFor(input.file_path));
      for (const [i, l] of shown.entries()) {
        rows.push(...wrap([dim(` ${String(i + 1).padStart(gw)}  `), ...codeSpans(hl(l), SYNTAX)], cols, RN(), [...RN(), S(" ".repeat(gw + 3))]));
      }
      const hiddenLines = ls.slice(shown.length);
      if (hiddenLines.length) {
        const chars = hiddenLines.join("\n").length;
        rows.push(...wrap([more(hiddenLines.length, chars >= 1000 ? ` (~${Math.round(chars / 1024)} KB)` : "")], cols, RN()));
      }
      return rows;
    }
    case "Task": case "Agent": {
      const stats = [
        d.totalToolUseCount != null ? `${d.totalToolUseCount} tool ${plural(d.totalToolUseCount, "use")}` : null,
        d.totalTokens != null ? `${formatTokens(d.totalTokens)} tokens` : null,
        d.totalDurationMs != null ? formatElapsed(d.totalDurationMs / 1000) : null,
      ].filter(Boolean);
      return [
        ...result([S(`Done${stats.length ? ` (${stats.join(" · ")})` : ""}`)], cols),
        { spans: [...RN(), dim("(ctrl+o to expand)")] },
      ];
    }
    case "WebFetch": {
      if (d.bytes != null) return result([S("Received "), bold(formatBytes(d.bytes)), S(` (${d.code ?? 200} ${d.codeText ?? "OK"})`)], cols);
      return outputRows(r.text, cols, 3);
    }
    case "WebSearch": {
      const n = Array.isArray(d.results) ? d.results.filter((x: unknown) => typeof x !== "string").length || 1 : 1;
      const sec = typeof d.durationSeconds === "number" ? d.durationSeconds : null;
      const took = sec == null ? "" : sec < 1 ? ` in ${Math.round(sec * 1000)}ms` : ` in ${Math.round(sec)}s`;
      return result([S(`Did ${n} ${plural(n, "search", "searches")}${took}`)], cols);
    }
    case "Bash": {
      let stdout = String(d.stdout ?? "").replace(/\s+$/, "");
      const stderr = String(d.stderr ?? "").replace(/\s+$/, "");
      if (!stdout && !stderr) stdout = r.text.replace(/\s+$/, "");
      if (!stdout && !stderr) return result([dim(d.returnCodeInterpretation ?? "(No output)")], cols);
      return [
        ...(stdout ? outputRows(stdout, cols - 5, 3) : []),
        ...(stderr ? outputRows(stderr, cols - 5, 3, { fg: C.error }).map((row, i) => (stdout && i === 0 ? { ...row, spans: [...RN(), ...row.spans.slice(1)] } : row)) : []),
      ];
    }
    default: {
      if (!r.text.trim()) return result([dim("(No content)")], cols);
      return outputRows(r.text, cols - 5, 3);
    }
  }
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

// "Added N lines, removed M lines", then the diff: " 12 +code" with full-width backgrounds.
function diffRows(hunks: Hunk[], cols: number, file?: string): Row[] {
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l[0] === "+") add++;
      else if (l[0] === "-") del++;
    }
  }
  const summary: Span[] = [];
  if (add) summary.push(S("Added "), bold(String(add)), S(` ${plural(add, "line")}`));
  if (add && del) summary.push(S(", "));
  if (del) summary.push(S(`${add ? "r" : "R"}emoved `), bold(String(del)), S(` ${plural(del, "line")}`));
  const rows = summary.length ? result(summary, cols) : [];

  const width = cols - 12;
  const hl = highlighter(langFor(file));
  hunks.forEach((h, hi) => {
    if (hi > 0) rows.push({ spans: [...RN(), dim("...")] });
    let o = h.oldStart;
    let n = h.newStart;
    const numbers = h.lines.map((l) => (l[0] === "-" ? o++ : l[0] === "+" ? n++ : (o++, n++)));
    const gw = String(Math.max(...numbers, 1)).length;
    // a run of removed lines followed by added lines pairs up line by line for word highlights
    const words = new Map<number, Range[]>();
    for (let i = 0; i < h.lines.length;) {
      if (h.lines[i]![0] !== "-") {
        i++;
        continue;
      }
      let j = i;
      while (h.lines[j]?.[0] === "-") j++;
      let k = j;
      while (h.lines[k]?.[0] === "+") k++;
      for (let p = 0; p < Math.min(j - i, k - j); p++) {
        const ranges = changedRanges(h.lines[i + p]!.slice(1), h.lines[j + p]!.slice(1));
        if (ranges) {
          words.set(i + p, ranges[0]);
          words.set(j + p, ranges[1]);
        }
      }
      i = k;
    }
    h.lines.forEach((l, li) => {
      const mark = l[0] === "+" || l[0] === "-" ? l[0] : " ";
      const code = l[0] === "+" || l[0] === "-" || l[0] === " " ? l.slice(1) : l;
      const bg = mark === "+" ? C.diffAdded : mark === "-" ? C.diffRemoved : undefined;
      const deco = mark === "+" ? C.diffAddedMark : mark === "-" ? C.diffRemovedMark : C.inactive;
      const head = [S(` ${String(numbers[li]).padStart(gw)} `, { fg: deco, bg }), S(mark, { fg: deco, bg })];
      const wordBg = mark === "+" ? C.diffAddedWord : C.diffRemovedWord;
      const spans = markRanges(codeSpans(hl(code), SYNTAX, { bg }), words.get(li) ?? [], { bg: wordBg });
      for (const row of wrap(spans, width, head, [S(" ".repeat(gw + 3), { bg })])) {
        rows.push({ spans: [...RN(), ...(bg ? padTo(row.spans, width, { bg }) : row.spans)] });
      }
    });
  });
  return rows;
}

// --- transcript blocks ---------------------------------------------------------------------

export function userRows(text: string, cols: number, command = false): Row[] {
  const shown = text.length > 10000 ? `${text.slice(0, 2500)}\n…\n${text.slice(-2500)}` : text;
  const body = [S(shown, { fg: command ? C.inactive : C.text })];
  return wrap(body, cols - 1, [dim(`❯${NBSP}`)], [S("  ")]).map((r) => ({
    ...r,
    rowBg: C.userBg,
    spans: padTo(r.spans, cols),
  }));
}

export function assistantRows(text: string, cols: number): Row[] {
  return markdownRows(text, cols, [S("⏺ ", { fg: C.text })], [S("  ")]);
}

const MAX_TITLE_ROWS = 3;

export type ToolState = "running" | "done";

function dotSpan(state: ToolState, ev: ToolEvent): Span {
  if (state === "running") return dim("⏺ ", { blink: true });
  if (!ev.result?.isError) return S("⏺ ", { fg: C.success });
  return isRejection(ev.result.text.replace(/<\/?tool_use_error>/g, "").trim()) ? dim("⏺ ") : S("⏺ ", { fg: C.error });
}

export function toolRows(ev: ToolEvent, cols: number, cwd: string | null, state: ToolState): Row[] {
  const titled = toolTitle(ev, cwd);
  if (!titled) return [];
  const [name, arg] = titled;
  const spans = [bold(name)];
  if (arg != null && arg !== "") spans.push(S(`(${arg})`));
  const rows = wrap(spans, cols, [dotSpan(state, ev)], [S("  ")]);
  if (rows.length > MAX_TITLE_ROWS) {
    rows.length = MAX_TITLE_ROWS;
    rows[MAX_TITLE_ROWS - 1]!.spans.push(S("…"));
  }
  if (state === "running") {
    if (ev.name === "Bash") rows.push(...result([dim("Running…")], cols));
    return rows;
  }
  return rows.concat(resultRows(ev, cols, cwd));
}

export const commandOutputRows = (text: string, cols: number): Row[] => outputRows(text, cols - 5, 8, { fg: C.inactive });

export const interruptedRows = (cols: number): Row[] => result([dim("Interrupted · What should Claude do instead?")], cols);

export const compactedRows = (cols: number): Row[] => wrap([dim("✻ Conversation compacted (ctrl+o for history)")], cols);

// --- collapsed read/search groups ------------------------------------------------------------

// Shell commands that count as searching, reading or listing: every segment of the pipeline
// must be one of these programs.
const SHELL_KINDS: Record<string, "search" | "read" | "list"> = {
  grep: "search", rg: "search", ag: "search", find: "search", fd: "search",
  cat: "read", head: "read", tail: "read", wc: "read", less: "read",
  ls: "list", tree: "list",
};

function shellKind(ev: ToolEvent): "search" | "read" | "list" | null {
  if (ev.name !== "Bash") return null;
  const command = String((ev.input as Data).command ?? "").trim();
  if (!command || /[<>`$]|\n/.test(command)) return null;
  const kinds = command.split(/\|\||&&|;|\|/).map((seg) => SHELL_KINDS[seg.trim().split(/\s+/)[0] ?? ""]);
  if (kinds.some((k) => !k)) return null;
  return kinds.find((k) => k !== "read" || kinds.every((x) => x === "read")) ?? null;
}

/** Tools that fold into one summary line in Claude Code's normal view. */
export function isCollapsible(ev: ToolEvent): boolean {
  return ev.name === "Read" || ev.name === "Grep" || ev.name === "Glob" || ev.name.startsWith("mcp__") || shellKind(ev) != null;
}

/** Tools pulled into a group without adding to its summary. */
export const isAbsorbed = (ev: ToolEvent) => /^(TodoWrite|TaskCreate|TaskGet|TaskUpdate|TaskList)$/.test(ev.name);

export interface Group {
  tools: ToolEvent[];
  thoughtMs: number;
}

function groupParts(g: Group, running: boolean): Span[][] {
  const count = (pred: (e: ToolEvent) => boolean) => g.tools.filter(pred).length;
  const parts: Span[][] = [];
  if (g.thoughtMs > 0) {
    parts.push([S(running ? "Thinking" : "Thought"), S(" for "), bold(formatElapsed(Math.max(1000, g.thoughtMs) / 1000))]);
  }
  const searches = count((e) => e.name === "Grep" || e.name === "Glob" || shellKind(e) === "search");
  if (searches) parts.push([S(running ? "searching for " : "searched for "), bold(String(searches)), S(` ${plural(searches, "pattern")}`)]);
  const reads = count((e) => e.name === "Read" || shellKind(e) === "read");
  if (reads) parts.push([S(running ? "reading " : "read "), bold(String(reads)), S(` ${plural(reads, "file")}`)]);
  const listed = count((e) => shellKind(e) === "list");
  if (listed) parts.push([S(running ? "listing " : "listed "), bold(String(listed)), S(` ${plural(listed, "directory", "directories")}`)]);
  const servers = new Map<string, number>();
  for (const e of g.tools) {
    if (!e.name.startsWith("mcp__")) continue;
    const server = e.name.split("__")[1]!;
    servers.set(server, (servers.get(server) ?? 0) + 1);
  }
  for (const [server, n] of servers) {
    parts.push([S(running ? "calling " : "called "), S(server), S(" "), bold(String(n)), S(` ${plural(n, "time")}`)]);
  }
  return parts;
}

export function groupRows(g: Group, cols: number, cwd: string | null, running: boolean): Row[] {
  const parts = groupParts(g, running);
  if (!parts.length) return [];
  const spans: Span[] = [];
  parts.forEach((p, i) => {
    if (i > 0) spans.push(S(", "));
    spans.push(...p);
  });
  const first = spans[0]!;
  spans[0] = { ...first, t: first.t.charAt(0).toUpperCase() + first.t.slice(1) };
  if (running) {
    spans.push(S("…"), S(" "), dim("(ctrl+o to expand)"));
    const latest = [...g.tools].reverse().find((e) => !isAbsorbed(e));
    const hint = latest ? toolTitle(latest, cwd)?.[1] : null;
    return [
      ...wrap(spans, cols, [dim("⏺ ", { blink: true })], [S("  ")]),
      ...(hint ? result([dim(truncate(hint, cols - 6))], cols) : []),
    ];
  }
  spans.push(S(" "), dim("(ctrl+o to expand)"));
  return wrap(spans.map((s) => ({ ...s, fg: C.inactive })), cols, [S("  ")], [S("  ")]);
}

// --- live area under the transcript --------------------------------------------------------

const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];

export type SpinnerMode = "requesting" | "responding" | "tool";

export interface SpinnerState {
  verb: string;
  mode: SpinnerMode;
  elapsedSec: number;
  tokens: number;
  thinking: boolean;
}

/** "999", "1.2k", "12.0k" */
export const formatTokens = (n: number) => (n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`);

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a: string, b: string, k: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

export function spinnerRow(s: SpinnerState, t: number): Row {
  // the glyph eases 0→5→0 every two seconds
  const frame = Math.round(((1 - Math.cos((2 * Math.PI * t) / 2)) / 2) * (GLYPHS.length - 1));
  const message = s.verb.endsWith("…") ? s.verb : `${s.verb}…`;
  const chars = [...message];
  const spans: Span[] = [S(`${GLYPHS[frame]} `, { fg: C.claude })];
  if (s.mode === "tool") {
    const pulse = (Math.sin(t * Math.PI) + 1) / 2;
    spans.push(S(message, { fg: mix(C.claude, C.claudeShimmer, pulse) }));
  } else {
    // a 3-character shimmer band: left→right fast while requesting, right→left slowly after
    const cycle = chars.length + 20;
    const step = s.mode === "requesting" ? Math.floor(t / 0.05) : Math.floor(t / 0.2);
    const pos = s.mode === "requesting" ? (step % cycle) - 10 : cycle - 10 - (step % cycle);
    chars.forEach((ch, i) => spans.push(S(ch, { fg: Math.abs(i - pos) <= 1 ? C.claudeShimmer : C.claude })));
  }
  spans.push(S(" ", { fg: C.claude }));

  const parts: string[] = [];
  if (s.elapsedSec > 16 || s.tokens > 0 || s.thinking) {
    parts.push(formatElapsed(s.elapsedSec));
    if (s.tokens > 0) parts.push(`${s.mode === "requesting" ? "↑" : "↓"} ${formatTokens(s.tokens)} tokens`);
    if (s.thinking) parts.push("thinking");
  }
  if (parts.length) spans.push(dim(`(${parts.join(" · ")})`));
  return { spans };
}

export function inputRows(text: string, cols: number, t: number, meta: SessionMeta, busy: boolean): Row[] {
  const v2 = isV2(meta);
  const inner = v2 ? cols : cols - 4;
  const pointer = v2 ? `❯${NBSP}` : "> ";
  const body = wrap([S(text)], inner, [S(pointer, busy ? { fg: C.inactive } : {})], [S("  ")]);
  const cursorOn = Math.floor(t * 2) % 2 === 0;
  body[body.length - 1]!.spans.push(S(" ", cursorOn ? { bg: C.body, fg: C.bg } : {}));
  const footer: Row = { spans: [dim(busy ? "  esc to interrupt" : "  ? for shortcuts")] };

  if (v2) {
    const rule: Row = { spans: [S("─".repeat(cols), { fg: C.promptBorder })] };
    return [rule, ...body, rule, footer];
  }
  return [
    { spans: [S(`╭${"─".repeat(cols - 2)}╮`, { fg: C.promptBorder })] },
    ...body.map((r) => ({ spans: [S("│ ", { fg: C.promptBorder }), ...padTo(r.spans, inner), S(" │", { fg: C.promptBorder })] })),
    { spans: [S(`╰${"─".repeat(cols - 2)}╯`, { fg: C.promptBorder })] },
    footer,
  ];
}
