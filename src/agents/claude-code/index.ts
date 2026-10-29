import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Agent } from "../../core/types.js";
import { firstPrompt, parseClaudeCode } from "./parse.js";
import { buildScene } from "./scene.js";

const home = () => path.join(os.homedir(), ".claude", "projects");

/** Claude Code keys a project's sessions by its cwd with every non-alphanumeric turned into "-". */
export const projectDirName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

export const claudeCode: Agent = {
  id: "claude-code",
  name: "Claude Code",

  detect(file) {
    if (file.includes(`${path.sep}.claude${path.sep}projects${path.sep}`)) return true;
    const head = readHead(file, 64 * 1024);
    return head.split("\n").some((line) => {
      try {
        const rec = JSON.parse(line);
        return (rec.type === "user" || rec.type === "assistant") && rec.message && "sessionId" in rec;
      } catch {
        return false;
      }
    });
  },

  sessionsFor(cwd) {
    const dir = path.join(home(), projectDirName(cwd));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const file = path.join(dir, f);
        return { file, id: path.basename(f, ".jsonl"), modifiedAt: fs.statSync(file).mtime, firstPrompt: null as string | null };
      })
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
      .map((s) => ({ ...s, firstPrompt: firstPrompt(s.file) }))
      .filter((s) => s.firstPrompt != null);
  },

  parse: parseClaudeCode,
  buildScene,
};

function readHead(file: string, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, fs.readSync(fd, buf, 0, bytes, 0)).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
