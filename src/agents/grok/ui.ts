// Grok Build's full-screen TUI (xai-grok-pager, Apache-2.0) as styled rows, in the default
// GrokNight theme with the grok-night syntax colors.
//
// Conversation rows are built in "entry" coordinates: column 0 is the accent rail, two pad
// columns follow, and content starts at column 3. The scene adds the outer padding.
import os from "node:os";
import path from "node:path";
import { codeSpans, highlighter, langFor, type SyntaxTheme } from "../../core/highlight.js";
import { padTo, spansWidth, strWidth, truncate, wrap } from "../../core/text.js";
import type { Row, SessionEvent, Span, Theme } from "../../core/types.js";
import type { GrokDiff } from "./parse.js";

export type ToolEvent = Extract<SessionEvent, { kind: "tool" }>;
type Data = Record<string, any>; // tool inputs are loosely shaped

export const C = {
  bg: "#141414",
  bgLight: "#242424",
  bgDark: "#1c1c1c",
  text: "#e1e1e1",
  secondary: "#c8c8c8",
  grayDim: "#585858",
  gray: "#6c6c6c",
  grayBright: "#787878",
  faint: "#414141",
  magenta: "#bb9af7",
  blue: "#7aa2f7",
  green: "#9ece6a",
  red: "#f7768e",
  yellow: "#e0af68",
  orange: "#ff9e64",
  teal: "#1abc9c",
  purple: "#9d7cd8",
  code: "#3a95ab",
  link: "#7aa6da",
  delBg: "#420e14",
  addBg: "#063806",
  border: "#505058",
  heroBorder: "#333333",
  caption: "#808080",
};

export const theme: Theme = { bg: C.bg, body: C.text, accent: C.magenta };

// grok-night.tmTheme
const SYNTAX: SyntaxTheme = {
  plain: { fg: "#b2b2b2" },
  keyword: { fg: "#bb9af7" },
  string: { fg: "#9ece6a" },
  comment: { fg: "#51597d", italic: true },
  number: { fg: "#ff9e64" },
  constant: { fg: "#ff9e64" },
  function: { fg: "#7aa2f7" },
  type: { fg: "#0db9d7" },
  builtin: { fg: "#0db9d7" },
  property: { fg: "#73daca" },
  variable: { fg: "#c8c8c8" },
  operator: { fg: "#89ddff" },
  punct: { fg: "#89ddff" },
  tag: { fg: "#f7768e" },
  attr: { fg: "#e0af68" },
};

export const S = (t: string, o: Partial<Span> = {}): Span => ({ t, fg: C.text, ...o });
export const muted = (t: string, o: Partial<Span> = {}): Span => S(t, { fg: C.gray, ...o });
export const dim = (t: string, o: Partial<Span> = {}): Span => S(t, { fg: C.grayDim, ...o });
const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

// --- color and time -----------------------------------------------------------------------

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Grok's blend: round(base*(1-t) + color*t) per channel. */
export function blend(base: string, color: string, t: number): string {
  const a = rgb(base);
  const b = rgb(color);
  return `#${a.map((v, i) => Math.round(v * (1 - t) + b[i]! * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The running pulse on bullets and rails: sin² of a 30 fps tick, shifted per row. */
export const wave = (color: string, t: number, row = 0) =>
  blend(C.bg, color, Math.sin(t * 30 * 0.15 + (row / 32) * 2 * Math.PI) ** 2);

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧";
export const spinner = (t: number) => SPINNER[Math.floor(t * 7.5) % SPINNER.length]!;

/** Grok's duration format: 5.2s, 32s, 2m5s, 1h2m. */
export function duration(sec: number): string {
  if (sec < 10) return `${(Math.floor(sec * 10) / 10).toFixed(1)}s`;
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
}

/** Thinking blocks use one decimal under a minute. */
const thoughtTime = (sec: number) => (sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`);

const clock = (ts: number | null) =>
  ts == null ? "" : new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

