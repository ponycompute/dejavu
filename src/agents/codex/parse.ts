// Codex session log ("rollout") → normalized events.
// Logs live at ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, one
// {timestamp, type, payload} record per line; the first is always session_meta. Newer files
// ("paginated" history) record what the user saw as item_completed events, older ("legacy")
// files as user_message / patch_apply_end events; response_item lines exist in both.
import fs from "node:fs";
import type { Session, SessionEvent, SessionMeta } from "../../core/types.js";

type Json = any; // raw log records are loosely shaped
type ToolEvent = Extract<SessionEvent, { kind: "tool" }>;

export interface ExecData {
  command: string;
  parsed: Array<{ type: string; cmd?: string; name?: string; path?: string | null; query?: string | null }>;
  exitCode: number | null;
  output: string;
  declined?: boolean;
}

export interface FileChange {
  path: string;
  kind: "add" | "delete" | "update";
  movePath?: string;
  /** Unified diff hunks ("@@ -a,b +c,d @@" + lines); for adds, the file content as "+" lines. */
  diff: string;
}

/** Context left after a request, as Codex's footer computes it. */
const BASELINE_TOKENS = 12000;
function percentLeft(used: number, window: number): number {
  if (window <= BASELINE_TOKENS) return 0;
  const effective = window - BASELINE_TOKENS;
  const remaining = Math.max(0, effective - Math.max(0, used - BASELINE_TOKENS));
  return Math.round(Math.min(100, Math.max(0, (remaining / effective) * 100)));
}

const contentText = (content: Json): string =>
  (Array.isArray(content) ? content : [])
    .map((c: Json) => (typeof c?.text === "string" ? c.text : c?.type === "input_image" ? "[Image]" : ""))
    .filter(Boolean)
    .join("\n");

function outputText(output: Json): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return contentText(output);
  if (output && typeof output.content === "string") return output.content;
  return "";
}

/** "Process exited with code N … Output:\n<text>" → exit code and the command's own output. */
function splitExecOutput(text: string): { exitCode: number | null; output: string } {
  const code = text.match(/(?:Process exited with code|Exit code:) (-?\d+)/);
  const body = text.match(/\nOutput:\n([\s\S]*)$/);
  return { exitCode: code ? Number(code[1]) : null, output: body ? body[1]! : text };
}

const commandString = (cmd: Json): string => {
  if (typeof cmd === "string") return cmd;
  if (!Array.isArray(cmd)) return "";
  // ["bash", "-lc", "<script>"] → the script
  if (cmd.length === 3 && /(^|\/)(ba|z)?sh$/.test(cmd[0]) && cmd[1] === "-lc") return cmd[2];
  return cmd.join(" ");
};

const parseJson = (s: unknown): Json => {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

/** Files touched by an apply_patch envelope, with hunks as unified-diff-ish text. */
export function parsePatch(patch: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | null = null;
  for (const line of patch.split("\n")) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = { path: header[2]!.trim(), kind: header[1]!.toLowerCase() as FileChange["kind"], diff: "" };
      files.push(current);
      continue;
    }
    if (!current || /^\*\*\* (Begin|End) Patch/.test(line) || line === "*** End of File") continue;
    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move) current.movePath = move[1]!.trim();
    else current.diff += `${line}\n`;
  }
  return files;
}

function changesFrom(raw: Json): FileChange[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([p, c]: [string, Json]) => {
    const kind = (c?.type ?? Object.keys(c ?? {})[0] ?? "update") as FileChange["kind"];
    const body = c?.type ? c : c?.[kind] ?? {};
    const diff = kind === "add" || kind === "delete"
      ? String(body.content ?? "").replace(/\n$/, "").split("\n").map((l: string) => `${kind === "add" ? "+" : "-"}${l}`).join("\n")
      : String(body.unified_diff ?? "");
    return { path: p, kind, movePath: body.move_path ?? undefined, diff };
  });
}

