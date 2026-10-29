// Grok Build session → normalized events.
// Sessions live at ~/.grok/sessions/<url-encoded cwd>/<session id>/. updates.jsonl is the ACP
// session-update stream that Grok itself replays on /resume: one
// {timestamp (unix seconds), method: "_x.ai/session/update", params: {update}} record per line.
// summary.json holds the metadata (cwd, model, title).
import fs from "node:fs";
import path from "node:path";
import type { Session, SessionEvent, SessionMeta } from "../../core/types.js";

type Json = any; // raw log records are loosely shaped
type ToolEvent = Extract<SessionEvent, { kind: "tool" }>;

/** The updates.jsonl for any file or directory inside a session. */
export function updatesFile(p: string): string {
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return path.join(p, "updates.jsonl");
  return path.join(path.dirname(p), "updates.jsonl");
}

function readSummary(dir: string): Json {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  } catch {
    return {};
  }
}

const textOf = (content: Json): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join("\n");
  if (content.type === "text" && typeof content.text === "string") return content.text;
  if (content.type === "content") return textOf(content.content);
  if (content.type === "diff") return "";
  return "";
};

export interface GrokDiff {
  path: string;
  oldText: string;
  newText: string;
  /** First line of the edited region in the old file, when the edit metadata records it. */
  line: number | null;
}

// Edits arrive as ACP diff content: the replaced snippet and its replacement.
function diffsOf(content: Json): GrokDiff[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((c: Json) => c?.type === "diff" && typeof c.newText === "string")
    .map((c: Json) => {
      const meta = c._meta ?? {};
      const line = [meta.old_line, meta.start_line, meta.line, meta.edits?.[0]?.old_line, meta.edits?.[0]?.start_line]
        .find((v) => typeof v === "number");
      return { path: String(c.path ?? ""), oldText: c.oldText ?? "", newText: c.newText, line: line ?? null };
    });
}

