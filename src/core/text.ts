// Terminal text model: a row is a list of styled spans laid on a fixed cell grid.
import type { Row, Span } from "./types.js";

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1faff],
  [0x20000, 0x3fffd],
];

/** Terminal cell width of a code point: 0, 1 or 2. */
export function charWidth(cp: number): number {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining marks
  if (cp === 0x200b || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) break;
    if (cp <= hi) return 2;
  }
  return 1;
}

export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

export const spansText = (spans: Span[]): string => spans.map((s) => s.t).join("");
export const spansWidth = (spans: Span[]): number => strWidth(spansText(spans).replace(/\n/g, ""));

interface Cell {
  ch: string;
  w: number;
  style: Span;
}

function toCells(spans: Span[]): Cell[] {
  const cells: Cell[] = [];
  for (const sp of spans) {
    for (const ch of sp.t.replace(/\t/g, "  ")) {
      const w = charWidth(ch.codePointAt(0)!);
      if (w === 0) continue;
      cells.push({ ch, w, style: sp });
    }
  }
  return cells;
}

function cellsToSpans(cells: Cell[]): Span[] {
  const out: Array<{ span: Span; style: Span }> = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && last.style === c.style) last.span.t += c.ch;
    else out.push({ span: { ...c.style, t: c.ch }, style: c.style });
  }
  return out.map((o) => o.span);
}

function splitLines(spans: Span[]): Span[][] {
  const lines: Span[][] = [[]];
  for (const sp of spans) {
    sp.t.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ ...sp, t: part });
    });
  }
  return lines;
}

/**
 * Word-wrap styled spans to `width` cells. `first` / `rest` are gutter spans for the first and
 * continuation rows (e.g. "⏺ " then "  "); they are recorded as the row's prefix.
 */
export function wrap(
  spans: Span[],
  width: number,
  first: Span[] = [],
  rest: Span[] = first,
  rowProps: Partial<Row> = {},
): Row[] {
  const rows: Row[] = [];
  let isFirst = true;
  for (const line of splitLines(spans)) {
    let cells = toCells(line);
    do {
      const gutter = isFirst ? first : rest;
      const avail = Math.max(4, width - spansWidth(gutter));
      let used = 0;
      let cut = 0;
      let lastSpace = -1;
      while (cut < cells.length && used + cells[cut]!.w <= avail) {
        if (cells[cut]!.ch === " ") lastSpace = cut;
        used += cells[cut]!.w;
        cut++;
      }
      if (cut < cells.length && lastSpace > avail * 0.4 && cells[cut]!.ch !== " ") cut = lastSpace + 1;
      rows.push({ ...rowProps, spans: [...gutter, ...cellsToSpans(cells.slice(0, cut))], prefix: gutter.length });
      cells = cells.slice(cut);
      while (cells.length && cells[0]!.ch === " " && cut > 0) cells = cells.slice(1);
      isFirst = false;
    } while (cells.length);
  }
  return rows;
}

/** Cut spans to at most n cells, keeping newlines (for typing effects). */
export function takeCells(spans: Span[], n: number): Span[] {
  const out: Span[] = [];
  let left = n;
  for (const sp of spans) {
    if (left <= 0) break;
    let t = "";
    for (const ch of sp.t) {
      if (ch === "\n") {
        t += ch;
        continue;
      }
      if (left <= 0) break;
      t += ch;
      left -= Math.max(charWidth(ch.codePointAt(0)!), 1);
    }
    out.push({ ...sp, t });
  }
  return out;
}

/** Reveal the first n content cells of rows; gutter spans appear with their row. */
export function revealRows(rows: Row[], n: number): Row[] {
  const out: Row[] = [];
  let left = n;
  for (const r of rows) {
    if (left <= 0) break;
    const prefix = r.prefix ?? 0;
    const spans = r.spans.slice(0, prefix);
    for (const sp of r.spans.slice(prefix)) {
      if (left <= 0) break;
      const w = strWidth(sp.t);
      if (w <= left) {
        spans.push(sp);
        left -= w;
      } else {
        spans.push(takeCells([sp], left)[0]!);
        left = 0;
      }
    }
    out.push({ ...r, spans });
  }
  return out;
}

/** Content cells in rows, excluding gutters. */
export function contentWidth(rows: Row[]): number {
  return rows.reduce((a, r) => a + spansWidth(r.spans.slice(r.prefix ?? 0)), 0);
}

/** Pad a row's spans with spaces up to `width` cells. */
export function padTo(spans: Span[], width: number, style: Partial<Span> = {}): Span[] {
  const used = spansWidth(spans);
  return used < width ? [...spans, { ...style, t: " ".repeat(width - used) }] : spans;
}

/** Truncate plain text to `width` cells with an ellipsis. */
export function truncate(s: string, width: number): string {
  if (strWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}
