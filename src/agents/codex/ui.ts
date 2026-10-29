// Codex's terminal UI (codex-rs/tui) as styled rows, on a dark terminal with the default
// catppuccin-mocha syntax theme.
import path from "node:path";
import { codeSpans, highlighter, highlightLines, langFor, type SyntaxTheme } from "../../core/highlight.js";
import { padTo, spansWidth, strWidth, truncate, wrap } from "../../core/text.js";
import type { Row, SessionEvent, SessionMeta, Span, Theme } from "../../core/types.js";
import type { ExecData, FileChange } from "./parse.js";

export type ToolEvent = Extract<SessionEvent, { kind: "tool" }>;
type Data = Record<string, any>; // tool inputs and results are loosely shaped

export const C = {
  bg: "#282c34",
  fg: "#ffffff",
  dim: "#949699",
  secondary: "#a9aaad",
  accent: "#63a7f7",
  yellow: "#f6e2b7",
  dirGreen: "#aadca6",
  rosewater: "#f5e0dc",
  yellowHeading: "#f9e2af",
  green: "#4ec970",
  red: "#f14c4c",
  magenta: "#c678dd",
  lightBlue: "#6cb6ff",
  userBg: "#4b4d54",
  composerBg: "#41454c",
  rule: "#41454c",
  addBg: "#213a2b",
  delBg: "#4a221d",
  // catppuccin-mocha
  text: "#cdd6f4",
  pink: "#f38ba8",
  blue: "#89b4fa",
  mdGreen: "#a6e3a1",
  teal: "#94e2d5",
  quote: "#f5c2e7",
};

export const theme: Theme = { bg: C.bg, body: C.fg, accent: C.accent };

// catppuccin-mocha, Codex's default syntax theme
const SYNTAX: SyntaxTheme = {
  plain: { fg: "#cdd6f4" },
  keyword: { fg: "#cba6f7" },
  string: { fg: "#a6e3a1" },
  comment: { fg: "#9399b2", italic: true },
  number: { fg: "#fab387" },
  constant: { fg: "#fab387" },
  function: { fg: "#89b4fa" },
  type: { fg: "#f9e2af" },
  builtin: { fg: "#f38ba8" },
  property: { fg: "#89b4fa" },
  variable: { fg: "#f5e0dc" },
  operator: { fg: "#89dceb" },
  punct: { fg: "#9399b2" },
  tag: { fg: "#89b4fa" },
  attr: { fg: "#f9e2af" },
};

const S = (t: string, o: Partial<Span> = {}): Span => ({ t, fg: C.fg, ...o });
const dim = (t: string, o: Partial<Span> = {}): Span => S(t, { fg: C.dim, ...o });
const bold = (t: string, o: Partial<Span> = {}): Span => S(t, { bold: true, ...o });
const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");

// the terminal title Codex sets: "<thread name> | <folder>"
export const title = (meta: SessionMeta) =>
  meta.title ? `${meta.title} | ${path.basename(meta.cwd ?? "")}` : `codex — ${tildify(meta.cwd ?? "")}`;

function rel(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(`${cwd}/`)) return path.relative(cwd, p);
  return tildify(p);
}

// Detail rows under a cell header: "  └ " first, "    " after.
const D1 = (): Span[] => [dim("  └ ")];
const DN = (): Span[] => [S("    ")];

// --- header --------------------------------------------------------------------------------

export function headerRows(meta: SessionMeta, cols: number): Row[] {
  const dir = tildify(meta.cwd ?? "~");
  const keep = cols - 5;
  const shown = strWidth(dir) > keep ? `${dir.slice(0, Math.ceil(keep / 2) - 1)}…${dir.slice(dir.length - Math.floor(keep / 2))}` : dir;
  return [
    { spans: [] },
    { spans: [S("  "), S(">_ ", { fg: C.accent }), bold("OpenAI Codex"), dim(meta.version ? ` (v${meta.version})` : "")] },
    { spans: [S("     "), dim(shown)] },
  ];
}