export function parseGrokLines(lines: string[], summary: Json = {}, file = "<memory>"): Session {
  const meta: SessionMeta = {
    sessionId: summary.info?.id ?? null,
    cwd: summary.info?.cwd ?? null,
    version: null,
    gitBranch: summary.head_branch ?? null,
    model: summary.current_model_id ?? null,
    effort: summary.reasoning_effort ?? null,
    title: summary.generated_title ?? summary.session_summary ?? null,
    startedAt: summary.created_at ?? null,
  };
  const events: SessionEvent[] = [];
  const calls = new Map<string, ToolEvent>();
  let lastTs: number | null = null;
  // the context in use, from the token count the agent stamps on its updates
  let contextTokens: number | null = null;
  // streamed chunks of one kind accumulate until another update arrives
  let open: { kind: "user" | "assistant" | "thinking"; text: string; ts: number | null; start: number | null; last: number | null } | null = null;
  // a thought lasts from the model's stream start to its last chunk
  const flush = (end: number | null) => {
    if (!open) return;
    const text = open.text.trim();
    if (open.kind === "thinking") {
      const last = open.last ?? end;
      const durationMs = last != null && open.start != null ? last - open.start : null;
      events.push({ kind: "thinking", ts: open.ts, durationMs, ...(text ? { summary: text } : {}) });
    }
    else if (text) events.push({ kind: open.kind, text, ts: open.ts });
    open = null;
  };
  const chunk = (kind: "user" | "assistant" | "thinking", text: string, ts: number | null, start: number | null) => {
    if (open?.kind !== kind) {
      flush(ts);
      open = { kind, text: "", ts, start: start ?? ts, last: null };
    }
    open!.text += text;
    open!.last = ts;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Json;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const u = rec.params?.update;
    if (!u) continue;
    // newer logs stamp each update in milliseconds; the record's own timestamp is whole seconds
    const m = rec.params?._meta ?? {};
    const ts = typeof m.agentTimestampMs === "number" ? m.agentTimestampMs : typeof rec.timestamp === "number" ? rec.timestamp * 1000 : null;
    // without a stream start, a thought is taken to begin when the previous update landed
    const start = typeof m.streamStartMs === "number" ? m.streamStartMs : lastTs;
    lastTs = ts ?? lastTs;
    if (typeof m.totalTokens === "number") contextTokens = m.totalTokens;
    meta.sessionId ??= rec.params?.sessionId ?? null;
    switch (u.sessionUpdate) {
      case "user_message_chunk":
        chunk("user", textOf(u.content), ts, start);
        break;
      case "agent_message_chunk":
        chunk("assistant", textOf(u.content), ts, start);
        break;
      case "agent_thought_chunk":
        chunk("thinking", textOf(u.content), ts, start);
        break;
      case "tool_call": {
        flush(ts);
        const tool = u._meta?.["x.ai/tool"] ?? {};
        const ev: ToolEvent = {
          kind: "tool",
          id: u.toolCallId,
          name: tool.name ?? u.title ?? "tool",
          input: { ...(u.rawInput ?? {}), title: u.title, label: tool.label, toolKind: tool.kind },
          result: null,
          ts,
          resultTs: null,
        };
        calls.set(u.toolCallId, ev);
        events.push(ev);
        break;
      }
      case "tool_call_update": {
        const ev = calls.get(u.toolCallId);
        if (!ev) break;
        // in-progress updates refine the call: a display title, its kind, the typed input
        if (u.title) ev.input.title = u.title;
        if (u.kind) ev.input.kind = u.kind;
        if (u.rawInput) ev.input = { ...ev.input, ...u.rawInput };
        if (Array.isArray(u.locations) && u.locations.length) ev.input.locations = u.locations.map((l: Json) => l.path);
        const diffs = diffsOf(u.content);
        if (diffs.length) ev.input.diffs = diffs;
        const status = u.status;
        if (status === "completed" || status === "failed") {
          const text = textOf(u.content);
          ev.result = {
            text: text || (typeof u.rawOutput?.Content?.content === "string" ? u.rawOutput.Content.content : ""),
            isError: status === "failed",
            data: u.rawOutput && typeof u.rawOutput === "object" ? u.rawOutput : {},
          };
          ev.resultTs = ts;
        } else if (u.content && !ev.input.description) {
          const text = textOf(u.content);
          if (text) ev.input.description = text;
        }
        break;
      }
      case "turn_completed": {
        flush(ts);
        if (u.stop_reason === "cancelled") events.push({ kind: "interrupted", ts });
        else events.push({ kind: "turn-end", ts, durationMs: typeof u.elapsed_ms === "number" ? u.elapsed_ms : null, ...(contextTokens ? { contextTokens } : {}) });
        break;
      }
      case "hook_execution":
        // Grok prints one line per failed hook; successful runs leave no trace
        for (const run of u.runs ?? []) {
          if (run?.status?.status !== "failed") continue;
          flush(ts);
          const source = String(run.name ?? "").split(":")[0];
          const subject = source ? `${u.event_name} hook (${source})` : `${u.event_name} hook`;
          const error = run.status.error ? `: ${run.status.error}` : "";
          events.push({ kind: "notice", text: `${subject} failed, ignored${error}`, ts });
        }
        break;
    }
  }
  flush(lastTs);
  return { agent: "grok", file, meta, events };
}

export function parseGrok(file: string): Session {
  const updates = updatesFile(file);
  const lines = fs.readFileSync(updates, "utf8").split("\n");
  return parseGrokLines(lines, readSummary(path.dirname(updates)), updates);
}

/** Cwd, title and first prompt of a session directory, for listings. */
export function peekGrok(dir: string): { cwd: string | null; title: string | null; firstPrompt: string | null } {
  const summary = readSummary(dir);
  let firstPrompt: string | null = null;
  try {
    const fd = fs.openSync(path.join(dir, "updates.jsonl"), "r");
    try {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      // the first prompt is the opening run of user chunks
      const lines = buf.subarray(0, n).toString("utf8").split("\n");
      const start = lines.findIndex((l) => l.includes("\"user_message_chunk\""));
      const end = lines.findIndex((l, i) => i > start && l.trim() && !l.includes("\"user_message_chunk\""));
      const ev = start < 0 ? undefined : parseGrokLines(lines.slice(start, end < 0 ? undefined : end)).events.find((e) => e.kind === "user");
      if (ev?.kind === "user") firstPrompt = ev.text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // no updates yet
  }
  return { cwd: summary.info?.cwd ?? null, title: summary.generated_title ?? null, firstPrompt };
}