export function parseCodexLines(lines: string[], file = "<memory>"): Session {
  const meta: SessionMeta = { sessionId: null, cwd: null, version: null, gitBranch: null, model: null, startedAt: null };
  const events: SessionEvent[] = [];
  const calls = new Map<string, ToolEvent>();
  let lastUser: { text: string; ts: number | null } | null = null;

  const pushUser = (text: string, ts: number | null) => {
    text = text.trim();
    if (!text) return;
    // legacy files can carry the same prompt as both an event and an item
    if (lastUser && lastUser.text === text && Math.abs((ts ?? 0) - (lastUser.ts ?? 0)) < 5000) return;
    lastUser = { text, ts };
    events.push({ kind: "user", text, ts });
  };

  const addCall = (id: string, name: string, input: Record<string, unknown>, ts: number | null) => {
    const ev: ToolEvent = { kind: "tool", id, name, input, result: null, ts, resultTs: null };
    calls.set(id, ev);
    events.push(ev);
    return ev;
  };

  const resolve = (id: string, ts: number | null, patch: (ev: ToolEvent) => void) => {
    const ev = calls.get(id);
    if (!ev) return;
    ev.result ??= { text: "", isError: false, data: {} };
    ev.resultTs = Math.max(ev.resultTs ?? 0, ts ?? 0) || ev.resultTs;
    patch(ev);
  };

  const execData = (ev: ToolEvent) => (ev.result!.data ??= {}) as unknown as Partial<ExecData>;

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Json;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : null;
    const p = rec.payload ?? {};

    switch (rec.type) {
      case "session_meta":
        meta.sessionId ??= p.id ?? p.session_id ?? null;
        meta.cwd ??= p.cwd ?? null;
        meta.version ??= p.cli_version ?? null;
        meta.gitBranch ??= p.git?.branch ?? null;
        meta.startedAt ??= p.timestamp ?? rec.timestamp ?? null;
        break;
      case "turn_context":
        meta.model ??= p.model ?? null;
        meta.effort ??= p.effort ?? p.reasoning_effort ?? null;
        break;
      case "compacted":
        events.push({ kind: "compacted", ts });
        break;
      case "response_item":
        switch (p.type) {
          case "message":
            if (p.role === "developer" && contentText(p.content).includes("<multi_agent_role>")) meta.subagents = true;
            if (p.role === "assistant") {
              const text = contentText(p.content).trim();
              if (text) events.push({ kind: "assistant", text, ts });
            }
            break;
          case "reasoning": {
            const summary = (p.summary ?? []).map((s: Json) => s?.text ?? "").join("\n\n").trim();
            events.push({ kind: "thinking", ts, durationMs: null, ...(summary ? { summary } : {}) });
            break;
          }
          case "function_call": {
            const args = parseJson(p.arguments);
            const ns = typeof p.namespace === "string" ? p.namespace : "";
            if (p.name === "exec_command" || p.name === "shell" || p.name === "container.exec") {
              const command = commandString(args.cmd ?? args.command);
              addCall(p.call_id, "exec_command", { command, workdir: args.workdir }, ts);
            } else if (ns.startsWith("mcp__")) {
              addCall(p.call_id, `${ns.replace(/__$/, "")}__${p.name}`, args, ts);
            } else {
              addCall(p.call_id, p.name, args, ts);
            }
            break;
          }
          case "local_shell_call":
            addCall(p.call_id ?? p.id, "exec_command", { command: commandString(p.action?.command) }, ts);
            break;
          case "custom_tool_call": {
            // code mode: a script that calls tools; the commands it runs arrive as their own items
            if (p.name === "exec") break;
            const input = String(p.input ?? "");
            // changes parsed from the patch itself stand in until a FileChange item arrives
            addCall(p.call_id, p.name, p.name === "apply_patch" ? { changes: parsePatch(input) } : { input }, ts);
            break;
          }
          case "web_search_call":
            addCall(p.id ?? `ws-${events.length}`, "web_search", { query: p.action?.query ?? p.action?.queries?.[0] ?? "" }, ts);
            break;
          case "function_call_output":
          case "custom_tool_call_output": {
            const text = outputText(p.output);
            resolve(p.call_id, ts, (ev) => {
              ev.result!.text = text;
              if (ev.name === "exec_command") {
                const d = execData(ev);
                const { exitCode, output } = splitExecOutput(text);
                d.exitCode ??= exitCode;
                d.output ??= output;
                ev.result!.isError = (d.exitCode ?? 0) !== 0;
              } else if (ev.name === "apply_patch") {
                ev.result!.isError = !/^Exit code: 0|Success\./m.test(text) && /error|failed/i.test(text);
              }
            });
            break;
          }
        }
        break;
      case "event_msg":
        switch (p.type) {
          case "user_message":
            pushUser(String(p.message ?? ""), ts);
            break;
          case "token_count": {
            const used = p.info?.last_token_usage?.total_tokens;
            const window = p.info?.model_context_window;
            if (typeof used === "number" && typeof window === "number") {
              events.push({ kind: "context", ts, percentLeft: percentLeft(used, window) });
            }
            break;
          }
          case "turn_aborted":
            if (p.reason === "interrupted" || !p.reason) events.push({ kind: "interrupted", ts });
            break;
          case "task_complete":
          case "turn_complete":
            events.push({ kind: "turn-end", ts, durationMs: typeof p.duration_ms === "number" ? p.duration_ms : null });
            break;
          case "patch_apply_end":
            resolve(p.call_id, ts, (ev) => {
              ev.result!.data = { ...(ev.result!.data ?? {}), changes: changesFrom(p.changes) };
              ev.result!.isError = p.success === false;
            });
            break;
          case "item_completed": {
            const item = p.item ?? {};
            if (item.type === "UserMessage") {
              pushUser(contentText(item.content), ts);
            } else if (item.type === "CommandExecution") {
              if (!calls.has(item.id)) {
                const start = typeof p.started_at_ms === "number" ? p.started_at_ms : ts;
                addCall(item.id, "exec_command", { command: commandString(item.command) }, start);
              }
              resolve(item.id, ts, (ev) => {
                const d = execData(ev);
                d.command = commandString(item.command) || String(ev.input.command ?? "");
                d.parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : [];
                d.exitCode = typeof item.exit_code === "number" ? item.exit_code : d.exitCode ?? null;
                d.output = typeof item.aggregated_output === "string" ? item.aggregated_output : d.output ?? "";
                d.declined = item.status === "declined";
                ev.result!.isError = (d.exitCode ?? 0) !== 0 || item.status === "failed";
              });
            } else if (item.type === "FileChange") {
              if (!calls.has(item.id)) {
                addCall(item.id, "apply_patch", { changes: [] }, typeof p.started_at_ms === "number" ? p.started_at_ms : ts);
              }
              resolve(item.id, ts, (ev) => {
                ev.result!.data = { ...(ev.result!.data ?? {}), changes: changesFrom(item.changes) };
                ev.result!.isError = item.status === "failed";
              });
            }
            break;
          }
        }
        break;
    }
  }

  for (const ev of calls.values()) {
    if (ev.name === "exec_command" && ev.result) {
      const d = execData(ev);
      d.command ??= String(ev.input.command ?? "");
      d.parsed ??= [];
      d.output ??= "";
      d.exitCode ??= null;
    }
  }
  return { agent: "codex", file, meta, events };
}

