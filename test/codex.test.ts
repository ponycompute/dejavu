import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { parseCodex, parseCodexLines, parsePatch } from "../src/agents/codex/parse.js";
import { buildScene } from "../src/agents/codex/scene.js";
import { codex } from "../src/agents/codex/index.js";
import { spansText } from "../src/core/text.js";
import type { Screen } from "../src/core/types.js";

const fixture = path.join(import.meta.dirname, "..", "fixtures", "codex-sample.jsonl");
const rec = (type: string, payload: object) => JSON.stringify({ timestamp: "2026-10-29T00:00:00Z", type, payload });
const screenText = (s: Screen) => Array.from({ length: s.length }, (_, i) => spansText(s.row(i)?.spans ?? [])).join("\n");

test("parses the sample rollout: meta, prompt, resolved tool calls", () => {
  const { meta, events } = parseCodex(fixture);
  assert.equal(meta.cwd, "/Users/demian/dev/tinycli");
  assert.equal(meta.version, "0.142.0");
  assert.equal(meta.model, "gpt-5.5");
  assert.equal(events[0]?.kind, "user");
  const tools = events.filter((e) => e.kind === "tool");
  assert.ok(tools.length >= 5);
  assert.ok(tools.every((t) => t.kind === "tool" && t.result));
  assert.ok(events.some((e) => e.kind === "turn-end"));
  assert.ok(events.some((e) => e.kind === "context"));
});

test("detects rollout files", () => {
  assert.ok(codex.detect(fixture));
  assert.ok(!codex.detect(path.join(import.meta.dirname, "..", "fixtures", "claude-code-sample.jsonl")));
});

test("exec output splits exit code from the command's output; legacy prompts dedupe", () => {
  const { events } = parseCodexLines([
    rec("session_meta", { id: "x", cwd: "/p", cli_version: "0.1.0" }),
    rec("event_msg", { type: "user_message", message: "run it" }),
    rec("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] }),
    rec("response_item", { type: "function_call", name: "shell", call_id: "c1", arguments: JSON.stringify({ command: ["bash", "-lc", "false"] }) }),
    rec("response_item", { type: "function_call_output", call_id: "c1", output: "Process exited with code 1\nWall time: 0.1 seconds\nOutput:\noops\n" }),
    rec("event_msg", { type: "turn_aborted", reason: "interrupted" }),
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["user", "tool", "interrupted"]);
  const tool = events[1]!;
  assert.ok(tool.kind === "tool");
  assert.equal(tool.input.command, "false");
  assert.deepEqual(tool.result?.data, { exitCode: 1, output: "oops\n", command: "false", parsed: [] });
  assert.equal(tool.result?.isError, true);
});

test("apply_patch envelopes become per-file diffs", () => {
  const files = parsePatch("*** Begin Patch\n*** Update File: a.js\n@@\n-x\n+y\n*** Add File: b.js\n+hi\n*** End Patch");
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [["a.js", "update"], ["b.js", "add"]]);
  assert.equal(files[0]!.diff, "@@\n-x\n+y\n");
});

test("final frame shows the Codex transcript cells", () => {
  const scene = buildScene(parseCodex(fixture), { cols: 100, rows: 28, speed: 1 });
  const text = screenText(scene.frame(scene.duration));
  for (const s of ["OpenAI Codex", "Explored", "Edited", "Ran npm test", "Updated Plan", "Worked for", "GPT-5.5"]) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
  assert.ok(!text.includes("esc to interrupt"));
});

test("code mode: the exec script is hidden, the commands it ran become exec cells", () => {
  const { events, meta } = parseCodexLines([
    rec("session_meta", { id: "x", cwd: "/p", cli_version: "0.165.0" }),
    rec("turn_context", { model: "gpt-6-luna" }),
    rec("response_item", { type: "custom_tool_call", name: "exec", call_id: "c1", input: "await tools.exec_command({cmd:\"ls\"})" }),
    rec("event_msg", {
      type: "item_completed",
      started_at_ms: 1000,
      item: { type: "CommandExecution", id: "exec-1", command: ["/bin/zsh", "-lc", "ls"], parsed_cmd: [{ type: "list_files", cmd: "ls" }], aggregated_output: "a\n", exit_code: 0, status: "completed" },
    }),
    rec("response_item", { type: "custom_tool_call_output", call_id: "c1", output: [{ type: "input_text", text: "Script completed" }] }),
  ]);
  assert.equal(meta.model, "gpt-6-luna");
  assert.deepEqual(events.map((e) => (e.kind === "tool" ? [e.name, e.input.command, e.ts] : [e.kind])), [["exec_command", "ls", 1000]]);
});
