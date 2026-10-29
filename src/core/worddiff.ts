// Word-level changes between an edited line's old and new text, for diffs that highlight the
// words that changed inside a modified line.
import type { Span } from "./types.js";

export type Range = [start: number, end: number];

const tokens = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];

/**
 * Character ranges that differ between `a` and `b`, or null when the lines share too little for
 * a word highlight to help (the whole line is the change).
 */
export function changedRanges(a: string, b: string, minShared = 0.4): [Range[], Range[]] | null {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length || ta.length * tb.length > 250_000) return null;
  // longest common subsequence over tokens
  const dp = Array.from({ length: ta.length + 1 }, () => new Uint32Array(tb.length + 1));
  for (let i = ta.length - 1; i >= 0; i--) {
    for (let j = tb.length - 1; j >= 0; j--) {
      dp[i]![j] = ta[i] === tb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const keepA = new Array<boolean>(ta.length).fill(false);
  const keepB = new Array<boolean>(tb.length).fill(false);
  let shared = 0;
  for (let i = 0, j = 0; i < ta.length && j < tb.length;) {
    if (ta[i] === tb[j]) {
      keepA[i++] = true;
      shared += tb[j]!.length;
      keepB[j++] = true;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  if (shared / Math.max(a.length, b.length) < minShared) return null;
  const ranges = (toks: string[], keep: boolean[]): Range[] => {
    const out: Range[] = [];
    let pos = 0;
    toks.forEach((t, k) => {
      // whitespace between two changed words belongs to the change
      const changed = !keep[k] || (/^\s+$/.test(t) && k > 0 && !keep[k - 1] && k + 1 < toks.length && !keep[k + 1]);
      if (changed) {
        const last = out[out.length - 1];
        if (last && last[1] === pos) last[1] = pos + t.length;
        else out.push([pos, pos + t.length]);
      }
      pos += t.length;
    });
    return out;
  };
  return [ranges(ta, keepA), ranges(tb, keepB)];
}

/** Restyle the characters inside `ranges` (offsets into the spans' joined text). */
export function markRanges(spans: Span[], ranges: Range[], style: Partial<Span>): Span[] {
  if (!ranges.length) return spans;
  const out: Span[] = [];
  let pos = 0;
  for (const span of spans) {
    const end = pos + span.t.length;
    let cut = pos;
    for (const [rs, re] of ranges) {
      const s = Math.max(rs, pos);
      const e = Math.min(re, end);
      if (s >= e) continue;
      if (s > cut) out.push({ ...span, t: span.t.slice(cut - pos, s - pos) });
      out.push({ ...span, ...style, t: span.t.slice(s - pos, e - pos) });
      cut = e;
    }
    if (cut < end) out.push({ ...span, t: span.t.slice(cut - pos) });
    pos = end;
  }
  return out;
}