/** ~ for home, the last two components in full, earlier ones cut to their first letter. */
export function shortCwd(cwd: string | null): string {
  if (!cwd) return "";
  const home = os.homedir();
  const p = cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = p.split("/");
  return parts
    .map((part, i) => (i === 0 || i >= parts.length - 2 || !part ? part : part.startsWith(".") ? part.slice(0, 2) : part[0]))
    .join("/");
}

const relPath = (p: string, cwd: string | null) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);

// --- entry helpers -------------------------------------------------------------------------

/** Content width of an entry `ew` columns wide: rail + 2 pad on the left, 2 pad on the right. */
export const contentCols = (ew: number) => Math.max(10, ew - 5);
const GUTTER = () => S("   ");

/** Rows of content placed at column 3, optionally under an accent rail. */
const entry = (rows: Row[], rail?: (i: number) => string): Row[] =>
  rows.map((r, i) => ({
    ...r,
    spans: [rail ? S("┃  ", { fg: rail(i) }) : GUTTER(), ...r.spans],
    prefix: (r.prefix ?? 0) + 1,
  }));

/** Put a gray clock time at the right edge of a block's first row. */
function stamp(rows: Row[], ts: number | null, cw: number, bg?: string): Row[] {
  const time = clock(ts);
  if (!time || !rows.length) return rows;
  const first = rows[0]!;
  const label = `  ${time}`;
  const spans = padTo(first.spans, cw - strWidth(label), bg ? { bg } : {});
  return [{ ...first, spans: [...spans, muted(label, bg ? { bg } : {})] }, ...rows.slice(1)];
}

// --- markdown ------------------------------------------------------------------------------

const H_STYLES: Partial<Span>[] = [
  { fg: C.teal, bold: true },
  { fg: C.blue, bold: true },
  { fg: C.purple, bold: true },
  { fg: C.grayBright, bold: true },
  { fg: C.gray, bold: true },
  { fg: "#5a5a5a" },
];

