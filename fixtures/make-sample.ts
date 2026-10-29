// Builds a realistic Claude Code session log (same shape as ~/.claude/projects/*/<id>.jsonl)
import fs from "node:fs";
import path from "node:path";
const cwd = "/Users/demian/dev/tinycli";
const sessionId = "7c1e2f4a-1b2c-4d5e-8f90-a1b2c3d4e5f6";
let t = Date.parse("2026-10-29T04:10:00Z");
let n = 0;
const base = () => ({ parentUuid: null, isSidechain: false, userType: "external", cwd, sessionId, version: "2.1.300", gitBranch: "main", uuid: `u-${++n}`, timestamp: new Date((t += 2500)).toISOString() });
const lines: unknown[] = [];
const user = (content: unknown, extra: Record<string, unknown> = {}) => lines.push({ ...base(), type: "user", message: { role: "user", content }, ...extra });
const asst = (block: Record<string, unknown>, extra: Record<string, unknown> = {}) => lines.push({ ...base(), type: "assistant", message: { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-4-5-20251101", content: [block] }, ...extra });
let tid = 0;
const tool = (name: string, input: Record<string, unknown>, resultText: string, toolUseResult: unknown, isError = false) => {
  const id = `toolu_${++tid}`;
  asst({ type: "tool_use", id, name, input });
  user([{ tool_use_id: id, type: "tool_result", content: resultText, is_error: isError }], { toolUseResult });
};

const cli = `#!/usr/bin/env node
const { parseArgs } = require('node:util');
const { greet } = require('./greet');

const { values, positionals } = parseArgs({
  options: {
    loud: { type: 'boolean', short: 'l' },
  },
  allowPositionals: true,
});

console.log(greet(positionals[0] ?? 'world', values.loud));
`;

user("Add a --version flag to tinycli. It should just print the version from package.json.");
asst({ type: "thinking", thinking: "Look at the CLI entry first.", signature: "x" }, { thinkingDurationMs: 3200 });
asst({ type: "text", text: "I'll add a `--version` flag. Let me look at how the CLI parses arguments first." });
tool("TodoWrite", { todos: [
  { content: "Read CLI entry point", status: "in_progress", activeForm: "Reading CLI entry point" },
  { content: "Add --version flag", status: "pending", activeForm: "Adding --version flag" },
  { content: "Add a test and run the suite", status: "pending", activeForm: "Running tests" },
] }, "Todos have been modified successfully.", {});
tool("Read", { file_path: `${cwd}/src/cli.js` }, cli, { type: "text", file: { filePath: `${cwd}/src/cli.js`, content: cli, numLines: 13, startLine: 1, totalLines: 13 } });
tool("Grep", { pattern: "version", path: `${cwd}`, output_mode: "files_with_matches" }, "Found 2 files\n/Users/demian/dev/tinycli/package.json\n/Users/demian/dev/tinycli/README.md", { mode: "files_with_matches", numFiles: 2, filenames: ["package.json", "README.md"] });
asst({ type: "text", text: "The CLI uses `node:util` `parseArgs`, so this is a two-line change: declare the option, then print the version from **package.json** before anything else runs." });
tool("Edit", { file_path: `${cwd}/src/cli.js`, old_string: "    loud: { type: 'boolean', short: 'l' },\n  },", new_string: "    loud: { type: 'boolean', short: 'l' },\n    version: { type: 'boolean', short: 'v' },\n  },", replace_all: false },
  "The file has been updated.",
  { filePath: `${cwd}/src/cli.js`, structuredPatch: [{ oldStart: 5, oldLines: 5, newStart: 5, newLines: 6, lines: [" const { values, positionals } = parseArgs({", "   options: {", "     loud: { type: 'boolean', short: 'l' },", "+    version: { type: 'boolean', short: 'v' },", "   },", "   allowPositionals: true,"] }] });
tool("Edit", { file_path: `${cwd}/src/cli.js`, old_string: "console.log(greet(", new_string: "if (values.version) {\n  console.log(require('../package.json').version);\n  process.exit(0);\n}\n\nconsole.log(greet(" },
  "The file has been updated.",
  { filePath: `${cwd}/src/cli.js`, structuredPatch: [{ oldStart: 12, oldLines: 2, newStart: 12, newLines: 7, lines: ["   allowPositionals: true,", " });", "-", "+", "+if (values.version) {", "+  console.log(require('../package.json').version);", "+  process.exit(0);", "+}", "+", " console.log(greet(positionals[0] ?? 'world', values.loud));"] }] });
tool("TodoWrite", { todos: [
  { content: "Read CLI entry point", status: "completed", activeForm: "Reading CLI entry point" },
  { content: "Add --version flag", status: "completed", activeForm: "Adding --version flag" },
  { content: "Add a test and run the suite", status: "in_progress", activeForm: "Running tests" },
] }, "Todos have been modified successfully.", {});
const test = `const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');

test('--version prints the package version', () => {
  const out = execFileSync('node', ['src/cli.js', '--version']).toString().trim();
  assert.strictEqual(out, pkg.version);
});
`;
tool("Write", { file_path: `${cwd}/test/version.test.js`, content: test }, `File created successfully at: ${cwd}/test/version.test.js`, { type: "create", filePath: `${cwd}/test/version.test.js`, content: test });
tool("Bash", { command: "npm test", description: "Run the test suite" },
  "> tinycli@0.4.2 test\n> node --test\n\n✔ greets the world (41.2ms)\n✔ --loud shouts (38.9ms)\n✖ --version prints the package version (52.7ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  + actual - expected\n  + ''\n  - '0.4.2'\nℹ tests 3\nℹ pass 2\nℹ fail 1",
  { stdout: "> tinycli@0.4.2 test\n> node --test\n\n✔ greets the world (41.2ms)\n✔ --loud shouts (38.9ms)\n✖ --version prints the package version (52.7ms)\nℹ tests 3\nℹ pass 2\nℹ fail 1", stderr: "", interrupted: false }, true);
asst({ type: "text", text: "The new test got an empty string back. Let me check whether the CLI itself works before touching the test." });
tool("Bash", { command: "node src/cli.js --version", description: "Run the CLI with --version" }, "0.4.2", { stdout: "0.4.2", stderr: "", interrupted: false });
asst({ type: "text", text: "That works, so the failure is the test running from the wrong directory. I'll pin `cwd` to the project root." });
tool("Edit", { file_path: `${cwd}/test/version.test.js`, old_string: "execFileSync('node', ['src/cli.js', '--version'])", new_string: "execFileSync('node', ['src/cli.js', '--version'], { cwd: path.join(__dirname, '..') })" },
  "The file has been updated.",
  { filePath: `${cwd}/test/version.test.js`, structuredPatch: [{ oldStart: 7, oldLines: 3, newStart: 7, newLines: 3, lines: [" test('--version prints the package version', () => {", "-  const out = execFileSync('node', ['src/cli.js', '--version']).toString().trim();", "+  const out = execFileSync('node', ['src/cli.js', '--version'], { cwd: path.join(__dirname, '..') }).toString().trim();", "   assert.strictEqual(out, pkg.version);"] }] });
tool("Bash", { command: "npm test", description: "Run the test suite" },
  "> tinycli@0.4.2 test\n> node --test\n\n✔ greets the world (40.1ms)\n✔ --loud shouts (37.6ms)\n✔ --version prints the package version (49.3ms)\nℹ tests 3\nℹ pass 3\nℹ fail 0",
  { stdout: "> tinycli@0.4.2 test\n> node --test\n\n✔ greets the world (40.1ms)\n✔ --loud shouts (37.6ms)\n✔ --version prints the package version (49.3ms)\nℹ tests 3\nℹ pass 3\nℹ fail 0", stderr: "", interrupted: false });
tool("TodoWrite", { todos: [
  { content: "Read CLI entry point", status: "completed", activeForm: "Reading CLI entry point" },
  { content: "Add --version flag", status: "completed", activeForm: "Adding --version flag" },
  { content: "Add a test and run the suite", status: "completed", activeForm: "Running tests" },
] }, "Todos have been modified successfully.", {});
asst({ type: "text", text: "Done. `tinycli --version` (or `-v`) now prints the version from package.json and exits.\n\n- **src/cli.js**: new `version` option, handled before the greeting\n- **test/version.test.js**: checks the output matches package.json\n\nAll 3 tests pass." });
fs.writeFileSync(path.join(import.meta.dirname, "claude-code-sample.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
console.log("wrote", lines.length, "lines");
