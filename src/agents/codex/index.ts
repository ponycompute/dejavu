import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Agent, SessionSummary } from "../../core/types.js";
import { parseCodex, peekCodex } from "./parse.js";
import { buildScene } from "./scene.js";

const home = () => process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");

/** Every rollout file under sessions/YYYY/MM/DD (and archived_sessions). */
function rolloutFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(home(), "sessions"), 0);
  walk(path.join(home(), "archived_sessions"), 0);
  return files;
}

/** The name Codex gave a thread, from session_index.jsonl (the last entry wins). */
function threadName(id: string | null): string | null {
  const index = path.join(home(), "session_index.jsonl");
  if (!id || !fs.existsSync(index)) return null;
  let name: string | null = null;
  for (const line of fs.readFileSync(index, "utf8").split("\n")) {
    if (!line.includes(id)) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.id === id && typeof rec.thread_name === "string") name = rec.thread_name;
    } catch {
      // skip partial lines
    }
  }
  return name;
}

export const codex: Agent = {
  id: "codex",
  name: "Codex",

  detect(file) {
    if (/(^|\/)rollout-[^/]*\.jsonl$/.test(file)) return true;
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(16 * 1024);
      const first = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8").split("\n")[0] ?? "";
      return /^\{.*"type"\s*:\s*"session_meta"/.test(first) && first.includes("\"payload\"");
    } finally {
      fs.closeSync(fd);
    }
  },

  sessionsFor(cwd) {
    const out: SessionSummary[] = [];
    for (const file of rolloutFiles()) {
      const { cwd: sessionCwd, firstPrompt } = peekCodex(file, cwd);
      if (sessionCwd !== cwd || !firstPrompt) continue;
      const id = path.basename(file, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f-]{27,})(?:_[^_]+)?$/)?.[1] ?? path.basename(file, ".jsonl");
      out.push({ file, id, modifiedAt: fs.statSync(file).mtime, firstPrompt });
    }
    return out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  },

  parse(file) {
    const session = parseCodex(file);
    session.meta.title ??= threadName(session.meta.sessionId);
    return session;
  },
  buildScene,
};
