// Turns parsed Claude Code events into a timed scene: for any time t, which rows are on screen.
import { contentWidth, revealRows, strWidth, takeCells } from "../../core/text.js";
import { findLastIndex, Timeline } from "../../core/timeline.js";
import type { Row, Scene, SceneOptions, Session, SessionEvent } from "../../core/types.js";
import * as ui from "./ui.js";
import { VERBS } from "./verbs.js";

type ToolEvent = ui.ToolEvent;
type ThinkingEvent = Extract<SessionEvent, { kind: "thinking" }>;

interface Live {
  input?: { text: string; upto: number };
  partial?: Row[];
  mode?: ui.SpinnerMode;
  thinking?: boolean;
  tokens?: number;
  activeForm?: string;
}

interface Busy {
  verb: string;
  from: number;
  realStart: number | null;
}

// A run of read/search tools (with the thinking and todo updates between them) that Claude Code
// folds into one summary line.
type Item =
  | { kind: "event"; ev: SessionEvent }
  | { kind: "group"; members: Array<ToolEvent | ThinkingEvent> };

const MAX_THOUGHT_MS = 60_000;

function groupItems(events: SessionEvent[]): Item[] {
  const items: Item[] = [];
  let run: Array<ToolEvent | ThinkingEvent> = [];
  const flush = () => {
    if (run.some((m) => m.kind === "tool")) items.push({ kind: "group", members: run });
    else items.push(...run.map((ev) => ({ kind: "event" as const, ev })));
    run = [];
  };
  for (const ev of events) {
    const member = ev.kind === "thinking" || (ev.kind === "tool" && (ui.isCollapsible(ev) || ui.isAbsorbed(ev)));
    if (member) {
      run.push(ev as ToolEvent | ThinkingEvent);
      continue;
    }
    // thinking that leads into something else stays outside the group
    const trailing: ThinkingEvent[] = [];
    while (run.length && run[run.length - 1]!.kind === "thinking") trailing.unshift(run.pop() as ThinkingEvent);
    flush();
    items.push(...trailing.map((t) => ({ kind: "event" as const, ev: t })));
    items.push({ kind: "event", ev });
  }
  flush();
  return items;
}

/** Deterministic per-session pick, so the same session always renders the same video. */
function pick<T>(items: T[], seed: string): T {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return items[(h >>> 0) % items.length]!;
}