/** "gpt-6-luna" → "GPT-6-Luna", as the model picker shows it. */
export function modelLabel(slug: string): string {
  return slug.split("-").map((w) => (w === "gpt" ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1))).join("-");
}

// --- markdown ------------------------------------------------------------------------------

/** Local file links show their target relative to the session cwd, in code color. */
const isLocalLink = (url: string) => url.startsWith("file://") || !/^[a-z][a-z\d+.-]*:/i.test(url);
function localLinkTarget(url: string, cwd: string | null): string {
  const p = decodeURI(url.replace(/^file:\/\//, ""));
  return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
}

function inline(text: string, base: Partial<Span> = {}, cwd: string | null = null): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|~~[^~\n]+~~|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<!\w)_[^_\s][^_\n]*_(?!\w)|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push(S(text.slice(last, m.index), base));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) spans.push(S(tok.slice(2, -2), { ...base, bold: true, fg: C.pink }));
    else if (tok.startsWith("`")) spans.push(S(tok.slice(1, -1), { ...base, fg: C.mdGreen }));
    else if (tok.startsWith("~~")) spans.push(S(tok.slice(2, -2), { ...base, strike: true }));
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = tok.slice(tok.indexOf("](") + 2, -1);
      const target = isLocalLink(url)
        ? S(localLinkTarget(url, cwd), { ...base, fg: C.mdGreen })
        : S(url, { ...base, fg: C.accent, underline: true });
      spans.push(...(label.trim() ? [S(label, base), S(" (", base), target, S(")", base)] : [target]));
    } else spans.push(S(tok.slice(1, -1), { ...base, italic: true, fg: C.pink }));
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push(S(text.slice(last), base));
  return spans;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const tableCells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function tableRows(lines: string[], width: number): Row[] {
  const [head, , ...body] = lines.map(tableCells);
  const rows = [head!, ...body];
  const n = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: n }, (_, i) => Math.max(...rows.map((r) => spansWidth(inline(r[i] ?? "")))));
  if (widths.reduce((a, w) => a + w + 2, 1) > width) {
    // too narrow for a grid: one "Header: value" line per cell
    return body.flatMap((r, ri) => [
      ...(ri > 0 ? [{ spans: [] }] : []),
      ...r.flatMap((c, i) => wrap([bold(`${head![i] ?? ""}: `), ...inline(c)], width)),
    ]);
  }
  const cells = (r: string[], style: Partial<Span>): Row => ({
    spans: [S(" "), ...widths.flatMap((w, i) => padTo(inline(r[i] ?? "", style), w + (i < n - 1 ? 2 : 0)))],
  });
  return [
    cells(head!, { bold: true }),
    { spans: [S(" "), S(widths.map((w) => "━".repeat(w)).join("  "), { fg: C.rule })] },
    ...body.map((r) => cells(r, {})),
  ];
}