function inline(text: string, base: Partial<Span>): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|~~[^~\n]+~~|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<!\w)_[^_\s][^_\n]*_(?!\w)|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const B = (t: string, o: Partial<Span> = {}) => S(t, { ...base, ...o });
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push(B(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) spans.push(B(tok.slice(2, -2), { bold: true }));
    else if (tok.startsWith("`")) spans.push(B(tok.slice(1, -1), { fg: C.code, bold: true }));
    else if (tok.startsWith("~~")) spans.push(B(tok.slice(2, -2), { strike: true }));
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = tok.slice(tok.indexOf("](") + 2, -1);
      spans.push(B(label, { fg: C.link, underline: true }), B(" (", { fg: C.gray }), B(url, { fg: C.gray }), B(")", { fg: C.gray }));
    } else spans.push(B(tok.slice(1, -1), { italic: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push(B(text.slice(last)));
  return spans;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const tableCells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Box-drawn table with a divider under the header and between every body row. */
function tableRows(lines: string[], width: number, base: Partial<Span>): Row[] {
  const [head, , ...body] = lines.map(tableCells);
  const all = [head!, ...body];
  const n = Math.max(...all.map((r) => r.length));
  const widths = Array.from({ length: n }, (_, i) => Math.max(1, ...all.map((r) => spansWidth(inline(r[i] ?? "", base)))));
  // shrink the widest columns until the grid fits
  while (widths.reduce((a, w) => a + w + 3, 1) > width && Math.max(...widths) > 4) widths[widths.indexOf(Math.max(...widths))]!--;
  const border = (t: string) => S(t, { fg: blend(C.bg, C.gray, 0.5) });
  const line = (l: string, m: string, r: string): Row => ({ spans: [border(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r)] });
  const cells = (r: string[], style: Partial<Span>): Row[] => {
    const wrapped = widths.map((w, i) => wrap(inline(r[i] ?? "", style), w).map((x) => x.spans));
    const h = Math.max(...wrapped.map((c) => c.length));
    return Array.from({ length: h }, (_, k) => ({
      spans: [border("│"), ...widths.flatMap((w, i) => [S(" "), ...padTo(wrapped[i]![k] ?? [], w), S(" "), border("│")])],
    }));
  };
  return [
    line("┌", "┬", "┐"),
    ...cells(head!, { ...base, bold: true }),
    ...body.flatMap((r) => [line("├", "┼", "┤"), ...cells(r, base)]),
    line("└", "┴", "┘"),
  ];
}

/** Grok's pretty markdown: markers removed, code fences hidden behind a dark band. */
export function markdownRows(text: string, cw: number, base: Partial<Span> = { fg: C.secondary }, fade = (s: Span) => s): Row[] {
  const rows: Row[] = [];
  const push = (r: Row[]) => rows.push(...r.map((row) => ({ ...row, spans: row.spans.map(fade) })));
  const src = text.replace(/\t/g, "    ").split("\n");
  let fence: ((line: string) => Span[]) | null = null;
  let fenceLabel = "code";
  // code blocks and tables end with a dim row of copy buttons
  const actions = (label: string, buttons: string[]) =>
    push([{ spans: [dim(`◇ ${label}`), ...buttons.map((b) => dim(`   [${b}]`))] }]);
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const fenceMatch = line.match(/^\s*```\s*([^\s`]*)/);
    if (fenceMatch) {
      if (fence) {
        fence = null;
        actions(fenceLabel, ["Copy"]);
      } else {
        fenceLabel = fenceMatch[1] || "code";
        const lang = langFor(fenceMatch[1]);
        const hl = highlighter(lang);
        fence = lang ? (l) => codeSpans(hl(l), SYNTAX) : (l) => [S(l, { fg: C.secondary })];
        if (rows.length && spansWidth(rows[rows.length - 1]!.spans)) rows.push({ spans: [] });
      }
      continue;
    }
    if (fence) {
      push(wrap(fence(line), cw).map((r) => ({ spans: padTo(r.spans.map((s) => ({ ...s, bg: C.bgDark })), cw, { bg: C.bgDark }) })));
      continue;
    }
    if (isTableRow(line) && i + 1 < src.length && isTableRule(src[i + 1]!)) {
      let j = i;
      while (j < src.length && (isTableRow(src[j]!) || isTableRule(src[j]!))) j++;
      push(tableRows(src.slice(i, j), cw, base));
      actions("table", ["Copy TSV", "Copy CSV", "Copy Markdown"]);
      i = j - 1;
      continue;
    }
    if (!line.trim()) {
      rows.push({ spans: [] });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ordered = line.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    const quote = line.match(/^((?:>\s?)+)(.*)$/);
    if (heading) {
      const style = { ...base, ...H_STYLES[heading[1]!.length - 1] };
      push(wrap(inline(heading[2]!, style), cw));
    } else if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      push([{ spans: [muted("───")] }]);
    } else if (bullet) {
      const task = bullet[2]!.match(/^\[([ xX])\]\s+(.*)$/);
      const lead = [S(bullet[1]!), muted("• ")];
      const box = task ? [S(`[${task[1]}] `, task[1] === " " ? { fg: blend(C.bg, C.secondary, 0.5) } : { fg: C.green })] : [];
      const body = inline(task ? task[2]! : bullet[2]!, base);
      push(wrap([...box, ...body], cw, lead, [S(" ".repeat(bullet[1]!.length + 2))]));
    } else if (ordered) {
      const lead = [S(ordered[1]!), muted(`${ordered[2]} `)];
      push(wrap(inline(ordered[3]!, base), cw, lead, [S(" ".repeat(ordered[1]!.length + ordered[2]!.length + 1))]));
    } else if (quote) {
      const depth = (quote[1]!.match(/>/g) ?? []).length;
      const bar = [S("│ ".repeat(depth), { fg: blend(C.bg, C.gray, 0.5) })];
      push(wrap(inline(quote[2]!, base), cw, bar));
    } else {
      push(wrap(inline(line, base), cw));
    }
  }
  while (rows.length && !rows[rows.length - 1]!.spans.length) rows.pop();
  return rows;
}

