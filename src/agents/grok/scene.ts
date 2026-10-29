// Turns parsed Grok Build events into a timed scene. Grok is a full-screen TUI: every frame is
// laid out from the top (status bar) and the bottom (turn status, composer, shortcuts) inward,
// with the conversation filling the middle and sticking to its newest rows.
import { contentWidth, revealRows, spansWidth, strWidth, takeCells, padTo } from "../../core/text.js";
import { findLastIndex, Timeline } from "../../core/timeline.js";
import type { Row, Scene, SceneOptions, Session, SessionEvent, Span } from "../../core/types.js";
import { loadPrefs, type GrokPrefs } from "./prefs.js";
import * as ui from "./ui.js";

type ToolEvent = ui.ToolEvent;

interface Live {
  /** Still on the welcome screen (before the first prompt is sent). */
  welcome: boolean;
  input?: { text: string; upto: number };
  /** Rows below the committed conversation, redrawn each frame (they animate). */
  partial?: (t: number) => Row[];
  /** Turn-status label and when its phase started (timeline clock). */
  status?: { label: Span[]; at: number };
  /** Tokens in the context window, once a turn has reported usage. */
  context: number | null;
}

interface Busy {
  from: number;
  realStart: number | null;
}

interface Layout {
  hpad: number;
  top: number;
  statusGap: number;
  promptGap: number;
  shortcutsGap: number;
  bottom: number;
}

const layoutFor = (compact: boolean, height: number): Layout =>
  compact
    ? { hpad: 1, top: 0, statusGap: height > 20 ? 1 : 0, promptGap: 0, shortcutsGap: height > 20 ? 1 : 0, bottom: 0 }
    : { hpad: 2, top: 1, statusGap: 1, promptGap: 1, shortcutsGap: 1, bottom: 1 };

const blank = (): Row => ({ spans: [] });
const indent = (n: number, spans: Span[]): Row => ({ spans: [ui.S(" ".repeat(n)), ...spans] });