export function parseCodex(file: string): Session {
  return parseCodexLines(fs.readFileSync(file, "utf8").split("\n"), file);
}

/** Lines from the start of a file, read in chunks so a listing can stop early. */
function* headLines(file: string, maxBytes: number): Generator<string> {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    let carry = "";
    while (pos < maxBytes) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      const parts = (carry + buf.subarray(0, n).toString("utf8")).split("\n");
      carry = parts.pop()!;
      yield* parts;
    }
    if (carry) yield carry;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Cwd and first prompt from the start of a log, for listings. The cwd is on the first line, so
 * logs from other directories (`onlyCwd`) are skipped after reading just that.
 */
export function peekCodex(file: string, onlyCwd?: string): { cwd: string | null; firstPrompt: string | null } {
  let cwd: string | null = null;
  let first = true;
  for (const line of headLines(file, 4 * 1024 * 1024)) {
    if (first) {
      first = false;
      try {
        cwd = JSON.parse(line)?.payload?.cwd ?? null;
      } catch {
        return { cwd: null, firstPrompt: null };
      }
      if (onlyCwd != null && cwd !== onlyCwd) return { cwd, firstPrompt: null };
      continue;
    }
    // only parse the records that can carry the prompt
    if (!line.includes("\"user_message\"") && !line.includes("\"UserMessage\"")) continue;
    const ev = parseCodexLines([line]).events.find((e) => e.kind === "user");
    if (ev?.kind === "user") return { cwd, firstPrompt: ev.text };
  }
  return { cwd, firstPrompt: null };
}