export function buildScene(session: Session, { cols, speed }: SceneOptions): Scene {
  const { meta, events } = session;
  const header = ui.headerRows(meta, cols);
  const tl = new Timeline<Live, Busy>(speed, [...header, { spans: [] }]);

  // Real timestamps pinned to video time, so the spinner shows how long the turn really took.
  const realMarks: Array<{ at: number; real: number }> = [];
  const mark = (real: number | null) => {
    if (real != null && (!realMarks.length || real >= realMarks[realMarks.length - 1]!.real)) {
      realMarks.push({ at: tl.clock, real });
    }
  };

  let turn = 0;
  let tokens = 0;
  let activeForm: string | undefined;
  let closeTurn: (() => void) | null = null;
  const openTurn = (realStart: number | null) => {
    tokens = 0;
    const verb = pick(VERBS, `${meta.sessionId ?? session.file}:${turn++}`);
    closeTurn = tl.open({ verb, from: tl.clock, realStart });
  };
  const endTurn = () => {
    closeTurn?.();
    closeTurn = null;
  };
  const ensureTurn = (ev: SessionEvent) => {
    if (!closeTurn) openTurn(ev.ts);
    if ("tokens" in ev && ev.tokens) tokens += ev.tokens;
  };
  // every live state carries the spinner's context at that moment
  const live = (state: Live = {}): Live => ({ mode: "responding", tokens, activeForm, ...state });
  const hold = (dur: number, state: Live = {}) => {
    const s = live(state);
    tl.push(dur, () => s);
  };
  const noteTodos = (ev: ToolEvent) => {
    if (ev.name !== "TodoWrite") return;
    const todos = (ev.input as { todos?: Array<{ status?: string; activeForm?: string }> }).todos ?? [];
    activeForm = todos.find((t) => t.status === "in_progress")?.activeForm;
  };

  const playEvent = (ev: SessionEvent) => {
    mark(ev.ts);
    switch (ev.kind) {
      case "user": {
        endTurn();
        activeForm = undefined;
        const len = strWidth(ev.text);
        tl.push(Math.min(2.4, Math.max(0.6, len / 38)), (p) => ({ input: { text: ev.text, upto: Math.ceil(p * len) } }));
        hold(0.45, { input: { text: ev.text, upto: len } });
        tl.commit(ui.userRows(ev.text, cols, ev.command));
        if (ev.command) {
          hold(0.4);
        } else {
          openTurn(ev.ts);
          hold(0.9, { mode: "requesting" });
        }
        break;
      }
      case "assistant": {
        ensureTurn(ev);
        const rows = ui.assistantRows(ev.text, cols);
        const total = contentWidth(rows);
        const s = live();
        tl.push(Math.min(3.0, Math.max(0.5, total / 110)), (p) => ({ ...s, partial: revealRows(rows, Math.ceil(p * total)) }));
        tl.commit(rows);
        hold(0.35);
        break;
      }
      case "thinking": {
        // hidden in Claude Code's normal view; only the spinner says so
        ensureTurn(ev);
        hold(0.8, { thinking: true });
        break;
      }
      case "tool": {
        ensureTurn(ev);
        noteTodos(ev);
        const running = ui.toolRows(ev, cols, meta.cwd, "running");
        hold(ev.name === "Bash" ? 0.9 : 0.55, { partial: running, mode: "tool" });
        mark(ev.resultTs);
        const done = ui.toolRows(ev, cols, meta.cwd, "done");
        if (done.length) {
          tl.commit(done);
          hold(Math.min(1.8, 0.45 + done.length * 0.05));
        }
        break;
      }
      case "command-output":
        tl.commit(ui.commandOutputRows(ev.text, cols));
        hold(0.6);
        break;
      case "interrupted":
        tl.commit(ui.interruptedRows(cols));
        endTurn();
        hold(0.8);
        break;
      case "compacted":
        endTurn();
        tl.commit(ui.compactedRows(cols));
        hold(1.0);
        break;
    }
  };

  const playGroup = (members: Array<ToolEvent | ThinkingEvent>) => {
    const group: ui.Group = { tools: [], thoughtMs: 0 };
    const snapshot = () => ({ tools: [...group.tools], thoughtMs: group.thoughtMs });
    members.forEach((m, i) => {
      mark(m.ts);
      ensureTurn(m);
      if (m.kind === "thinking") {
        const next = members[i + 1]?.ts;
        const gap = next != null && m.ts != null ? next - m.ts : 0;
        group.thoughtMs += Math.min(m.durationMs ?? gap, MAX_THOUGHT_MS);
        hold(0.5, { thinking: true, partial: ui.groupRows(snapshot(), cols, meta.cwd, true) });
        return;
      }
      noteTodos(m);
      group.tools.push(m);
      if (ui.isAbsorbed(m)) return;
      hold(0.45, { mode: "tool", partial: ui.groupRows(snapshot(), cols, meta.cwd, true) });
      mark(m.resultTs);
    });
    const done = ui.groupRows(group, cols, meta.cwd, false);
    if (done.length) {
      tl.commit(done);
      hold(0.5);
    }
  };

  hold(1.0);
  for (const item of groupItems(events)) {
    if (item.kind === "group") playGroup(item.members);
    else playEvent(item.ev);
  }
  endTurn();
  hold(3.0);

  const realAt = (t: number): number | null => {
    const i = findLastIndex(realMarks, (m) => m.at <= t);
    if (i < 0) return null;
    const a = realMarks[i]!;
    const b = realMarks[i + 1];
    if (!b || b.at === a.at) return a.real;
    return a.real + ((t - a.at) / (b.at - a.at)) * (b.real - a.real);
  };

  function frame(t: number) {
    const { state, range: busy, scrollback } = tl.sample(t);
    const rows: Row[] = [];
    if (state.partial?.length) rows.push(...state.partial, { spans: [] });
    if (busy) {
      const now = realAt(t);
      const elapsedSec = busy.realStart != null && now != null ? (now - busy.realStart) / 1000 : (t - busy.from) * speed;
      rows.push(ui.spinnerRow({
        verb: state.activeForm ?? busy.verb,
        mode: state.mode ?? "responding",
        elapsedSec,
        tokens: state.tokens ?? 0,
        thinking: !!state.thinking,
      }, t), { spans: [] });
    }
    const typed = state.input ? takeCells([{ t: state.input.text }], state.input.upto)[0]?.t ?? "" : "";
    rows.push(...ui.inputRows(typed, cols, t, meta, !!busy));
    return tl.screen(scrollback, rows);
  }

  return { duration: tl.duration, frame, title: ui.title(meta), theme: ui.theme };
}