// --- conversation blocks -------------------------------------------------------------------

/** The prompt on a light band across the whole entry, with a clock time at the right. */
export function userRows(text: string, ew: number, ts: number | null, vpad: boolean): Row[] {
  const cw = contentCols(ew);
  const band = (spans: Span[]): Row => ({ spans: padTo(spans.map((s) => ({ ...s, bg: C.bgLight })), ew, { bg: C.bgLight }), prefix: 1 });
  const body = (w: number) => wrap([S(text)], w);
  let lines = body(cw - 10);
  // a prompt longer than 3 lines (measured at 60 columns) is folded to its first 3
  if (body(60).length > 3 && lines.length > 3) {
    const last = wrap(lines[2]!.spans, cw - 12)[0]!;
    lines = [...lines.slice(0, 2), { spans: [...last.spans, S(" …")] }];
  }
  const content = stamp(lines, ts, cw, C.bgLight).map((r) => band([GUTTER(), ...r.spans]));
  const pad = vpad ? [band([])] : [];
  return [...pad, ...content, ...pad];
}

export function assistantRows(text: string, ew: number, ts: number | null): Row[] {
  const cw = contentCols(ew);
  // code bands run to the content edge even though text wraps short of the clock
  const rows = markdownRows(text, cw - 10).map((r) =>
    r.spans.some((s) => s.bg === C.bgDark) ? { ...r, spans: padTo(r.spans, cw, { bg: C.bgDark }) } : r);
  return entry(stamp(rows, ts, cw));
}

/** A thought: "◆ Thinking…" with its last lines faded under a rail while it streams, then one row. */
export function thinkingRows(text: string, ew: number, running: boolean, durationMs: number | null, t: number): Row[] {
  if (!running) {
    const time = durationMs != null ? [muted(` for ${thoughtTime(durationMs / 1000)}`)] : [];
    return entry([{ spans: [S("◆ ", { fg: C.gray }), muted("Thought", { bold: true }), ...time] }]);
  }
  const cw = contentCols(ew);
  const fade = (s: Span): Span => ({ ...s, fg: blend(C.bg, s.fg ?? C.text, 0.7) });
  const body = text.trim() ? markdownRows(text, cw, { fg: C.secondary }, fade) : [];
  const tail = body.length > 3 ? [{ spans: [muted("…")] }, ...body.slice(-3)] : body;
  const rows: Row[] = [{ spans: [S("◆ ", { fg: wave(C.grayDim, t) }), muted("Thinking…", { bold: true })] }];
  if (tail.length) rows.push({ spans: [] }, ...tail);
  return entry(rows, (i) => wave(C.grayDim, t, i));
}

// Reads, listings, searches and the commands between them fold into one
// "◈ Explored 2 directories, 16 files, 3 searches, ran 1 command" row.
export type GroupKind = "dir" | "file" | "search" | "command";

export function groupKind(ev: ToolEvent): GroupKind | null {
  switch (ev.name) {
    case "read_file":
    case "read":
      return "file";
    case "list_dir":
    case "ls":
      return "dir";
    case "grep":
    case "search":
    case "glob":
      return "search";
    case "run_terminal_command":
    case "run_terminal_cmd":
    case "bash":
    case "shell":
    case "execute":
      return "command";
    default:
      return null;
  }
}

export interface GroupMember {
  kind: GroupKind;
  /** What it touched: a path for files and directories, the call id otherwise. */
  key: string;
  failed: boolean;
  ev: ToolEvent;
}

export function groupMember(ev: ToolEvent, kind: GroupKind, cwd: string | null): GroupMember {
  const input = ev.input as Data;
  const target = input.target_file ?? input.target_directory ?? input.path ?? input.file_path;
  const key = typeof target === "string" && (kind === "file" || kind === "dir")
    ? (target === cwd ? "." : relPath(target, cwd))
    : ev.id;
  return { kind, key, failed: !!ev.result?.isError, ev };
}