function markdownRows(text: string, cols: number, first: Span[], rest: Span[], cwd: string | null): Row[] {
  const md = (t: string, b: Partial<Span> = {}) => inline(t, b, cwd);
  const rows: Row[] = [];
  // a list item that took more than one row is followed by a blank line before its sibling
  let afterMultilineItem = false;
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
    const fenceMatch = line.match(/^\s*```\s*([^\s`]*)/);
    if (fenceMatch) {
      const lang = langFor(fenceMatch[1]);
      const hl = highlighter(lang);
      fence = fence ? null : lang ? (l) => codeSpans(hl(l), SYNTAX) : (l) => [S(l, { fg: C.text })];
      continue;
    }
    if (fence) {
      emit(wrap(fence(line), cols, gutter, rest));
      continue;
    }
    if (isTableRow(line) && i + 1 < src.length && isTableRule(src[i + 1]!)) {
      let j = i;
      while (j < src.length && (isTableRow(src[j]!) || isTableRule(src[j]!))) j++;
      emit(tableRows(src.slice(i, j), cols - spansWidth(gutter)).map((r, k) => ({ ...r, spans: [...(k === 0 ? gutter : rest), ...r.spans], prefix: 1 })));
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
    const item = (r: Row[]) => {
      if (afterMultilineItem) rows.push({ spans: [...rest], prefix: rest.length });
      emit(r);
      afterMultilineItem = r.length > 1;
    };
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) afterMultilineItem = false;
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const style: Partial<Span> = level <= 3
        ? { fg: C.yellowHeading, bold: true, underline: level === 1, italic: level === 3 }
        : { fg: C.yellowHeading, italic: true };
      emit(wrap([S(`${heading[1]} `, style), ...md(heading[2]!, style)], cols, gutter, rest));
    } else if (bullet) {
      const indent = "    ".repeat(Math.floor(bullet[1]!.length / 2));
      const task = bullet[2]!.match(/^\[([ xX])\]\s+(.*)$/);
      const marker = task ? (task[1] === " " ? "☐ " : "☑ ") : "• ";
      item(wrap([S(indent), S(marker, { fg: C.teal }), ...md(task ? task[2]! : bullet[2]!)], cols, gutter, [...rest, S(" ".repeat(indent.length + 2))]));
    } else if (ordered) {
      const depth = Math.floor(ordered[1]!.length / 2);
      const indent = "    ".repeat(depth);
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? Number(ordered[2]) - 1) + 1;
      const lead = `${counters[depth]}. `;
      item(wrap([S(indent), S(lead, { fg: C.lightBlue }), ...md(ordered[3]!)], cols, gutter, [...rest, S(" ".repeat(indent.length + lead.length))]));
    } else if (/^>\s?/.test(line)) {
      emit(wrap([S("> ", { fg: C.quote }), ...md(line.replace(/^>\s?/, ""), { fg: C.quote })], cols, gutter, rest));
    } else if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      emit(wrap([S("———")], cols, gutter, rest));
    } else {
      emit(wrap(md(line), cols, gutter, rest));
    }
  }
  return rows;
}

// --- transcript cells ----------------------------------------------------------------------

export function userRows(text: string, cols: number): Row[] {
  const painted = (spans: Span[]): Row => ({ spans, rowBg: C.userBg });
  return [
    painted([]),
    ...wrap([S(text)], cols - 1, [bold("› ", { fg: C.dim })], [S("  ")]).map((r) => painted(r.spans)),
    painted([]),
  ];
}

export function assistantRows(text: string, cols: number, cwd: string | null = null): Row[] {
  return markdownRows(text, cols, [dim("• ")], [S("  ")], cwd);
}

const MORE_HINT = (n: number) => dim(`+${n} ${plural(n, "line")} (⌃t to view transcript)`);

/** Up to `max` rows of output under "  └ ", dimmed, then "+N lines". */
// Codex's tool output preview: the first `max` wrapped rows, then "+N lines". Lines split like
// Rust's str::lines (no trailing empty line); leading blank lines are kept.
function outputRows(text: string, cols: number, max: number, style: Partial<Span> = {}): Row[] {
  const ls = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const rows: Row[] = [];
  let consumed = 0;
  let omitted = 0;
  for (const l of ls.slice(0, max)) {
    consumed++;
    const remaining = max - rows.length;
    if (remaining <= 0) {
      omitted++;
      continue;
    }
    const wrapped = wrap([dim(l, style)], cols, rows.length === 0 ? D1() : DN(), DN());
    rows.push(...wrapped.slice(0, remaining));
    if (wrapped.length > remaining) {
      omitted++;
      break;
    }
  }
  omitted += ls.length - consumed;
  if (omitted > 0) rows.push({ spans: [...DN(), MORE_HINT(omitted)] });
  return rows;
}

function bullet(state: "running" | "ok" | "error"): Span {
  if (state === "running") return dim("• ", { blink: true });
  return bold("• ", { fg: state === "ok" ? C.green : C.red });
}

const execData = (ev: ToolEvent) => (ev.result?.data ?? {}) as Partial<ExecData>;

