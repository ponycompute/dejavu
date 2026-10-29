import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectAgent } from "../src/agents/index.js";
import { grok } from "../src/agents/grok/index.js";
import { parseGrok, parseGrokLines } from "../src/agents/grok/parse.js";
import { markdownRows } from "../src/agents/grok/ui.js";
import { buildScene } from "../src/agents/grok/scene.js";
import { spansText } from "../src/core/text.js";
import type { Screen } from "../src/core/types.js";

const fixtures = path.join(import.meta.dirname, "..", "fixtures");
const sample = path.join(fixtures, "grok-sample");

test("parses the sample session: meta from summary.json, merged chunks, resolved tools", () => {
  const { agent, meta, events } = parseGrok(sample);
  assert.equal(agent, "grok");
  assert.equal(meta.cwd, "/Users/demian/dev/tinycli");
  assert.equal(meta.model, "grok-4.7");
  assert.equal(meta.effort, "high");
  assert.equal(meta.title, "Explain the CLI entry point");
  assert.deepEqual(events.map((e) => e.kind), ["user", "thinking", "tool", "tool", "assistant", "turn-end", "user", "interrupted"]);
  const [read, exec] = events.filter((e) => e.kind === "tool");
  assert.ok(read?.kind === "tool" && exec?.kind === "tool");
  assert.equal(read.name, "read_file");
  assert.equal(read.input.title, "Read `src/cli.ts`");
  assert.deepEqual(read.input.locations, ["/Users/demian/dev/tinycli/src/cli.ts"]);
  assert.match(read.result?.text ?? "", /run\(process\.argv\)/);
  assert.equal(exec.input.command, "npm test");
  assert.equal(exec.result?.isError, true);
  assert.equal(exec.result?.text, "1 failing");
  const thinking = events.find((e) => e.kind === "thinking");
  assert.ok(thinking?.kind === "thinking" && thinking.summary === "Let me read the entry point.");
  const answer = events.find((e) => e.kind === "assistant");
  assert.ok(answer?.kind === "assistant" && answer.text === "It parses argv and delegates to `run`.");
});

test("any file in a session directory maps to its updates.jsonl", () => {
  assert.equal(detectAgent(path.join(sample, "chat_history.jsonl")).id, "grok");
  assert.equal(parseGrok(path.join(sample, "summary.json")).file, path.join(sample, "updates.jsonl"));
  assert.ok(!grok.detect(path.join(fixtures, "codex-sample.jsonl")));
  assert.ok(!grok.detect(path.join(fixtures, "claude-code-sample.jsonl")));
});

test("finds sessions grouped under the url-encoded cwd", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dejavu-grok-"));
  const cwd = "/Users/demian/dev/tinycli";
  const group = path.join(home, "sessions", encodeURIComponent(cwd));
  fs.mkdirSync(path.join(group, "empty-session"), { recursive: true });
  fs.writeFileSync(path.join(group, "empty-session", "updates.jsonl"), "");
  fs.cpSync(sample, path.join(group, "0199aaaa"), { recursive: true });
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const found = grok.sessionsFor(cwd);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.id, "0199aaaa");
    assert.equal(found[0]?.firstPrompt, "what does src/cli.ts do?");
    assert.deepEqual(grok.sessionsFor("/elsewhere"), []);
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
  }
});

const prefs = { compact: false, permission: "always-approve", version: "1.0.70", modelNames: { "grok-4.7": "Grok 4.7" }, contextWindows: {} };
const screenText = (s: Screen) => Array.from({ length: s.length }, (_, i) => spansText(s.row(i)?.spans ?? [])).join("\n");

test("scene opens on the welcome screen and ends with the whole conversation", () => {
  const scene = buildScene(parseGrok(sample), { cols: 100, rows: 30, speed: 1 }, prefs);
  const start = screenText(scene.frame(0));
  assert.match(start, /Grok Build {2}1\.0\.70/);
  assert.match(start, /Resume session +ctrl\+r/);
  assert.match(start, /Grok 4\.7 \(high\) · always-approve/);
  const end = screenText(scene.frame(scene.duration));
  assert.equal(scene.frame(scene.duration).length, 30);
  assert.match(end, /^ {5}what does src\/cli\.ts do\? +\d+:\d\d [AP]M/m);
  assert.match(end, /Thought for \d+\.\ds/);
  assert.match(end, /◈ Explored 1 file, ran 1 command · 1 failed/);
  assert.match(end, /\[Dashboard\]/);
  assert.match(end, /It parses argv and delegates to run\./);
  assert.match(end, /Worked for 4\.2s/);
  assert.match(end, /Turn cancelled by user in 1\.0s\./);
  assert.match(end, /Shift\+Tab:mode {2}│ {2}Ctrl\+\.:shortcuts/);
  assert.ok(!/Read `src|◆ Run/.test(end), "reads and the command fold into the group row");
});

test("compact mode uses 1-column margins and only the shortcuts hint", () => {
  const scene = buildScene(parseGrok(sample), { cols: 80, rows: 24, speed: 1 }, { ...prefs, compact: true });
  const end = screenText(scene.frame(scene.duration)).split("\n");
  assert.ok(end.some((l) => l === " Ctrl+.:shortcuts"));
  assert.ok(end.some((l) => l.startsWith(" ╭")));
});

test("a running group reads in the present tense, then the past", () => {
  const scene = buildScene(parseGrok(sample), { cols: 100, rows: 30, speed: 1 }, prefs);
  const texts = Array.from({ length: Math.ceil(scene.duration * 10) }, (_, i) => screenText(scene.frame(i / 10)));
  const reading = texts.findIndex((s) => s.includes("◈ Exploring 1 file"));
  assert.ok(reading >= 0);
  assert.ok(texts.slice(reading).some((s) => s.includes("◈ Explored 1 file")));
  assert.ok(texts.some((s) => /Thinking… \d/.test(s)), "turn status row while busy");
});

test("failed hooks become one notice line each; successful ones leave none", () => {
  const line = (update: object) => JSON.stringify({ timestamp: 1, method: "_x.ai/session/update", params: { sessionId: "s", update } });
  const { events } = parseGrokLines([
    line({ sessionUpdate: "hook_execution", event_name: "stop", runs: [
      { name: "global/agbox:stop[0].hooks[0]", status: { status: "failed", error: "exit code 127" } },
      { name: "global/ok:stop[0].hooks[0]", status: { status: "success" } },
    ] }),
  ]);
  assert.deepEqual(events, [{ kind: "notice", text: "stop hook (global/agbox) failed, ignored: exit code 127", ts: 1000 }]);
});

test("code blocks and tables end with a row of copy buttons", () => {
  const text = markdownRows("```\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |", 60).map((r) => spansText(r.spans).trimEnd());
  assert.ok(text.includes("◇ code   [Copy]"));
  assert.ok(text.includes("◇ table   [Copy TSV]   [Copy CSV]   [Copy Markdown]"));
});