export function groupRows(members: GroupMember[], running: boolean, t: number): Row[] {
  const distinct = (k: GroupKind) => [...new Set(members.filter((m) => m.kind === k).map((m) => m.key))];
  const dirs = distinct("dir");
  const files = distinct("file").length;
  const searches = distinct("search").length;
  const commands = distinct("command").length;
  const parts = [
    ...(dirs.length === 1 ? [dirs[0]!] : dirs.length ? [`${dirs.length} directories`] : []),
    ...(files ? [`${files} ${plural(files, "file")}`] : []),
    ...(searches ? [`${searches} ${searches === 1 ? "search" : "searches"}`] : []),
    ...(commands ? [`ran ${commands} ${plural(commands, "command")}`] : []),
  ];
  const failed = members.filter((m) => m.failed).length;
  const mark = failed ? C.red : running ? wave(C.grayBright, t) : C.gray;
  return entry([{
    spans: [
      S("◈ ", { fg: mark }),
      muted(`${running ? "Exploring" : "Explored"} ${parts.join(", ")}`),
      ...(failed ? [S(` · ${failed} failed`, { fg: C.red })] : []),
    ],
  }]);
}

const flat = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
const commandOf = (ev: ToolEvent) => flat(String((ev.input as Data).command ?? (ev.input as Data).cmd ?? ""));

/** A collapsed tool row: gray text, the bullet carries the state. */
function collapsed(label: string, rest: Span[], ew: number, bullet: string): Row[] {
  const cw = contentCols(ew);
  const spans = [muted(`${label} `, { bold: true }), ...rest];
  const text = truncate(spans.map((s) => s.t).join(""), cw - 2);
  // keep the styled spans when they fit, else fall back to one muted run
  const fitted = strWidth(text) === spansWidth(spans) ? spans : [muted(text)];
  return entry([{ spans: [S("◆ ", { fg: bullet }), ...fitted] }]);
}

const doneBullet = (failed: boolean) => blend(C.bg, failed ? C.red : C.green, 0.5);

/** `◆ Run <command>`, collapsed like Grok shows agent commands. */
export function runRows(ev: ToolEvent, ew: number, running: boolean, t: number): Row[] {
  const desc = String((ev.input as Data).description ?? "").replace(/^Run(ning)?\s+/i, "");
  const bullet = running ? wave(C.magenta, t) : doneBullet(!!ev.result?.isError);
  return collapsed("Run", [muted(desc || commandOf(ev) || "…")], ew, bullet);
}

