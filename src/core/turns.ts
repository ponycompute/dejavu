import type { SessionEvent } from "./types.js";

/** Parse "3", "2-5", "4-" or "-2" into an inclusive 1-based range. */
export function parseRange(spec: string): [number, number] {
  const m = spec.trim().match(/^(\d*)\s*(-?)\s*(\d*)$/);
  if (!m || (!m[1] && !m[3])) throw new Error(`Invalid turn range "${spec}" (try 3, 2-5, 4- or -2)`);
  const from = m[1] ? Number(m[1]) : 1;
  const to = m[3] ? Number(m[3]) : m[2] ? Infinity : from;
  if (from < 1 || to < from) throw new Error(`Invalid turn range "${spec}"`);
  return [from, to];
}

/**
 * Keep only turns from..to. A turn starts at a typed prompt (not a slash command) and runs until
 * the next one; anything before the first prompt belongs to turn 1.
 */
export function selectTurns(events: SessionEvent[], from: number, to: number): SessionEvent[] {
  let turn = 0;
  return events.filter((ev) => {
    if (ev.kind === "user" && !ev.command) turn++;
    const current = Math.max(1, turn);
    return current >= from && current <= to;
  });
}

export const countTurns = (events: SessionEvent[]) =>
  events.filter((ev) => ev.kind === "user" && !ev.command).length;
