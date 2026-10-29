// Turns parsed Codex events into a timed scene: for any time t, which rows are on screen.
import { contentWidth, revealRows, strWidth, takeCells } from "../../core/text.js";
import { findLastIndex, Timeline } from "../../core/timeline.js";
import type { Row, Scene, SceneOptions, Session, SessionEvent } from "../../core/types.js";
import { idleLogo } from "./logo.js";
import * as ui from "./ui.js";

type ToolEvent = ui.ToolEvent;

interface Live {
  input?: { text: string; upto: number };
  partial?: Row[];
  header: string;
  headerAt: number;
  /** A prompt has been sent, so the thread has a name. */
  named: boolean;
}

interface Busy {
  from: number;
  realStart: number | null;
}

// The status row takes its header from the first bold phrase of the latest reasoning summary.
const summaryHeader = (summary: string | undefined) => summary?.match(/\*\*([^*\n]+)\*\*/)?.[1]?.trim();

export function buildScene(session: Session, { cols, rows: height, speed }: SceneOptions): Scene {
  const { meta, events } = session;
  const cwd = meta.cwd;
  const intro = [...ui.headerRows(meta, cols), { spans: [] }];
  const tl = new Timeline<Live, Busy>(speed, intro);

  const realMarks: Array<{ at: number; real: number }> = [];
  const mark = (real: number | null) => {
    if (real != null && (!realMarks.length || real >= realMarks[realMarks.length - 1]!.real)) {
      realMarks.push({ at: tl.clock, real });
    }
  };

  let header = "Working";
  let headerAt = 0;
  let named = false;
  let turnStart: number | null = null;
  let closeTurn: (() => void) | null = null;
  const live = (state: Partial<Live> = {}): Live => ({ header, headerAt, named, ...state });
  const hold = (dur: number, state: Partial<Live> = {}) => {
    const s = live(state);
    tl.push(dur, () => s);
  };
  const setHeader = (h: string) => {
    if (h === header) return;
    header = h;
    headerAt = tl.clock;
  };
  const ensureTurn = (ts: number | null) => {
    if (closeTurn) return;
    turnStart = ts;
    setHeader("Working");
    closeTurn = tl.open({ from: tl.clock, realStart: ts });
  };
  const endTurn = () => {
    closeTurn?.();
    closeTurn = null;
  };

  // consecutive read/search/list commands share one "Explored" cell
  let exploring: ui.ExploreStep[] | null = null;
  const flushExplore = () => {
    if (!exploring) return;
    tl.commit(ui.exploreRows(exploring, cols, false));
    exploring = null;
    hold(0.3);
  };

  const playTool = (ev: ToolEvent) => {
    ensureTurn(ev.ts);
    const steps = ui.exploreSteps(ev, cwd);
    if (steps) {
      exploring = [...(exploring ?? []), ...steps];
      hold(0.5, { partial: ui.exploreRows(exploring, cols, true) });
      mark(ev.resultTs);
      return;
    }
    flushExplore();
    let running: Row[];
    let done: Row[];
    switch (ev.name) {
      case "exec_command":
        running = ui.execRows(ev, cols, true);
        done = ui.execRows(ev, cols, false);
        break;
      case "apply_patch":
        running = [];
        done = ui.patchRows(ev, cols, cwd, false);
        break;
      case "update_plan":
        running = [];
        done = ui.planRows(ev, cols);
        break;
      default:
        running = ui.callRows(ev, cols, true);
        done = ui.callRows(ev, cols, false);
    }
    if (running.length) hold(ev.name === "exec_command" ? 0.9 : 0.55, { partial: running });
    mark(ev.resultTs);
    tl.commit(done);
    hold(Math.min(1.8, 0.45 + done.length * 0.05));
  };

  const play = (ev: SessionEvent) => {
    mark(ev.ts);
    if (ev.kind !== "tool" && ev.kind !== "thinking" && ev.kind !== "context") flushExplore();
    switch (ev.kind) {
      case "user": {
        endTurn();
        const len = strWidth(ev.text);
        const s = live();
        tl.push(Math.min(2.4, Math.max(0.6, len / 38)), (p) => ({ ...s, input: { text: ev.text, upto: Math.ceil(p * len) } }));
        hold(0.45, { input: { text: ev.text, upto: len } });
        tl.commit(ui.userRows(ev.text, cols));
        named = true;
        ensureTurn(ev.ts);
        hold(0.9);
        break;
      }
      case "assistant": {
        ensureTurn(ev.ts);
        const rows = ui.assistantRows(ev.text, cols, cwd);
        const total = contentWidth(rows);
        const s = live();
        tl.push(Math.min(3.0, Math.max(0.5, total / 110)), (p) => ({ ...s, partial: revealRows(rows, Math.ceil(p * total)) }));
        tl.commit(rows);
        hold(0.35);
        break;
      }
      case "thinking": {
        ensureTurn(ev.ts);
        const h = summaryHeader(ev.summary);
        if (h) setHeader(h);
        hold(0.6, exploring ? { partial: ui.exploreRows(exploring, cols, true) } : {});
        break;
      }
      case "tool":
        playTool(ev);
        break;
      case "context":
        break;
      case "turn-end": {
        const ms = ev.durationMs ?? (ev.ts != null && turnStart != null ? ev.ts - turnStart : null);
        endTurn();
        if (ms != null) {
          tl.commit(ui.workedForRows(ms, ev.ts, cols));
          hold(0.5);
        }
        break;
      }
      case "interrupted":
        endTurn();
        tl.commit(ui.interruptedRows(cols));
        hold(0.8);
        break;
      case "compacted":
        tl.commit(ui.compactedRows(cols));
        hold(1.0);
        break;
      case "command-output":
        break;
    }
  };

  hold(1.0);
  for (const ev of events) play(ev);
  flushExplore();
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
    // the bottom pane (status + composer) stays pinned to the bottom of the screen
    const pane: Row[] = [];
    if (busy) {
      const now = realAt(t);
      const elapsed = busy.realStart != null && now != null ? (now - busy.realStart) / 1000 : (t - busy.from) * speed;
      pane.push(ui.statusRow(state.header, elapsed, t, t - state.headerAt), { spans: [] });
    }
    const typed = state.input ? takeCells([{ t: state.input.text }], state.input.upto)[0]?.t ?? "" : "";
    pane.push(...ui.composerRows(typed, cols, t, !!busy, state.named, meta));
    const gap = height ? height - scrollback - rows.length - pane.length : 0;
    for (let i = 0; i < gap; i++) rows.push({ spans: [] });
    // an empty conversation shows the faded Codex mark, centered, until the composer has text
    if (height && !typed && !busy && !state.partial?.length && scrollback === intro.length) {
      const logo = idleLogo(cols, height, ui.theme.bg);
      if (logo && logo.top >= scrollback && logo.top + logo.rows.length <= height - pane.length) {
        logo.rows.forEach((spans, r) => {
          rows[logo.top - scrollback + r] = { spans: [{ t: " ".repeat(logo.left) }, ...spans] };
        });
      }
    }
    rows.push(...pane);
    return tl.screen(scrollback, rows);
  }

  return { duration: tl.duration, frame, title: ui.title(meta), theme: ui.theme };
}
