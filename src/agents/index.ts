// Supported agents. Adding one means writing its own parse, scene and UI under agents/<id>/;
// drawing and encoding are shared.
import type { Agent } from "../core/types.js";
import { claudeCode } from "./claude-code/index.js";
import { codex } from "./codex/index.js";
import { grok } from "./grok/index.js";

export const AGENTS: Agent[] = [claudeCode, codex, grok];

export function agentById(id: string): Agent {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent "${id}" (supported: ${AGENTS.map((a) => a.id).join(", ")})`);
  return agent;
}

export function detectAgent(file: string): Agent {
  const agent = AGENTS.find((a) => a.detect(file));
  if (!agent) throw new Error(`Can't tell which agent wrote ${file} — pass --agent`);
  return agent;
}
