// A timeline of segments (what's animating) and commits (rows that become permanent scrollback).
// Agents build one while walking their events; the scene then samples it per frame.
import type { Row, Screen } from "./types.js";

interface Segment<S> {
  start: number;
  dur: number;
  fn: (p: number) => S;
}

interface Range<T> {
  from: number;
  to: number;
  value: T;
}

export class Timeline<S, R = unknown> {
  clock = 0;
  private segments: Segment<S>[] = [];
  private scrollback: Row[] = [];
  private commits: Array<{ at: number; length: number }> = [];
  private ranges: Range<R>[] = [];

  private readonly headerLength: number;
  constructor(private readonly speed: number, header: Row[] = []) {
    this.scrollback.push(...header);
    this.headerLength = header.length;
  }

  /** Hold for `dur` seconds of source time, rendering live state from progress p in [0, 1]. */
  push(dur: number, fn: (p: number) => S): void {
    const real = dur / this.speed;
    this.segments.push({ start: this.clock, dur: real, fn });
    this.clock += real;
  }

  /** Append rows to the scrollback at the current time, followed by a blank line unless `gap` is false. */
  commit(rows: Row[], gap = true): void {
    this.scrollback.push(...rows, ...(gap ? [{ spans: [] }] : []));
    this.commits.push({ at: this.clock, length: this.scrollback.length });
  }

  /** Open a time range carrying a value (e.g. "agent is busy"); close it with the returned function. */
  open(value: R): () => void {
    const range: Range<R> = { from: this.clock, to: Infinity, value };
    this.ranges.push(range);
    return () => {
      if (range.to === Infinity) range.to = this.clock;
    };
  }

  get duration(): number {
    return this.clock;
  }

  /** Live state, the open range (if any) and the visible scrollback length at time t. */
  sample(t: number): { state: S; range: R | undefined; scrollback: number } {
    const seg = findLast(this.segments, (s) => s.start <= t) ?? this.segments[0]!;
    const state = seg.fn(Math.min(1, Math.max(0, (t - seg.start) / (seg.dur || 1))));
    const commit = findLast(this.commits, (c) => c.at <= t);
    const scrollback = commit ? commit.length : this.headerLength;
    const range = findLast(this.ranges, (r) => r.from <= t);
    return { state, range: range && t < range.to ? range.value : undefined, scrollback };
  }

  /** A screen made of the first `scrollback` committed rows plus live rows below them. */
  screen(scrollback: number, live: Row[]): Screen {
    const rows = this.scrollback;
    return {
      length: scrollback + live.length,
      row: (i) => (i < scrollback ? rows[i] : live[i - scrollback]),
    };
  }
}

/** Binary search over items sorted by time: index of the last one matching a monotone predicate. */
export function findLastIndex<T>(items: T[], pred: (x: T) => boolean): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(items[mid]!)) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

const findLast = <T>(items: T[], pred: (x: T) => boolean): T | undefined => items[findLastIndex(items, pred)];
