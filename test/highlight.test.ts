import assert from "node:assert/strict";
import { test } from "node:test";
import { highlighter, langFor } from "../src/core/highlight.js";

const kinds = (lang: string, ...lines: string[]) => {
  const hl = highlighter(lang);
  return lines.map((l) => hl(l).filter((t) => t.k !== "plain").map((t) => `${t.k}:${t.t}`));
};

test("langFor reads fence tags and file paths", () => {
  assert.equal(langFor("ts"), "ts");
  assert.equal(langFor("src/cli.test.js"), "js");
  assert.equal(langFor("Dockerfile"), "sh");
  assert.equal(langFor("notes.txt"), null);
  assert.equal(langFor(""), null);
});

test("JS keywords, strings, calls, comments and numbers", () => {
  assert.deepEqual(kinds("js", "const out = run([\"-h\"], 3); // go"), [[
    "keyword:const", "operator:=", "function:run", "punct:([", "string:\"-h\"", "punct:],", "number:3", "punct:);", "comment:// go",
  ]]);
});

test("block comments and template strings carry across lines", () => {
  assert.deepEqual(kinds("ts", "/* a", "b */ x", "`one", "two` + 1"), [
    ["comment:/* a"],
    ["comment:b */"],
    ["string:`one"],
    ["string:two`", "operator:+", "number:1"],
  ]);
});

test("shell: commands after pipes, flags, variables", () => {
  assert.deepEqual(kinds("bash", "rg -n \"x\" $DIR | head -5"), [[
    "function:rg", "constant:-n", "string:\"x\"", "variable:$DIR", "operator:|", "function:head", "constant:-5",
  ]]);
});

test("JSON keys are properties", () => {
  assert.deepEqual(kinds("json", "{\"a\": true, \"b\": \"c\"}"), [[
    "punct:{", "property:\"a\"", "punct::", "constant:true", "punct:,", "property:\"b\"", "punct::", "string:\"c\"", "punct:}",
  ]]);
});

test("unknown languages stay plain", () => {
  assert.deepEqual(highlighter(null)("anything"), [{ t: "anything", k: "plain" }]);
});