export function buildScene(session: Session, { cols, rows, speed }: SceneOptions, prefs: GrokPrefs = loadPrefs()): Scene {
  const { meta, events } = session;
  const height = rows ?? 28;
  const L = layoutFor(prefs.compact, height);
  const ew = cols - 2 * L.hpad;
  const tl = new Timeline<Live, Busy>(speed);
  const model = `${ui.modelName(meta.model, prefs.modelNames)}${meta.effort ? ` (${meta.effort})` : ""}`;
  const flags = prefs.permission ? [prefs.permission] : [];
  const window = (meta.model && prefs.contextWindows[meta.model]) || 256_000;

  const realMarks: Array<{ at: number; real: number }> = [];
  const mark = (real: number | null) => {
    if (real != null && (!realMarks.length || real >= realMarks[realMarks.length - 1]!.real)) {
      realMarks.push({ at: tl.clock, real });
    }
  };

  let welcome = true;
  let context: number | null = null;
  let status: Live["status"];
  let closeTurn: (() => void) | null = null;
  let turnStart: number | null = null;
  const live = (state: Partial<Live> = {}): Live => ({ welcome, status, context, ...state });
  const hold = (dur: number, state: Partial<Live> = {}) => {
    const s = live(state);
    tl.push(dur, () => s);
  };
  const setStatus = (label: Span[]) => {
    status = { label, at: tl.clock };
  };
  const ensureTurn = (ts: number | null) => {
    if (closeTurn) return;
    turnStart = ts;
    setStatus(ui.thinkingLabel());
    closeTurn = tl.open({ from: tl.clock, realStart: ts });
  };
  const endTurn = () => {
    closeTurn?.();
    closeTurn = null;
    status = undefined;
  };

  // consecutive collapsed rows stack without a gap; anything else gets one blank row around it
  let lastDense: boolean | null = null;
  const gapBefore = (dense: boolean) => lastDense !== null && !(lastDense && dense);
  const withGap = (rows: Row[], dense: boolean) => (gapBefore(dense) ? [blank(), ...rows] : rows);
  const commit = (rows: Row[], dense: boolean) => {
    tl.commit(withGap(rows, dense), false);
    lastDense = dense;
  };

  // reads, listings and searches fold into one group row until something else breaks the run
  let group: ui.GroupMember[] | null = null;
  // a run of commands alone stays as one "◆ Run" row each
  const groupView = (members: ui.GroupMember[], running: boolean, t: number) =>
    members.every((m) => m.kind === "command")
      ? members.flatMap((m, i) => ui.runRows(m.ev, ew, running && i === members.length - 1, t))
      : ui.groupRows(members, running, t);
  const groupPartial = (running: boolean) => {
    const members = group!;
    return (t: number) => withGap(groupView(members, running, t), true);
  };
  const flushGroup = () => {
    if (!group) return;
    commit(groupView(group, false, 0), true);
    group = null;
  };

  const playTool = (ev: ToolEvent) => {
    ensureTurn(ev.ts);
    const kind = ui.groupKind(ev);
    if (kind) {
      group = [...(group ?? []), ui.groupMember(ev, kind, meta.cwd)];
      if (kind === "command") setStatus(ui.runLabel(String((ev.input as Record<string, unknown>).command ?? "")));
      hold(kind === "command" ? 0.9 : 0.35, { partial: groupPartial(true) });
      mark(ev.resultTs);
      if (kind === "command") setStatus(ui.thinkingLabel());
      hold(0.12, { partial: groupPartial(false) });
      return;
    }
    if (ev.name === "todo_write" || ev.name === "TodoWrite") {
      // the plan lives in a pane of its own, not in the conversation
      mark(ev.resultTs);
      return;
    }
    flushGroup();
    switch (ev.name) {
      case "search_replace":
      case "edit":
      case "apply_patch":
      case "strreplace":
      case "write": {
        hold(0.5);
        mark(ev.resultTs);
        const done = ui.editRows(ev, ew, meta.cwd);
        commit(done, false);
        hold(Math.min(1.8, 0.5 + done.length * 0.05));
        break;
      }
      default: {
        hold(0.5, { partial: (t) => withGap(ui.otherRows(ev, ew, true, t), true) });
        mark(ev.resultTs);
        commit(ui.otherRows(ev, ew, false, 0), true);
        hold(0.3);
      }
    }
  };

  const play = (ev: SessionEvent) => {
    mark(ev.ts);
    if (ev.kind !== "tool" && ev.kind !== "thinking") flushGroup();
    switch (ev.kind) {
      case "user": {
        endTurn();
        const len = strWidth(ev.text);
        const s = live();
        tl.push(Math.min(2.4, Math.max(0.6, len / 38)), (p) => ({ ...s, input: { text: ev.text, upto: Math.ceil(p * len) } }));
        hold(0.45, { input: { text: ev.text, upto: len } });
        welcome = false;
        commit(ui.userRows(ev.text, ew, ev.ts, !prefs.compact), false);
        ensureTurn(ev.ts);
        hold(0.8);
        break;
      }
      case "assistant": {
        ensureTurn(ev.ts);
        setStatus(ui.respondingLabel());
        const done = ui.assistantRows(ev.text, ew, ev.ts);
        const total = contentWidth(done);
        const s = live();
        const before = group ? groupPartial(false) : null;
        tl.push(Math.min(3.0, Math.max(0.5, total / 110)), (p) => ({
          ...s,
          partial: () => [...(before?.(0) ?? []), ...withGap(revealRows(done, Math.ceil(p * total)), false)],
        }));
        commit(done, false);
        setStatus(ui.thinkingLabel());
        hold(0.35);
        break;
      }
      case "thinking": {
        ensureTurn(ev.ts);
        setStatus(ui.thinkingLabel());
        const text = ev.summary ?? "";
        const len = strWidth(text);
        const s = live();
        const sec = (ev.durationMs ?? 0) / 1000;
        const before = group ? groupPartial(false) : null;
        tl.push(Math.min(2.6, Math.max(0.6, sec * 0.25, len / 160)), (p) => ({
          ...s,
          partial: (t) => {
            const shown = takeCells([{ t: text }], Math.ceil(p * len))[0]?.t ?? "";
            const rows = ui.thinkingRows(shown, ew, true, null, t);
            // a streaming thought keeps its own rows below an open group
            return before ? [...before(t), blank(), ...rows] : withGap(rows, false);
          },
        }));
        // a finished thought inside a group run is folded into it; otherwise it stays as one row
        if (!group) commit(ui.thinkingRows(text, ew, false, ev.durationMs, 0), true);
        hold(0.25, group ? { partial: groupPartial(false) } : {});
        break;
      }
      case "tool":
        playTool(ev);
        break;
      case "notice":
        commit(ui.noticeRows(ev.text, ew), false);
        hold(0.3);
        break;
      case "turn-end": {
        if (ev.contextTokens) context = ev.contextTokens;
        const ms = ev.durationMs ?? (ev.ts != null && turnStart != null ? ev.ts - turnStart : null);
        endTurn();
        commit(ui.turnEndRows(ms != null ? ms / 1000 : null, ew), false);
        hold(0.5);
        break;
      }
      case "interrupted": {
        const ms = ev.ts != null && turnStart != null ? ev.ts - turnStart : null;
        endTurn();
        commit(ui.cancelledRows(ms != null ? ms / 1000 : null, ew), false);
        hold(0.8);
        break;
      }
      default:
        break;
    }
  };

  hold(1.2);
  for (const ev of events) play(ev);
  flushGroup();
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

  const composer = (state: Live, width: number, maxRows: number) => {
    const text = state.input ? takeCells([{ t: state.input.text }], state.input.upto)[0]?.t ?? "" : "";
    return {
      text,
      rows: ui.composerRows({ width, text, cursor: true, model, flags, maxRows }),
    };
  };

  function welcomeFrame(state: Live, t: number): Row[] {
    const margin = prefs.compact ? 1 : 2;
    const out: Row[] = Array.from({ length: height }, blank);
    const branch = meta.gitBranch ? [ui.S(`⎇ ${meta.gitBranch}`, { fg: ui.blend(ui.C.bg, ui.C.text, 0.5) }), ui.muted(" ")] : [];
    out[1] = indent(margin, [...branch, ui.dim(ui.shortCwd(meta.cwd))]);
    const contentH = height - 3;
    const promptX = prefs.compact ? 1 : 2;
    const { rows: box } = composer(state, cols - 2 * promptX, Math.floor(contentH / 2));
    const fixedBelow = 3 + 1 + 1;
    const promptTop = height - 3 - box.length;
    box.forEach((r, i) => (out[promptTop + i] = indent(promptX, r.spans)));
    const version = prefs.version ?? "";
    const hero = cols >= 90 && !prefs.compact && contentH >= 11 + fixedBelow + 1;
    if (hero) {
      const boxW = Math.min(cols - 6, 120);
      const x0 = Math.floor((cols - boxW) / 2);
      const y0 = 2 + Math.floor((contentH - 11 - fixedBelow) / 3);
      const rightW = boxW - 2 - 19;
      const menuW = rightW - 2;
      const border = (s: string) => ui.S(s, { fg: ui.C.heroBorder });
      const right: Span[][] = [
        [ui.S("Grok Build", { bold: true }), ...(version ? [ui.muted(`  ${version}`)] : [])],
        [ui.muted("Thanks for trying Grok Build, give feedback with /feedback!")],
        [],
        ...ui.MENU.map(([l, k]) => ui.menuRow(l, k, menuW)),
      ];
      out[y0] = indent(x0, [border(`╭${"─".repeat(boxW - 2)}╮`)]);
      for (let r = 1; r <= 9; r++) {
        const i = r - 2;
        const logo = i >= 0 && i < 7 ? ui.logoRow(ui.LOGO_FULL, i, t) : [];
        const line = [ui.S("  "), ...padTo(logo, 14), ui.S("   "), ...(i >= 0 && i < right.length ? right[i]! : [])];
        out[y0 + r] = indent(x0, [border("│"), ...padTo(takeCells(line, boxW - 2), boxW - 2), border("│")]);
      }
      out[y0 + 10] = indent(x0, [border(`╰${"─".repeat(boxW - 2)}╯`)]);
      return out;
    }
    const logo = contentH >= 26 ? ui.LOGO_FULL : contentH >= 22 ? ui.LOGO_COMPACT : [];
    const logoRows = logo.length ? logo.length + 1 : 0;
    let y = 2 + Math.max(0, Math.floor((contentH - logoRows - 4 - fixedBelow) / 3));
    logo.forEach((_, i) => {
      const w = [...logo[i]!].length;
      out[y++] = indent(Math.floor((cols - w) / 2), ui.logoRow(logo, i, t));
    });
    if (logo.length) y++;
    const inset = prefs.compact ? 0 : 2;
    const menuW = Math.min(51, cols - 2 * inset);
    for (const [l, k] of ui.MENU) {
      if (y >= promptTop - 1) break;
      out[y++] = indent(Math.floor((cols - menuW) / 2), ui.menuRow(l, k, menuW));
    }
    const badge = [ui.S("Grok Build", { bold: true }), ...(version ? [ui.muted(`  ${version}`)] : [])];
    out[height - 2] = indent(Math.max(0, cols - margin - spansWidth(badge)), badge);
    return out;
  }

  function frame(t: number) {
    const { state, range: busy, scrollback } = tl.sample(t);
    if (state.welcome) return tl.screen(0, welcomeFrame(state, t));

    // bottom pane, from the shortcuts bar up
    const bottom: Row[] = [];
    if (busy && state.status) {
      const now = realAt(t);
      const turnSec = busy.realStart != null && now != null ? (now - busy.realStart) / 1000 : (t - busy.from) * speed;
      const row = ui.turnStatusRow({ label: state.status.label, phaseSec: Math.max(0, (t - state.status.at) * speed), turnSec }, cols - 2 * L.hpad - 2, t);
      bottom.push(blank(), indent(L.hpad + 2, row));
    }
    for (let i = 0; i < L.promptGap; i++) bottom.push(blank());
    const { text, rows: box } = composer(state, cols - 2 * L.hpad, Math.floor(height / 2));
    bottom.push(...box.map((r) => indent(L.hpad, r.spans)));
    for (let i = 0; i < L.shortcutsGap; i++) bottom.push(blank());
    const hints: Array<[string, string]> = prefs.compact
      ? [["Ctrl+.", "shortcuts"]]
      : text
        ? [["Enter", busy ? "queue" : "send"], ["Shift+Enter/Opt+Enter", "newline"], ["Shift+Tab", "mode"], ["Ctrl+.", "shortcuts"]]
        : [["Shift+Tab", "mode"], ["Ctrl+.", "shortcuts"]];
    bottom.push(indent(L.hpad, ui.shortcutsBar(hints)));
    for (let i = 0; i < L.bottom; i++) bottom.push(blank());

    // top: the status bar
    const top: Row[] = [];
    for (let i = 0; i < L.top; i++) top.push(blank());
    top.push(indent(L.hpad, ui.statusBar(meta.gitBranch, meta.cwd, cols - 2 * L.hpad, state.context ? { used: state.context, total: window } : null)));
    for (let i = 0; i < L.statusGap; i++) top.push(blank());

    // the conversation in between, pinned to its newest rows
    const view = Math.max(1, height - top.length - bottom.length);
    const all = tl.screen(scrollback, [...(state.partial?.(t) ?? []), blank()]);
    const first = Math.max(0, all.length - view);
    const middle: Row[] = [];
    const overflow = all.length > view;
    const thumb = overflow ? Math.max(1, Math.round((view * view) / all.length)) : 0;
    for (let i = 0; i < view; i++) {
      const r = all.row(first + i);
      const spans = r ? [ui.S(" ".repeat(L.hpad)), ...r.spans] : [];
      if (!overflow) {
        middle.push({ spans });
        continue;
      }
      const bar = ui.S(" ", { bg: i >= view - thumb ? ui.C.bgLight : "#111111" });
      middle.push({ spans: [...padTo(spans, cols - 1), bar] });
    }
    return tl.screen(0, [...top, ...middle, ...bottom]);
  }

  return { duration: tl.duration, frame, title: ui.title(meta), theme: ui.theme };
}
