# Dejavu

Turn a coding-agent session into a video that looks exactly like the agent's own terminal UI —
Carbon, but for agent sessions.

Dejavu doesn't record your screen. It reads the session log the agent already keeps on disk and
redraws every frame — prompt typing, streamed replies, tool calls, diffs, todos, the spinner — on
a pixel-exact cell grid, then encodes an MP4. So you can:

- make a video of a session that ended days ago
- pick the window size, playback speed and resolution after the fact
- keep everything on your machine — nothing is uploaded anywhere

## Usage

```bash
npm install && npm run build
npm link                      # puts `dejavu` on your PATH

cd ~/dev/my-project
dejavu list                   # sessions recorded for this directory
dejavu                        # newest session → dejavu-<id>.mp4
dejavu 7c1e2f4a               # a session by id (prefix)
dejavu 7c1e2f4a --turns 2-3 --speed 1.5 -o demo.mp4
dejavu 7c1e2f4a --width 1080 --height 1920 --cols 56 --rows 44   # vertical
dejavu ~/.claude/projects/-Users-me-dev-my-project/<id>.jsonl --still 12   # one PNG at 12s
```

Requires Node 20+ and `ffmpeg` (`brew install ffmpeg`).

| Option | Default | |
|---|---|---|
| `-o, --out` | `dejavu-<session>.mp4` | output file; `.mp4`, `.webm` or `.gif` |
| `-s, --speed` | `1` | playback speed |
| `-t, --turns` | all | only these prompts: `3`, `2-5`, `4-` |
| `--cols` / `--rows` | `100` / `28` | terminal size in cells |
| `--width` / `--height` | `1920` / `1080` | video resolution; text is drawn at native size |
| `--fps` | `30` | frame rate |
| `--still <sec>` | | export a single PNG frame instead of a video |
| `--agent <id>` | auto | force the agent when detection can't tell |

Pacing is reconstructed rather than real-time (a 40-minute session doesn't become a 40-minute
video), but the spinner shows the real elapsed time of each turn from the log's timestamps.

## Agents

| Agent | Session logs | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/<cwd>/<id>.jsonl` | ✅ |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | ✅ |
| Grok Build | `~/.grok/sessions/<cwd>/<id>/updates.jsonl` | ✅ |

## How it works

```
session log ─▶ agents/<agent>/parse.ts   normalized events (prompt, reply, thinking, tool + result)
            ─▶ agents/<agent>/scene.ts   timeline: what is on screen at time t
            ─▶ agents/<agent>/ui.ts      the agent's UI as rows of styled cells
               core/highlight.ts         syntax colors for code blocks, diffs and commands
            ─▶ core/draw.ts              cells → pixels (window chrome, smooth scroll)
            ─▶ core/encode.ts            frames → ffmpeg → mp4
```

Adding an agent means implementing the `Agent` interface in `src/core/types.ts` (detect, list
sessions, parse, build a scene) and registering it in `src/agents/index.ts`. Text layout, the
timeline, drawing and encoding are shared.

## Development

```bash
npm run dev -- list           # run from source
npm test
npm run typecheck
npm run sample                # render fixtures/claude-code-sample.jsonl → out/sample.mp4
```
