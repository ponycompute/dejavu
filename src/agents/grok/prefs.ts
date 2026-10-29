// The local Grok install's display settings, so a replay looks like the user's own Grok:
// compact mode and the permission flag from config.toml, model display names from the models
// cache, and the installed version.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GrokPrefs {
  compact: boolean;
  /** Permission flag shown on the composer ("always-approve", "auto-review"); null for ask. */
  permission: string | null;
  version: string | null;
  modelNames: Record<string, string>;
  contextWindows: Record<string, number>;
}

export const grokHome = () => process.env.GROK_HOME ?? path.join(os.homedir(), ".grok");

const readText = (p: string) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const readJson = (p: string): any => {
  const text = readText(p);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** A top-level `key = value` inside `[section]` of a TOML file (strings and booleans only). */
function tomlValue(toml: string, section: string, key: string): string | boolean | null {
  let inSection = false;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inSection = line === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^([\w.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (m?.[1] !== key) continue;
    const v = m[2]!;
    if (v === "true" || v === "false") return v === "true";
    return v.replace(/^"(.*)"$/, "$1");
  }
  return null;
}

export function loadPrefs(): GrokPrefs {
  const home = grokHome();
  const toml = readText(path.join(home, "config.toml")) ?? "";
  const permission = tomlValue(toml, "ui", "permission_mode");
  const models = readJson(path.join(home, "models_cache.json"))?.models ?? {};
  const modelNames: Record<string, string> = {};
  const contextWindows: Record<string, number> = {};
  for (const [id, m] of Object.entries<any>(models)) {
    if (typeof m?.info?.name === "string") modelNames[id] = m.info.name;
    if (typeof m?.info?.context_window === "number") contextWindows[id] = m.info.context_window;
  }
  return {
    compact: tomlValue(toml, "ui", "compact_mode") === true,
    permission: typeof permission === "string" && permission !== "ask" ? permission : null,
    version: readJson(path.join(home, "version.json"))?.version ?? null,
    modelNames,
    contextWindows,
  };
}
