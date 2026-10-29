// Writes fixtures/grok-demo/: a synthetic Grok Build session doing the same task as the other
// samples (add --version to tinycli), for the README screenshots. The parser's edge cases
// (failed calls, cancelled turns) live in fixtures/grok-sample instead.
//
//   npx tsx fixtures/make-grok-demo.ts
import fs from "node:fs";
import path from "node:path";

const DIR = "fixtures/grok-demo";
const SESSION = "019a2f1c-4e3b-7a10-9c2d-5b8e0f6a7d31";
const CWD = "/Users/demian/dev/tinycli";
const START = Date.parse("2026-10-29T14:20:05Z");

const lines: string[] = [];
let ms = 0;
let tokens = 11_840;
let stream = 0;

function update(update: Record<string, unknown>, after = 0): void {
  ms += after;
  const meta = { agentTimestampMs: START + ms, streamStartMs: START + stream, totalTokens: tokens };
  lines.push(JSON.stringify({ timestamp: (START + ms) / 1000, method: "_x.ai/session/update", params: { sessionId: SESSION, update, _meta: meta } }));
}

/** Streams text as chunks of a few words each. */
function chunks(kind: string, text: string, every: number): void {
  stream = ms;
  for (const part of text.match(/\S+\s*/g) ?? []) update({ sessionUpdate: kind, content: { type: "text", text: part } }, every);
}

let calls = 0;
function tool(name: string, kind: string, label: string, title: string, rawInput: Record<string, unknown>, result: Record<string, unknown>, took: number): void {
  const id = `call_${++calls}`;
  update({ sessionUpdate: "tool_call", toolCallId: id, title: name, status: "pending", _meta: { "x.ai/tool": { name, kind, label } } }, 220);
  const loc = typeof rawInput.path === "string" ? { locations: [{ path: path.join(CWD, rawInput.path) }] } : {};
  update({ sessionUpdate: "tool_call_update", toolCallId: id, title, kind, rawInput, ...loc }, 60);
  tokens += 900;
  update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...result }, took);
}

const text = (s: string) => ({ content: [{ type: "content", content: { type: "text", text: s } }] });

const prompt = "Add a --version flag to tinycli. It should print the version from package.json.";
update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: prompt } });

ms += 900;
chunks("agent_thought_chunk", "Find where argv is parsed, read the version from package.json, then cover it with a test.", 110);

tool("read_file", "read", "Read", "Read `package.json`", { variant: "ReadFile", path: "package.json" }, text("{\n  \"name\": \"tinycli\",\n  \"version\": \"0.3.1\"\n}"), 140);
tool("read_file", "read", "Read", "Read `src/cli.js`", { variant: "ReadFile", path: "src/cli.js" }, text("#!/usr/bin/env node\nfunction main(argv) {\n  if (argv.includes(\"--help\")) return printHelp();\n}"), 160);
tool("grep", "search", "Search", "Search `--help`", { variant: "Grep", pattern: "--help", path: "." }, text("src/cli.js:6\ntest/cli.test.js:4"), 180);

const oldText = [
  "function main(argv) {",
  "  if (argv.includes(\"--help\") || argv.includes(\"-h\")) {",
].join("\n");
const newText = [
  "function main(argv) {",
  "  if (argv.includes(\"--version\") || argv.includes(\"-v\")) {",
  "    console.log(require(\"../package.json\").version);",
  "    return 0;",
  "  }",
  "  if (argv.includes(\"--help\") || argv.includes(\"-h\")) {",
].join("\n");
update({ sessionUpdate: "tool_call", toolCallId: "call_edit", title: "search_replace", status: "pending", _meta: { "x.ai/tool": { name: "search_replace", kind: "edit", label: "Edit" } } }, 900);
update({
  sessionUpdate: "tool_call_update",
  toolCallId: "call_edit",
  title: "Edit `src/cli.js`",
  kind: "edit",
  rawInput: { variant: "SearchReplace", path: "src/cli.js" },
  locations: [{ path: path.join(CWD, "src/cli.js") }],
  content: [{ type: "diff", path: path.join(CWD, "src/cli.js"), oldText, newText, _meta: { start_line: 9 } }],
}, 300);
update({ sessionUpdate: "tool_call_update", toolCallId: "call_edit", status: "completed" }, 200);

tool("run_terminal_command", "execute", "Execute", "Execute `npm test`", { variant: "RunTerminalCommand", command: "npm test" }, { rawOutput: { Content: { content: "# tests 4\n# pass 4\n# fail 0" } } }, 1400);

tokens = 18_432;
ms += 700;
chunks(
  "agent_message_chunk",
  "Added `--version` (and `-v`) to tinycli.\n\n- `src/cli.js` prints `version` from `package.json` and exits 0\n- `npm test` passes, 4 of 4\n\n```sh\n$ node src/cli.js --version\n0.3.1\n```",
  45,
);
update({ sessionUpdate: "turn_completed", stop_reason: "end_turn", elapsed_ms: ms }, 120);

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, "updates.jsonl"), `${lines.join("\n")}\n`);
fs.writeFileSync(path.join(DIR, "chat_history.jsonl"), "{}\n");
fs.writeFileSync(
  path.join(DIR, "summary.json"),
  `${JSON.stringify({
    info: { id: SESSION, cwd: CWD },
    head_branch: "main",
    current_model_id: "grok-4.7",
    reasoning_effort: "high",
    generated_title: "Add --version flag to tinycli",
    created_at: new Date(START).toISOString(),
  })}\n`,
);
console.log(`wrote ${lines.length} updates to ${DIR}`);
