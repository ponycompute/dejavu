import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { parseClaudeCode, parseClaudeCodeLines } from "../src/agents/claude-code/parse.js";
import { buildScene } from "../src/agents/claude-code/scene.js";
import { modelLabel } from "../src/agents/claude-code/ui.js";
import { projectDirName } from "../src/agents/claude-code/index.js";
import { spansText } from "../src/core/text.js";
import type { Screen } from "../src/core/types.js";

const fixture = path.join(import.meta.dirname, "..", "fixtures", "claude-code-sample.jsonl");
const rec = (r: object) => JSON.stringify({ sessionId: "s", cwd: "/p", timestamp: "2026-10-29T00:00:00Z", ...r });
const screenText = (s: Screen) => Array.from({ length: s.length }, (_, i) => spansText(s.row(i)?.spans ?? [])).join("\n");

test("parses the sample session into prompts, replies and tool calls with results", () => {
  const { meta, events } = parseClaudeCode(fixture);
  assert.equal(meta.cwd, "/Users/demian/dev/tinycli");
  assert.equal(meta.model, "claude-opus-4-5-20251101");
  assert.equal(events[0]?.kind, "user");
  const tools = events.filter((e) => e.kind === "tool");
  assert.ok(tools.length >= 10);
  assert.ok(tools.every((t) => t.kind === "tool" && t.result));
});

test("slash commands, shell mode, interrupts, images and sidechains", () => {
  const { events } = parseClaudeCodeLines([
    rec({ type: "user", message: { role: "user", content: "<command-name>/model</command-name><command-args>opus</command-args>" } }),
    rec({ type: "user", message: { role: "user", content: "<local-command-stdout>Set model to opus</local-command-stdout>" } }),
    rec({ type: "user", message: { role: "user", content: "<bash-input>ls</bash-input>" } }),
    rec({ type: "user", isMeta: true, message: { role: "user", content: "hidden" } }),
    rec({ type: "user", isSidechain: true, message: { role: "user", content: "subagent" } }),
    rec({ type: "user", message: { role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "what is this?" }] } }),
    rec({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } }),
    "not json",
  ]);
  assert.deepEqual(events.map((e) => [e.kind, "text" in e ? e.text : null]), [
    ["user", "/model opus"],
    ["command-output", "Set model to opus"],
    ["user", "! ls"],
    ["user", "[Image #1]\nwhat is this?"],
    ["interrupted", null],
  ]);
});

test("scene ends idle with the final reply on screen", () => {
  const session = parseClaudeCode(fixture);
  const scene = buildScene(session, { cols: 100, speed: 1 });
  assert.ok(scene.duration > 10);
  const end = screenText(scene.frame(scene.duration - 0.01));
  assert.match(end, /All 3 tests pass\./);
  assert.doesNotMatch(end, /esc to interrupt/);
  assert.match(screenText(scene.frame(scene.duration / 2)), /esc to interrupt/);
});

test("speed scales duration", () => {
  const session = parseClaudeCode(fixture);
  const a = buildScene(session, { cols: 100, speed: 1 }).duration;
  const b = buildScene(session, { cols: 100, speed: 2 }).duration;
  assert.ok(Math.abs(a / 2 - b) < 1e-6);
});

test("model ids and project dirs", () => {
  assert.equal(modelLabel("claude-opus-4-5-20251101"), "Opus 4.5");
  assert.equal(modelLabel("claude-sonnet-4-20250514"), "Sonnet 4");
  assert.equal(modelLabel("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
  assert.equal(projectDirName("/Users/me/01_projects/my.app"), "-Users-me-01-projects-my-app");
});

test("reads and searches fold into one dim summary line, as in Claude Code 2.1", () => {
  const scene = buildScene(parseClaudeCode(fixture), { cols: 100, speed: 1 });
  const end = screenText(scene.frame(scene.duration - 0.01));
  assert.match(end, /Searched for 1 pattern, read 1 file \(ctrl\+o to expand\)/);
  assert.doesNotMatch(end, /Read 13 lines/);
  assert.doesNotMatch(end, /Update Todos/);
  assert.match(end, /Added 6 lines, removed 1 line/);
  assert.match(end, /❯/);
});

test("thinking between reads becomes 'Thought for' in the group", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 29, 0, 0, s)).toISOString();
  const session = parseClaudeCodeLines([
    rec({ type: "user", timestamp: at(0), message: { role: "user", content: "look around" } }),
    rec({ type: "assistant", timestamp: at(1), message: { id: "m1", content: [{ type: "thinking", thinking: "" }] } }),
    rec({ type: "assistant", timestamp: at(6), message: { id: "m2", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/p/a.ts" } }] } }),
    rec({ type: "user", timestamp: at(7), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } }),
  ]);
  const scene = buildScene(session, { cols: 100, speed: 1 });
  assert.match(screenText(scene.frame(scene.duration - 0.01)), /Thought for 5s, read 1 file/);
});
