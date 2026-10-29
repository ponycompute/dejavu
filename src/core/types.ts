// Shared model between agents and the renderer.
// An agent turns its log into a Session, then into a Scene: for any time t, which rows are on
// screen. The core only knows how to draw rows of styled cells and encode frames.

export interface Span {
  t: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** Pulses on and off; rows with a blinking span are redrawn every frame. */
  blink?: boolean;
}

export interface Row {
  spans: Span[];
  /** Background painted across the full terminal width. */
  rowBg?: string;
  /** Number of leading spans that are gutter (bullets, indents) rather than content. */
  prefix?: number;
}

/** What the terminal shows at one instant. Rows are virtual so long sessions stay cheap. */
export interface Screen {
  length: number;
  row(i: number): Row | undefined;
}

export interface Theme {
  bg: string;
  body: string;
  /** Backdrop gradient tint behind the window. */
  accent: string;
}

export interface Scene {
  duration: number;
  title: string;
  theme: Theme;
  frame(t: number): Screen;
}

export interface SceneOptions {
  cols: number;
  /** Terminal height; agents with a full-screen UI pin their bottom pane to it. */
  rows?: number;
  speed: number;
}

export interface SessionMeta {
  sessionId: string | null;
  cwd: string | null;
  version: string | null;
  gitBranch: string | null;
  model: string | null;
  /** Reasoning effort the session was configured with, when the agent records one. */
  effort?: string | null;
  /** Name the agent gave the conversation ("Analyze project"). */
  title?: string | null;
  /** The agent ran with subagents available. */
  subagents?: boolean;
  startedAt: string | null;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  data: Record<string, unknown> | null;
}

/** Output tokens of the model message an event opens; set on the first event of each message. */
interface Generated {
  tokens?: number;
}

export type SessionEvent =
  | { kind: "user"; text: string; ts: number | null; command?: boolean }
  | ({ kind: "assistant"; text: string; ts: number | null } & Generated)
  | ({ kind: "thinking"; ts: number | null; durationMs: number | null; summary?: string } & Generated)
  | ({
    kind: "tool";
    id: string;
    name: string;
    input: Record<string, unknown>;
    result: ToolResult | null;
    ts: number | null;
    resultTs: number | null;
  } & Generated)
  | { kind: "command-output"; text: string; ts: number | null }
  | { kind: "interrupted"; ts: number | null }
  | { kind: "compacted"; ts: number | null }
  | { kind: "turn-end"; ts: number | null; durationMs: number | null; contextTokens?: number }
  /** A one-line system message in the transcript (e.g. a failed hook). */
  | { kind: "notice"; text: string; ts: number | null }
  /** How much of the model's context window is left, in percent. */
  | { kind: "context"; ts: number | null; percentLeft: number };

export interface Session {
  agent: string;
  file: string;
  meta: SessionMeta;
  events: SessionEvent[];
}

export interface SessionSummary {
  file: string;
  id: string;
  modifiedAt: Date;
  firstPrompt: string | null;
}

export interface Agent {
  id: string;
  name: string;
  /** True when this file looks like one of this agent's session logs. */
  detect(file: string): boolean;
  /** Sessions recorded for a working directory, newest first. */
  sessionsFor(cwd: string): SessionSummary[];
  parse(file: string): Session;
  buildScene(session: Session, opts: SceneOptions): Scene;
}
