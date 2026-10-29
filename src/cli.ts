// dejavu — replay a coding-agent session as a video that looks exactly like the agent's own UI.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { AGENTS, agentById, detectAgent } from "./agents/index.js";
import { createRenderer } from "./core/draw.js";
import { encode } from "./core/encode.js";
import { countTurns, parseRange, selectTurns } from "./core/turns.js";
import type { Agent } from "./core/types.js";

const HELP = `Usage:
  dejavu [session] [options]     render a session to video
  dejavu list [dir]              list sessions recorded for a directory

[session] is a .jsonl log, a folder of logs, a project directory, or a session id (prefix).
With no session, uses the newest one recorded for the current directory.

Options:
  -o, --out <file>      output file: .mp4, .webm or .gif (default: dejavu-<session>.mp4)
  -s, --speed <x>       playback speed multiplier (default 1)
  -t, --turns <range>   only these prompts, e.g. 3, 2-5, 4- (default: all)
      --cols <n>        terminal width in columns (default 100)
      --rows <n>        terminal height in rows (default 28)
      --width <px>      video width (default 1920)
      --height <px>     video height (default 1080)
      --fps <n>         frames per second (default 30)
      --still <sec>     save a single PNG frame at that time instead of a video
      --agent <id>      force the agent (${AGENTS.map((a) => a.id).join(", ")})
  -h, --help            show this help`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    speed: { type: "string", short: "s", default: "1" },
    turns: { type: "string", short: "t" },
    cols: { type: "string", default: "100" },
    rows: { type: "string", default: "28" },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    fps: { type: "string", default: "30" },
    still: { type: "string" },
    agent: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

function num(name: string, value: string | undefined, min: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`--${name} must be a number ≥ ${min}`);
  return n;
}

const expand = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

function newestLog(dir: string): string | undefined {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function newestFor(cwd: string, agents: Agent[]): { file: string; agent: Agent } | undefined {
  return agents
    .flatMap((agent) => agent.sessionsFor(cwd).map((s) => ({ ...s, agent })))
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())[0];
}

function resolveInput(arg: string | undefined, forced: Agent | undefined): { file: string; agent: Agent } {
  const agents = forced ? [forced] : AGENTS;
  if (!arg) {
    const found = newestFor(process.cwd(), agents);
    if (!found) throw new Error(`No sessions recorded for ${process.cwd()} — pass a session file`);
    return found;
  }
  const p = expand(arg);
  if (fs.existsSync(p)) {
    if (fs.statSync(p).isFile()) return { file: p, agent: forced ?? detectAgent(p) };
    const log = newestLog(p);
    if (log) return { file: log, agent: forced ?? detectAgent(log) };
    const found = newestFor(p, agents);
    if (found) return found;
    throw new Error(`No sessions found in or for ${arg}`);
  }
  // a session id or prefix, looked up among this directory's sessions
  const matches = agents.flatMap((agent) =>
    agent.sessionsFor(process.cwd()).filter((s) => s.id.startsWith(arg)).map((s) => ({ file: s.file, agent })));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`"${arg}" matches ${matches.length} sessions — use more of the id`);
  throw new Error(`Not found: ${arg}`);
}

function list(dir: string): void {
  const sessions = AGENTS.flatMap((agent) => agent.sessionsFor(dir).map((s) => ({ ...s, agent })))
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  if (!sessions.length) {
    console.log(`No sessions recorded for ${dir}`);
    return;
  }
  for (const s of sessions) {
    const when = s.modifiedAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    const prompt = (s.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 70);
    console.log(`${s.id.slice(0, 8)}  ${when.padEnd(18)}  ${s.agent.name.padEnd(12)}  ${prompt}`);
  }
}

async function main(): Promise<void> {
  if (opt.help) {
    console.log(HELP);
    return;
  }
  if (positionals[0] === "list") {
    list(positionals[1] ? expand(positionals[1]) : process.cwd());
    return;
  }

  const cols = num("cols", opt.cols, 40);
  const rows = num("rows", opt.rows, 10);
  const fps = num("fps", opt.fps, 1);
  const speed = num("speed", opt.speed, 0.05);
  // H.264 and VP9 in yuv420p need even dimensions; a still can be any size
  const even = (n: number) => (opt.still == null ? Math.floor(n / 2) * 2 : Math.floor(n));
  const width = even(num("width", opt.width, 320));
  const height = even(num("height", opt.height, 240));

  const { file, agent } = resolveInput(positionals[0], opt.agent ? agentById(opt.agent) : undefined);
  const session = agent.parse(file);
  if (opt.turns) {
    const [from, to] = parseRange(opt.turns);
    const total = countTurns(session.events);
    if (from > total) throw new Error(`Session has ${total} turn${total === 1 ? "" : "s"}; --turns ${opt.turns} selects none`);
    session.events = selectTurns(session.events, from, to);
  }
  if (!session.events.length) throw new Error(`Nothing to replay in ${file}`);

  const scene = agent.buildScene(session, { cols, rows, speed });
  const renderer = createRenderer({ width, height, cols, rows, theme: scene.theme, title: scene.title });
  const id = (session.meta.sessionId ?? path.basename(file, ".jsonl")).slice(0, 8);

  if (opt.still != null) {
    const t = Math.min(num("still", opt.still, 0), scene.duration - 0.01);
    for (let s = Math.max(0, t - 2); s < t; s += 1 / fps) renderer.render(scene.frame(s), s); // let scrolling settle
    const out = opt.out ?? `dejavu-${id}-${t.toFixed(1)}s.png`;
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, await renderer.render(scene.frame(t), t).encode("png"));
    console.log(`✻ ${out}`);
    return;
  }

  const out = opt.out ?? `dejavu-${id}.mp4`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  console.log(`✻ ${agent.name} · ${path.basename(file)} · ${session.events.length} events → ${formatTime(scene.duration)} video`);
  let lastPct = -1;
  const started = Date.now();
  const res = await encode({
    scene,
    renderer,
    fps,
    out,
    onProgress: (f, total) => {
      const pct = Math.floor((f / total) * 100);
      if (pct !== lastPct && process.stdout.isTTY) {
        process.stdout.write(`\r  rendering ${pct}%`);
        lastPct = pct;
      }
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  console.log(`✻ ${out} (${formatTime(res.seconds)}, ${res.frames} frames, took ${formatTime((Date.now() - started) / 1000)})`);
}

function formatTime(sec: number): string {
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

main().catch((e: Error) => {
  console.error(`dejavu: ${e.message}`);
  process.exit(1);
});