export function execRows(ev: ToolEvent, cols: number, running: boolean): Row[] {
  const d = execData(ev);
  const command = String(d.command ?? ev.input.command ?? "");
  const failed = !running && (ev.result?.isError ?? false);
  const head = [bullet(running ? "running" : failed ? "error" : "ok"), bold(running ? "Running" : "Ran"), S(" ")];
  const cmdLines = highlightLines(command, "bash", SYNTAX);
  // the header holds the first wrapped segment; everything after it shares a 2-row budget
  const [header, ...wrappedRest] = wrap([...head.slice(1), ...cmdLines[0]!], cols, [head[0]!], [dim("  │ ")]);
  const continuation = [...wrappedRest, ...cmdLines.slice(1).flatMap((l) => wrap(l, cols, [dim("  │ ")]))];
  const rows = [header!, ...continuation.slice(0, 2)];
  if (continuation.length > 2) rows.push({ spans: [dim("  │ "), dim(`… +${continuation.length - 2} ${plural(continuation.length - 2, "line")}`)] });
  if (running) return rows;
  const out = String(d.output ?? "");
  rows.push(...(out ? outputRows(out, cols, 3) : [{ spans: [...D1(), dim("(no output)")] }]));
  return rows;
}

// --- exploring (read / search / list) ------------------------------------------------------

export type ExploreKind = "read" | "search" | "list";
export interface ExploreStep {
  kind: ExploreKind;
  label: string;
  query?: string;
  where?: string;
  /** Nonzero exit code of the command, on its last step. */
  exit?: number;
  /** The command had several parsed steps (reported as "command exit"). */
  compound?: boolean;
}

const SHELL_KINDS: Record<string, ExploreKind> = {
  cat: "read", bat: "read", less: "read", head: "read", tail: "read", nl: "read",
  rg: "search", rga: "search", grep: "search", egrep: "search", fgrep: "search", ag: "search", ack: "search",
  ls: "list", eza: "list", exa: "list", tree: "list", du: "list",
};