/** Any other tool: its name, then a short summary. */
export function otherRows(ev: ToolEvent, ew: number, running: boolean, t: number): Row[] {
  const input = ev.input as Data;
  const title = typeof input.title === "string" && input.title !== ev.name ? flat(input.title.replace(/`/g, "")) : "";
  const bullet = running ? wave(C.magenta, t) : ev.result?.isError ? C.red : C.gray;
  return collapsed(ev.name, title ? [muted(` ${title}`)] : [], ew, bullet);
}

// Edits render expanded: numbered lines without +/- markers, changed lines on a red/green band.
interface DiffLine {
  op: " " | "-" | "+";
  text: string;
  old: number;
  new: number;
}

function lineDiff(a: string[], b: string[]): Array<{ op: " " | "-" | "+"; text: string }> {
  if (a.length * b.length > 400_000) return [...a.map((text) => ({ op: "-" as const, text })), ...b.map((text) => ({ op: "+" as const, text }))];
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const out: Array<{ op: " " | "-" | "+"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: " ", text: a[i]! });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) out.push({ op: "+", text: b[j++]! });
    else out.push({ op: "-", text: a[i++]! });
  }
  return out;
}

/** Hunks of changed lines with up to 3 lines of context, and the unchanged gaps between them. */
function hunks(d: GrokDiff): Array<DiffLine[] | number> {
  const split = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));
  let o = d.line ?? 1;
  let n = d.line ?? 1;
  const lines = lineDiff(split(d.oldText), split(d.newText)).map((l) => {
    const line = { ...l, old: o, new: n };
    if (l.op !== "+") o++;
    if (l.op !== "-") n++;
    return line;
  });
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.op !== " ") for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 3); k++) keep[k] = true;
  });
  const out: Array<DiffLine[] | number> = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      gap++;
      return;
    }
    if (gap && out.length) out.push(gap);
    gap = 0;
    const last = out[out.length - 1];
    if (Array.isArray(last) && keep[i - 1]) last.push(l);
    else out.push([l]);
  });
  return out;
}

export function editRows(ev: ToolEvent, ew: number, cwd: string | null): Row[] {
  const cw = contentCols(ew);
  const input = ev.input as Data;
  const diffs: GrokDiff[] = Array.isArray(input.diffs) ? input.diffs : [];
  const file = String(diffs[0]?.path || input.path || input.file_path || (input.locations as string[] | undefined)?.[0] || "");
  const verb = ev.name === "write" ? "Creating" : "Edit";
  const failed = !!ev.result?.isError;
  const rows: Row[] = [{ spans: [S("◆ ", { fg: failed ? C.red : C.grayBright }), S(`${verb} `, { bold: true }), S(relPath(file, cwd), { fg: C.orange })] }];
  if (failed && ev.result?.text) rows.push({ spans: [] }, ...wrap([muted(ev.result.text)], cw));
  const lang = langFor(path.extname(file).slice(1));
  for (const d of diffs) {
    const hs = hunks(d);
    if (!hs.length) continue;
    rows.push({ spans: [] });
    const hlOld = highlighter(lang);
    const hlNew = highlighter(lang);
    for (const h of hs) {
      if (typeof h === "number") {
        rows.push({ spans: [muted(`  … ${h} unchanged ${plural(h, "line")}`)] });
        continue;
      }
      const w = String(Math.max(...h.map((l) => (l.op === "-" ? l.old : l.new)))).length;
      for (const l of h) {
        const bg = l.op === "-" ? C.delBg : l.op === "+" ? C.addBg : undefined;
        const num = l.op === "-" ? l.old : l.new;
        const numFg = l.op === "-" ? C.red : l.op === "+" ? C.green : C.gray;
        const code = codeSpans((l.op === "-" ? hlOld : l.op === "+" ? hlNew : (s: string) => (hlOld(s), hlNew(s)))(l.text), SYNTAX);
        const gutter = [S(`  ${String(num).padStart(w)}  `, { fg: numFg })];
        const body = bg ? code.map((s) => ({ ...s, bg })) : code;
        for (const r of wrap(body.length ? body : [S(" ", { bg })], cw, gutter, [S(" ".repeat(w + 4))])) {
          rows.push(bg ? { ...r, spans: padTo(r.spans, cw, { bg }) } : r);
        }
      }
    }
  }
  return entry(rows);
}

/** A system line, such as a failed hook: a gray bullet and muted text. */
export function noticeRows(text: string, ew: number): Row[] {
  return entry(wrap([muted(text)], contentCols(ew), [S("◆ ", { fg: C.gray })], [S("  ")]));
}

export function turnEndRows(sec: number | null, ew: number): Row[] {
  return entry(wrap([muted(sec != null ? `Worked for ${duration(sec)}` : "Turn completed.")], contentCols(ew)));
}

export function cancelledRows(sec: number | null, ew: number): Row[] {
  return entry(wrap([muted(sec != null ? `Turn cancelled by user in ${duration(sec)}.` : "Turn cancelled by user.")], contentCols(ew)));
}

// --- chrome --------------------------------------------------------------------------------

/** The top bar of the conversation view: branch and path left, extras right. */
/** Grok's token counts: 512, 1.2K, 56K, 1.2M. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

// context usage shifts from white through gray and yellow to red as the window fills
const CONTEXT_STOPS: Array<[number, string]> = [[0, C.text], [0.5, C.secondary], [0.65, C.secondary], [0.75, C.yellow], [0.85, C.yellow], [0.95, C.red]];
function contextColor(used: number): string {
  const i = CONTEXT_STOPS.findIndex(([p]) => p > used);
  if (i < 0) return C.red;
  if (i === 0) return C.text;
  const [p0, c0] = CONTEXT_STOPS[i - 1]!;
  const [p1, c1] = CONTEXT_STOPS[i]!;
  return blend(c0, c1, (used - p0) / (p1 - p0));
}

/** The top bar of the conversation view: branch and path left; context use and the dashboard right. */
export function statusBar(branch: string | null, cwd: string | null, width: number, context: { used: number; total: number } | null): Span[] {
  const right: Span[] = [];
  if (context) right.push(S(`${fmtTokens(context.used)} / ${fmtTokens(context.total)}`, { fg: contextColor(context.used / context.total) }), S(" │ ", { fg: C.faint }));
  right.push(muted("[Dashboard]"));
  const room = width - spansWidth(right) - 1;
  const left = [...(branch ? [dim(`${branch} `)] : []), S(shortCwd(cwd), { fg: C.secondary })];
  const fitted = spansWidth(left) <= room ? left : [S(truncate(left.map((x) => x.t).join(""), Math.max(1, room)), { fg: C.secondary })];
  return [...padTo(fitted, width - spansWidth(right)), ...right];
}

export interface ComposerOpts {
  width: number;
  text: string;
  /** Typed so far is still being entered: draw the cursor after it. */
  cursor: boolean;
  model: string;
  flags: string[];
  maxRows: number;
}

/** The rounded composer box: ❯ prompt, with the model and flags on the bottom border. */
export function composerRows(o: ComposerOpts): Row[] {
  const { width: W } = o;
  const border = (t: string) => S(t, { fg: C.border });
  const inner = W - 4;
  const lines = o.text ? wrap([S(o.text)], inner - 2).map((r) => r.spans) : [[]];
  const shown = lines.slice(-Math.max(1, o.maxRows - 2));
  const cursor = S(" ", { bg: C.secondary });
  const body = shown.map((spans, i): Row => {
    const lead = i === 0 && shown.length === lines.length ? S("❯ ", { fg: C.secondary }) : S("  ");
    const last = i === shown.length - 1;
    const content = [lead, ...spans, ...(last && o.cursor ? [cursor] : [])];
    return { spans: [border("│ "), ...padTo(content, inner), border(" │")] };
  });
  const top: Row = { spans: [border(`╭${"─".repeat(W - 2)}╮`)] };
  const info: Span[] = [S(" "), S(o.model, { fg: C.caption })];
  for (const f of o.flags) info.push(dim(" · "), muted(f));
  info.push(S(" "));
  const infoW = spansWidth(info) <= W - 4 ? spansWidth(info) : 0;
  const bottom: Row = { spans: [border("╰"), border("─".repeat(W - 3 - infoW)), ...(infoW ? info : []), border("─╯")] };
  return [top, ...body, bottom];
}

/** `keys:label` hints joined by a dimmed bar. */
export function shortcutsBar(hints: Array<[keys: string, label: string]>): Span[] {
  return hints.flatMap(([k, l], i) => [
    ...(i ? [S("  │  ", { fg: blend(C.bg, C.gray, 0.5) })] : []),
    S(k, { fg: C.secondary, bold: true }),
    muted(`:${l}`),
  ]);
}

export interface TurnStatus {
  label: Span[];
  phaseSec: number;
  turnSec: number;
}

/** "⠹ Thinking… 3.4s" on the left, "12s [stop]" on the right. */
export function turnStatusRow(s: TurnStatus, width: number, t: number): Span[] {
  const color = s.label[0]?.fg ?? C.secondary;
  const left = [S(`${spinner(t)} `, { fg: color }), ...s.label, ...(width >= 60 ? [muted(` ${duration(s.phaseSec)}`)] : [])];
  const right = muted(`${duration(s.turnSec)} [stop]`);
  const room = width - strWidth(right.t) - 1;
  const fitted = spansWidth(left) <= room ? left : [S(truncate(left.map((x) => x.t).join(""), room), { fg: color })];
  return [...padTo(fitted, width - strWidth(right.t)), right];
}

export const thinkingLabel = (): Span[] => [S("Thinking…", { fg: C.secondary })];
export const respondingLabel = (): Span[] => [S("Responding…", { fg: C.secondary })];
export const runLabel = (cmd: string): Span[] => [muted("Run "), S(flat(cmd), { fg: C.green })];

// --- welcome screen ------------------------------------------------------------------------

export const LOGO_FULL = [
  "⠀⠀⠀⠀⠀⠀⣀⣀⡀⠀⠀⠀⢀⠄",
  "⠀⠀⠀⣠⣾⠿⠛⠛⠛⠛⢀⡴⠁⠀",
  "⠀⠀⣼⡟⠁⠀⠀⠀⢀⡴⠻⣿⡀⠀",
  "⠀⠀⣿⡇⠀⠀⠀⠔⠁⠀⠀⣿⡇⠀",
  "⠀⠀⢹⣷⠀⠀⠀⠀⠀⢀⣴⡿⠀⠀",
  "⠀⢀⠞⠁⠠⢶⣶⣶⣶⠿⠋⠀⠀⠀",
  "⠐⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];

export const LOGO_COMPACT = [
  "⠀⠀⠀⣀⣤⣤⣀⠀⠀⡠",
  "⠀⢀⡾⠋⠁⠀⢁⢴⡎⠀",
  "⠀⢸⡇⠀⠀⠐⠁⢀⣿⠀",
  "⠀⢈⠗⢀⣀⣀⣠⡾⠃⠀",
  "⠐⠁⠀⠈⠉⠉⠉⠀⠀⠀",
];

/** One logo row with the diagonal shimmer that sweeps the mark every 4 seconds. */
export function logoRow(logo: string[], row: number, t: number): Span[] {
  const rows = logo.length;
  const cols = Math.max(...logo.map((l) => [...l].length));
  const p = (t % 4) / 4;
  const band = -0.38 + Math.min(p / 0.32, 1) * 1.76;
  const pulse = 0.06 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 5));
  return [...logo[row]!].map((ch, col) => {
    const d = Math.abs((col + (rows - 1 - row)) / (cols + rows) - band);
    const shine = d < 0.38 ? 0.5 * (1 + Math.cos((Math.PI * d) / 0.38)) : 0;
    return S(ch, { fg: blend(C.gray, C.text, Math.min(1, Math.max(0, pulse + 0.33 * shine))) });
  });
}

export const MENU: Array<[label: string, key: string]> = [
  ["New worktree", "ctrl+w"],
  ["Resume session", "ctrl+r"],
  ["Changelog", ""],
  ["Quit", "ctrl+q"],
];

export const menuRow = (label: string, key: string, width: number): Span[] =>
  padTo([S(label, { bold: true })], width - strWidth(key)).concat(key ? [S(key, { fg: C.grayBright })] : []);

/** Model display name: the models cache's name, else "grok-4.7" → "Grok 4.7". */
export function modelName(id: string | null, names: Record<string, string>): string {
  if (!id) return "Grok";
  return names[id] ?? id.replace(/^grok/i, "Grok").replace(/-/g, " ").replace(/\b(\w)/g, (c) => c.toUpperCase());
}

/** Grok names the terminal tab "<session title> - grok". */
export function title(meta: { title?: string | null }): string {
  return meta.title ? `${meta.title} - grok` : "grok";
}
