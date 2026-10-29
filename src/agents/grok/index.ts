import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Agent, SessionSummary } from "../../core/types.js";
import { parseGrok, peekGrok, updatesFile } from "./parse.js";
import { buildScene } from "./scene.js";

const home = () => process.env.GROK_HOME ?? path.join(os.homedir(), ".grok");

/** Grok groups sessions by URL-encoded cwd; very long paths use a slug plus a `.cwd` file. */
function groupDirFor(cwd: string): string | null {
  const root = path.join(home(), "sessions");
  const direct = path.join(root, encodeURIComponent(cwd));
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(root)) return null;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const marker = path.join(root, e.name, ".cwd");
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === cwd) return path.join(root, e.name);
  }
  return null;
}

export const grok: Agent = {
  id: "grok",
  name: "Grok Build",

  detect(file) {
    const updates = updatesFile(file);
    if (!fs.existsSync(updates) || !fs.existsSync(path.join(path.dirname(updates), "summary.json"))) return false;
    const fd = fs.openSync(updates, "r");
    try {
      const buf = Buffer.alloc(4096);
      const head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
      return head.length === 0 || /"(?:_x\.ai\/)?session\/update"/.test(head);
    } finally {
      fs.closeSync(fd);
    }
  },

  sessionsFor(cwd) {
    const group = groupDirFor(cwd);
    if (!group) return [];
    const out: SessionSummary[] = [];
    for (const e of fs.readdirSync(group, { withFileTypes: true })) {
      const dir = path.join(group, e.name);
      const file = path.join(dir, "updates.jsonl");
      if (!e.isDirectory() || !fs.existsSync(file)) continue;
      const { firstPrompt } = peekGrok(dir);
      if (!firstPrompt) continue;
      out.push({ file, id: e.name, modifiedAt: fs.statSync(file).mtime, firstPrompt });
    }
    return out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  },

  parse: parseGrok,
  buildScene,
};
