import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRange, selectTurns } from "../src/core/turns.js";
import type { SessionEvent } from "../src/core/types.js";

test("parseRange accepts single, closed and open ranges", () => {
  assert.deepEqual(parseRange("3"), [3, 3]);
  assert.deepEqual(parseRange("2-5"), [2, 5]);
  assert.deepEqual(parseRange("4-"), [4, Infinity]);
  assert.deepEqual(parseRange("-2"), [1, 2]);
  assert.throws(() => parseRange("5-2"));
  assert.throws(() => parseRange("x"));
});

test("selectTurns splits on typed prompts, not slash commands", () => {
  const ev = (kind: "user" | "assistant", text: string, command = false): SessionEvent =>
    kind === "user" ? { kind, text, ts: null, command } : { kind, text, ts: null };
  const events = [
    ev("user", "/init", true),
    ev("user", "first"),
    ev("assistant", "a1"),
    ev("user", "/clear", true),
    ev("user", "second"),
    ev("assistant", "a2"),
  ];
  const texts = (es: SessionEvent[]) => es.map((e) => ("text" in e ? e.text : e.kind));
  assert.deepEqual(texts(selectTurns(events, 1, 1)), ["/init", "first", "a1", "/clear"]);
  assert.deepEqual(texts(selectTurns(events, 2, 2)), ["second", "a2"]);
});