/** Read/search/list steps of a command, or null when it isn't pure exploration. */
export function exploreSteps(ev: ToolEvent, cwd: string | null): ExploreStep[] | null {
  if (ev.name !== "exec_command") return null;
  const d = execData(ev);
  const command = String(d.command ?? ev.input.command ?? "");
  const parsed = d.parsed ?? [];
  if (parsed.length) {
    const steps: ExploreStep[] = [];
    for (const p of parsed) {
      if (p.type === "read") steps.push({ kind: "read", label: p.name ?? path.basename(p.path ?? p.cmd ?? "") });
      else if (p.type === "list_files") steps.push({ kind: "list", label: p.path ? rel(p.path, cwd) : p.cmd ?? command });
      else if (p.type === "search") {
        steps.push({ kind: "search", label: p.cmd ?? command, query: p.query ?? undefined, where: p.path ? rel(p.path, cwd) : undefined });
      } else return null;
    }
    const code = d.exitCode;
    if (code != null && code !== 0 && steps.length) Object.assign(steps[steps.length - 1]!, { exit: code, compound: steps.length > 1 });
    return steps;
  }
  // older logs without parsed commands: a conservative guess from the program names
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  const steps: ExploreStep[] = [];
  for (const seg of segments) {
    const words = seg.trim().split(/\s+/);
    const prog = words[0] ?? "";
    const kind = prog === "sed" && words[1] === "-n" ? "read" : SHELL_KINDS[prog];
    if (!kind) {
      if (/^(wc|sort|uniq|head|tail|cut)$/.test(prog) && steps.length) continue;
      return null;
    }
    const args = words.slice(1).filter((w) => !w.startsWith("-"));
    if (kind === "read") steps.push({ kind, label: path.basename(args[args.length - 1] ?? seg) });
    else if (kind === "list") steps.push({ kind, label: args[0] ?? seg });
    else steps.push({ kind, label: seg, query: args[0]?.replace(/^["']|["']$/g, ""), where: args[1] });
  }
  return steps.length ? steps : null;
}

export function exploreRows(steps: ExploreStep[], cols: number, running: boolean): Row[] {
  // consecutive successful reads collapse into one "Read a, b" line
  const lines: Array<{ title: string; spans: Span[]; reads?: string[] }> = [];
  for (const s of steps) {
    const last = lines[lines.length - 1];
    const status: Span[] = s.exit != null
      ? [S(` (${s.compound ? "command exit" : "exit"} ${s.exit})`, { fg: s.exit === 1 && s.kind === "search" ? C.dim : C.red })]
      : [];
    if (s.kind === "read" && s.exit == null) {
      if (last?.reads) {
        if (!last.reads.includes(s.label)) last.reads.push(s.label);
      } else lines.push({ title: "Read", spans: [], reads: [s.label] });
    } else if (s.kind === "read") {
      lines.push({ title: "Read", spans: [S(s.label), ...status] });
    } else if (s.kind === "list") {
      lines.push({ title: "List", spans: [S(s.label), ...status] });
    } else {
      const where = s.query && s.where ? [dim(" in "), S(s.where)] : [];
      lines.push({ title: "Search", spans: [S(s.query ?? s.label), ...where, ...status] });
    }
  }
  const rows: Row[] = [{ spans: [running ? dim("• ", { blink: true }) : dim("• "), bold(running ? "Exploring" : "Explored")] }];
  lines.forEach((l, i) => {
    const body = l.reads ? l.reads.flatMap((r, k) => (k ? [dim(", "), S(r)] : [S(r)])) : l.spans;
    const indent = " ".repeat(l.title.length + 1);
    rows.push(...wrap([S(l.title, { fg: C.accent }), S(" "), ...body], cols, i === 0 ? D1() : DN(), [...DN(), S(indent)]));
  });
  return rows;
}

// --- patches -------------------------------------------------------------------------------

function diffStats(diff: string): [number, number] {
  let add = 0;
  let del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return [add, del];
}

const stats = (add: number, del: number): Span[] => [S(" ("), S(`+${add}`, { fg: C.green }), S(" "), S(`-${del}`, { fg: C.red }), S(")")];

function diffBody(diff: string, cols: number, indent: string, file: string): Row[] {
  type Line = { no: number | null; sign: " " | "+" | "-"; text: string } | { gap: true };
  const out: Line[] = [];
  let o = 1;
  let n = 1;
  let seenHunk = false;
  for (const l of diff.replace(/\n$/, "").split("\n")) {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h || l.startsWith("@@")) {
      if (seenHunk) out.push({ gap: true });
      seenHunk = true;
      if (h) {
        o = Number(h[1]);
        n = Number(h[2]);
      }
      continue;
    }
    if (l.startsWith("---") || l.startsWith("+++")) continue;
    const sign = l[0] === "+" || l[0] === "-" ? l[0] : " ";
    const text = l[0] === "+" || l[0] === "-" || l[0] === " " ? l.slice(1) : l;
    out.push({ no: sign === "-" ? o++ : sign === "+" ? n++ : (o++, n++), sign, text });
  }
  const gw = String(Math.max(1, ...out.map((x) => ("no" in x && x.no) || 0))).length;
  const width = cols - indent.length;
  const rows: Row[] = [];
  const hl = highlighter(langFor(file));
  for (const x of out) {
    if ("gap" in x) {
      rows.push({ spans: [S(indent), dim(`${" ".repeat(gw)}⋮`)] });
      continue;
    }
    const bg = x.sign === "+" ? C.addBg : x.sign === "-" ? C.delBg : undefined;
    const fg = x.sign === "+" ? C.green : x.sign === "-" ? C.red : C.fg;
    const head = [dim(`${String(x.no).padStart(gw)} `, { bg }), S(x.sign, { fg, bg })];
    for (const row of wrap(codeSpans(hl(x.text), SYNTAX, { bg }), width, head, [S(" ".repeat(gw + 2), { bg })])) {
      rows.push({ spans: [S(indent), ...(bg ? padTo(row.spans, width, { bg }) : row.spans)] });
    }
  }
  return rows;
}

export function patchRows(ev: ToolEvent, cols: number, cwd: string | null, running: boolean): Row[] {
  const d = (ev.result?.data ?? {}) as Data;
  const changes: FileChange[] = d.changes ?? (ev.input as Data).changes ?? [];
  if (!running && ev.result?.isError) {
    return [
      { spans: [bold("✘ Failed to apply patch", { fg: C.magenta })] },
      ...outputRows(ev.result.text || "", cols, 3),
    ];
  }
  const verb = (c: FileChange) => (c.kind === "add" ? "Added" : c.kind === "delete" ? "Deleted" : "Edited");
  const name = (c: FileChange) => (c.movePath ? `${rel(c.path, cwd)} → ${rel(c.movePath, cwd)}` : rel(c.path, cwd));
  const dot = running ? dim("• ", { blink: true }) : dim("• ");
  if (changes.length === 1) {
    const c = changes[0]!;
    const [add, del] = diffStats(c.diff);
    return [
      ...wrap([bold(verb(c)), S(` ${name(c)}`), ...stats(add, del)], cols, [dot], [S("  ")]),
      ...diffBody(c.diff, cols, "    ", c.movePath ?? c.path),
    ];
  }
  const totals = changes.map((c) => diffStats(c.diff));
  const add = totals.reduce((a, [x]) => a + x, 0);
  const del = totals.reduce((a, [, y]) => a + y, 0);
  const rows = wrap([bold("Edited"), S(` ${changes.length} files`), ...stats(add, del)], cols, [dot], [S("  ")]);
  changes.forEach((c, i) => {
    if (i > 0) rows.push({ spans: [] });
    rows.push(...wrap([S(name(c)), ...stats(...totals[i]!)], cols, D1(), DN()));
    rows.push(...diffBody(c.diff, cols, "    ", c.movePath ?? c.path));
  });
  return rows;
}

// --- plan, MCP, search, other tools --------------------------------------------------------

export function planRows(ev: ToolEvent, cols: number): Row[] {
  const input = ev.input as Data;
  const steps: Array<{ step: string; status: string }> = Array.isArray(input.plan) ? input.plan : [];
  const rows: Row[] = [{ spans: [dim("• "), bold("Updated Plan")] }];
  const details: Span[][] = [];
  if (typeof input.explanation === "string" && input.explanation.trim()) details.push([dim(input.explanation.trim(), { italic: true })]);
  for (const s of steps) {
    if (s.status === "completed") details.push([dim("✔ "), dim(s.step, { strike: true })]);
    else if (s.status === "in_progress") details.push([S("□ ", { fg: C.accent, bold: true }), S(s.step, { fg: C.accent, bold: true })]);
    else details.push([dim("□ "), dim(s.step)]);
  }
  details.forEach((d, i) => rows.push(...wrap(d, cols, i === 0 ? D1() : DN(), [S("      ")])));
  return rows;
}

export function callRows(ev: ToolEvent, cols: number, running: boolean): Row[] {
  if (ev.name === "web_search") {
    const q = String((ev.input as Data).query ?? "");
    return wrap([bold(running ? "Searching the web" : "Searched the web"), ...(q ? [S(" for "), S(truncate(q, cols - 30))] : [])], cols, [dim("• ")], [S("  ")]);
  }
  const [, server, tool] = ev.name.split("__");
  const label = server && tool ? `${server}.${tool}` : ev.name;
  const args = JSON.stringify(ev.input);
  const state = running ? "running" : ev.result?.isError ? "error" : "ok";
  const rows = wrap([bold(running ? "Calling" : "Called"), S(" "), S(label, { fg: C.accent }), dim(`(${truncate(args, 200)})`)], cols, [bullet(state)], [S("  ")]);
  if (running || !ev.result) return rows;
  const text = ev.result.text.trim();
  return rows.concat(text ? outputRows(ev.result.isError ? `Error: ${text}` : text, cols, 3) : []);
}

// --- notices -------------------------------------------------------------------------------

export const interruptedRows = (cols: number): Row[] =>
  wrap([S("■ Conversation interrupted - use /feedback if something went wrong", { fg: C.secondary })], cols);

export const compactedRows = (cols: number): Row[] => wrap([dim("• "), S("Context compacted")], cols);

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const pad = (x: number) => String(x).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
}

export function workedForRows(durationMs: number, endedAt: number | null, cols: number): Row[] {
  const sec = durationMs / 1000;
  const took = sec < 1 ? "<1s" : formatElapsed(sec).replace(/ 0(\d)s$/, " $1s");
  const clock = endedAt != null
    ? ` • ${new Date(endedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  return wrap([dim(`  Worked for ${took}${clock}`)], cols);
}

// --- live area -----------------------------------------------------------------------------

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a: string, b: string, k: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** "• Working (12s • esc to interrupt)" with Codex's sweeping shimmer. */
export function statusRow(header: string, elapsedSec: number, t: number, sinceChange: number): Row {
  const rest = mix(C.fg, C.bg, 0.5);
  const chars = [...header];
  const half = Math.max(3, chars.length * 0.1);
  // the band starts 600ms after the header changes, then sweeps for 1s every 4s
  const phase = (sinceChange - 0.6) % 4;
  const sweeping = sinceChange >= 0.6 && phase < 1;
  const center = sweeping ? -half + phase * (chars.length + 2 * half) : -Infinity;
  const glow = (i: number) => {
    const d = Math.abs(i - center);
    return d > half ? 0 : (1 + Math.cos((Math.PI * d) / half)) / 2;
  };
  const dotGlow = (1 + Math.cos(Math.PI * 2 * (t / 2))) / 2;
  return {
    spans: [
      S("• ", { fg: mix(rest, C.fg, dotGlow) }),
      ...chars.map((ch, i) => S(ch, { fg: mix(rest, C.fg, glow(i)) })),
      dim(` (${formatElapsed(elapsedSec)} • `),
      bold("esc"),
      dim(" to interrupt)"),
    ],
  };
}

export function composerRows(text: string, cols: number, t: number, busy: boolean, named: boolean, meta: SessionMeta): Row[] {
  const painted = (spans: Span[]): Row => ({ spans, rowBg: C.composerBg });
  const cursorOn = Math.floor(t * 2) % 2 === 0;
  // the block cursor sits on the next cell: after the typed text, or on the placeholder's first letter
  const cursor = (ch: string, fg: string) => S(ch, cursorOn ? { bg: C.fg, fg: C.composerBg } : { fg });
  const placeholder = "Ask Codex to do anything";
  const body = text
    ? wrap([S(text)], cols - 1, [bold("› ")], [S("  ")])
    : [{ spans: [bold("› "), cursor(placeholder[0]!, C.secondary), S(placeholder.slice(1), { fg: C.secondary })] }];
  if (text) body[body.length - 1]!.spans.push(cursor(" ", C.fg));

  const status: Span[] = [];
  if (meta.model) status.push(S(`${modelLabel(meta.model)} ${meta.effort ?? "default"}`, { fg: C.yellow }), S(" · ", { fg: C.secondary }));
  status.push(S(tildify(meta.cwd ?? "~"), { fg: C.dirGreen }));
  if (named && meta.title) status.push(S(" · ", { fg: C.secondary }), S(meta.title, { fg: C.rosewater }));
  const sep = S(" · ", { fg: C.secondary });
  const hint: Span[] = busy
    ? [S("tab"), S(" to queue message", { fg: C.secondary })]
    : [...(named && meta.subagents ? [S("←"), S(" for agents", { fg: C.secondary }), sep] : []), S("?"), S(" for shortcuts", { fg: C.secondary })];
  return [
    painted([]),
    ...body.map((r) => painted(r.spans)),
    painted([]),
    // the status line fills in once the thread starts
    { spans: named ? [S("  "), ...status] : [] },
    { spans: [S("  "), ...hint] },
  ];
}
