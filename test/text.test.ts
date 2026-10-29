import assert from "node:assert/strict";
import { test } from "node:test";
import { charWidth, revealRows, spansText, strWidth, truncate, wrap } from "../src/core/text.js";

test("Hangul and CJK take two cells", () => {
  assert.equal(charWidth(0xac00), 2); // Hangul syllable
  assert.equal(charWidth("日".codePointAt(0)!), 2);
  assert.equal(charWidth("a".codePointAt(0)!), 1);
  assert.equal(strWidth("日本 ok"), 7);
});

test("wrap breaks on spaces and records the gutter as prefix", () => {
  const rows = wrap([{ t: "alpha beta gamma delta" }], 14, [{ t: "⏺ " }], [{ t: "  " }]);
  assert.deepEqual(rows.map((r) => spansText(r.spans)), ["⏺ alpha beta ", "  gamma delta"]);
  assert.ok(rows.every((r) => r.prefix === 1));
});

test("wrap never splits a wide character across rows", () => {
  const rows = wrap([{ t: "あいうえお" }], 5);
  assert.ok(rows.every((r) => strWidth(spansText(r.spans)) <= 5));
  assert.equal(rows.map((r) => spansText(r.spans)).join(""), "あいうえお");
});

test("revealRows keeps gutters and reveals content cell by cell", () => {
  const rows = wrap([{ t: "hello world" }], 40, [{ t: "⏺ " }]);
  assert.equal(spansText(revealRows(rows, 3)[0]!.spans), "⏺ hel");
});

test("truncate adds an ellipsis within the width", () => {
  assert.equal(truncate("abcdefgh", 5), "abcd…");
  assert.equal(truncate("abc", 5), "abc");
});

test("word diff marks only the changed words of an edited line", async () => {
  const { changedRanges } = await import("../src/core/worddiff.js");
  const a = 'console.log("Usage: tinycli [--help] <name>");';
  const b = 'console.log("Usage: tinycli [--help] [--version] <name>");';
  const r = changedRanges(a, b);
  assert.ok(r);
  assert.deepEqual(r[0], []);
  assert.deepEqual(r[1].map(([s, e]) => b.slice(s, e).trim()), ["[--version]"]);
  assert.equal(changedRanges("abc", "totally different line here"), null);
});
