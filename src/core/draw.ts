// Pixel side: a terminal window on a backdrop, with rows drawn on a strict cell grid.
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { charWidth } from "./text.js";
import type { Row, Screen, Span, Theme } from "./types.js";

const FONT_STACK = [
  "\"JetBrains Mono\"",
  "\"SF Mono\"",
  "Menlo",
  "\"DejaVu Sans Mono\"",
  "\"Apple SD Gothic Neo\"",
  "\"Noto Sans Mono CJK KR\"",
  "\"Noto Sans CJK KR\"",
  "\"Malgun Gothic\"",
  "\"Apple Color Emoji\"",
  "\"Noto Color Emoji\"",
  "\"Apple Symbols\"",
  "\"Noto Sans Symbols 2\"",
  "monospace",
].join(", ");

let fontsLoaded = false;
function loadFonts(): void {
  if (fontsLoaded) return;
  const require = createRequire(import.meta.url);
  const dir = path.join(path.dirname(require.resolve("@fontsource/jetbrains-mono/package.json")), "files");
  for (const subset of ["latin", "latin-ext"]) {
    for (const weight of [400, 700]) {
      for (const style of ["normal", "italic"]) {
        GlobalFonts.registerFromPath(path.join(dir, `jetbrains-mono-${subset}-${weight}-${style}.woff2`), "JetBrains Mono");
      }
    }
  }
  fontsLoaded = true;
}

export interface RendererOptions {
  width: number;
  height: number;
  cols: number;
  rows: number;
  theme: Theme;
  title: string;
  /** Paint the gradient backdrop and window shadow (default). Off, the window sits on transparency. */
  backdrop?: boolean;
}

export interface Renderer {
  width: number;
  height: number;
  /** Where the terminal window sits in the frame, in pixels. */
  window: { x: number; y: number; w: number; h: number };
  render(screen: Screen, t: number): Canvas;
}

const BASE_FONT = 22;
const ROW_CACHE_LIMIT = 400;

export function createRenderer(opts: RendererOptions): Renderer {
  loadFonts();
  const { width, height, cols, rows, theme, title, backdrop = true } = opts;

  // Pick a font size that makes the window fill the frame, so text is drawn at native resolution.
  const layout = (fontSize: number) => {
    const probe = createCanvas(10, 10).getContext("2d");
    probe.font = `400 ${fontSize}px ${FONT_STACK}`;
    const u = fontSize / BASE_FONT;
    const cw = Math.round(probe.measureText("M").width * 100) / 100;
    const lh = Math.round(fontSize * 1.42);
    const padX = Math.round(26 * u);
    const padY = Math.round(18 * u);
    const bar = Math.round(40 * u);
    const termW = Math.ceil(cols * cw);
    const termH = rows * lh;
    return { fontSize, u, cw, lh, padX, padY, bar, termW, termH, winW: termW + padX * 2, winH: termH + padY * 2 + bar };
  };
  const marginX = width * 0.0625;
  const marginY = height * 0.083;
  const probe = layout(BASE_FONT);
  const fit = Math.min((width - marginX) / probe.winW, (height - marginY) / probe.winH);
  const L = layout(Math.max(8, Math.floor(BASE_FONT * fit * 10) / 10));
  const scale = Math.min(1, (width - marginX) / L.winW, (height - marginY) / L.winH);
  const winX = Math.round((width - L.winW * scale) / 2);
  const winY = Math.round((height - L.winH * scale) / 2);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const base = drawBackdrop({ width, height, theme, title, winX, winY, scale, L, backdrop });

  const cache = new Map<Row, Canvas>();
  function rowBitmap(row: Row, t: number): Canvas {
    const live = row.spans.some((s) => s.blink);
    const hit = !live && cache.get(row);
    if (hit) {
      cache.delete(row);
      cache.set(row, hit);
      return hit;
    }
    const c = createCanvas(L.termW, L.lh);
    drawRow(c.getContext("2d"), row, t);
    if (!live) {
      cache.set(row, c);
      if (cache.size > ROW_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return c;
  }

  // Lay a row's spans onto cells: [char, cell width, column, span].
  function layoutRow(row: Row): Array<[string, number, number, Span]> {
    const cells: Array<[string, number, number, Span]> = [];
    let col = 0;
    for (const sp of row.spans) {
      for (const ch of sp.t) {
        const w = charWidth(ch.codePointAt(0)!);
        if (w === 0) continue;
        if (col + w > cols + 2) return cells;
        cells.push([ch, w, col, sp]);
        col += w;
      }
    }
    return cells;
  }

  function drawRow(g: SKRSContext2D, row: Row, t: number): void {
    g.textBaseline = "middle";
    if (row.rowBg) {
      g.fillStyle = row.rowBg;
      g.fillRect(0, 0, L.termW, L.lh);
    }
    const cells = layoutRow(row);
    // backgrounds first, snapped to whole pixels, so they never cover a neighbouring glyph
    for (const [, w, col, sp] of cells) {
      if (!sp.bg) continue;
      const x0 = Math.round(col * L.cw);
      g.fillStyle = sp.bg;
      g.fillRect(x0, 0, Math.round((col + w) * L.cw) - x0, L.lh);
    }
    for (const [ch, w, col, sp] of cells) {
      const x = col * L.cw;
      const fg = sp.fg ?? theme.body;
      g.globalAlpha = sp.blink ? (Math.floor(t * 2.5) % 2 ? 0.25 : 1) : 1;
      if (ch !== " " && !drawVector(g, ch, x, L.cw, L.lh, fg, L.u)) {
        const size = w === 2 ? Math.round(L.fontSize * 1.08) : L.fontSize;
        g.font = `${sp.italic ? "italic " : ""}${sp.bold ? 700 : 400} ${size}px ${FONT_STACK}`;
        g.fillStyle = fg;
        const mw = g.measureText(ch).width;
        const target = w * L.cw;
        if (mw > target * 1.05) {
          // squeeze glyphs that would overflow their cells
          g.save();
          g.translate(x, 0);
          g.scale(target / mw, 1);
          g.fillText(ch, 0, L.lh / 2 + 1);
          g.restore();
        } else {
          g.fillText(ch, x + (target - mw) / 2, L.lh / 2 + 1);
        }
      }
      g.globalAlpha = 1;
      if (sp.strike) {
        g.fillStyle = fg;
        g.fillRect(x, Math.round(L.lh / 2), w * L.cw, 1.5 * L.u);
      }
      if (sp.underline) {
        g.fillStyle = fg;
        g.fillRect(x, L.lh - 5 * L.u, w * L.cw, 1.2 * L.u);
      }
    }
  }

  // Smooth scrolling: the viewport eases toward the bottom of the screen buffer.
  let scroll: number | null = null;
  let lastT = 0;
  function render(screen: Screen, t: number): Canvas {
    const dt = Math.max(0, t - lastT);
    lastT = t;
    const target = Math.max(0, screen.length - rows);
    if (scroll == null || target < scroll - rows) scroll = target;
    scroll += (target - scroll) * (1 - Math.exp(-dt * 16));
    if (Math.abs(target - scroll) < 0.01) scroll = target;

    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.translate(winX, winY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(L.padX - 4, L.bar + L.padY, L.termW + 8, L.termH);
    ctx.clip();
    const first = Math.floor(scroll);
    const frac = scroll - first;
    for (let i = 0; i <= rows; i++) {
      const row = screen.row(first + i);
      if (row && (row.spans.length || row.rowBg)) ctx.drawImage(rowBitmap(row, t), L.padX, L.bar + L.padY + (i - frac) * L.lh);
    }
    ctx.restore();
    return canvas;
  }

  return {
    width,
    height,
    window: { x: winX, y: winY, w: L.winW * scale, h: L.winH * scale },
    render,
  };
}

interface BackdropOptions {
  width: number;
  height: number;
  theme: Theme;
  title: string;
  winX: number;
  winY: number;
  scale: number;
  L: { u: number; winW: number; winH: number; bar: number };
  backdrop: boolean;
}

// Static backdrop and window chrome, drawn once per video.
function drawBackdrop({ width, height, theme, title, winX, winY, scale, L, backdrop }: BackdropOptions): Canvas {
  const base = createCanvas(width, height);
  const g = base.getContext("2d");
  if (backdrop) paintBackdrop(g, width, height, theme);
  drawWindow(g, theme, title, winX, winY, scale, L, backdrop);
  return base;
}

function paintBackdrop(g: SKRSContext2D, width: number, height: number, theme: Theme): void {
  const lg = g.createLinearGradient(0, 0, width, height);
  lg.addColorStop(0, mix(theme.accent, "#000000", 0.72));
  lg.addColorStop(0.55, "#1a1414");
  lg.addColorStop(1, "#0d0d10");
  g.fillStyle = lg;
  g.fillRect(0, 0, width, height);
  const rg = g.createRadialGradient(width * 0.18, height * 0.1, 0, width * 0.18, height * 0.1, width * 0.7);
  rg.addColorStop(0, withAlpha(theme.accent, 0.32));
  rg.addColorStop(1, withAlpha(theme.accent, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, width, height);
}

function drawWindow(g: SKRSContext2D, theme: Theme, title: string, winX: number, winY: number, scale: number, L: BackdropOptions["L"], shadow: boolean): void {
  const { u, winW, winH, bar } = L;
  const r = 12 * u;
  g.save();
  g.translate(winX, winY);
  g.scale(scale, scale);
  if (shadow) {
    g.shadowColor = "rgba(0,0,0,0.55)";
    g.shadowBlur = 60 * u;
    g.shadowOffsetY = 24 * u;
  }
  roundRect(g, 0, 0, winW, winH, r);
  g.fillStyle = theme.bg;
  g.fill();
  g.shadowColor = "transparent";
  g.save();
  roundRect(g, 0, 0, winW, bar, r, true);
  g.clip();
  g.fillStyle = "#26262a";
  g.fillRect(0, 0, winW, bar);
  g.restore();
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.fillRect(0, bar - 1, winW, 1);
  g.strokeStyle = "rgba(255,255,255,0.10)";
  g.lineWidth = 1;
  roundRect(g, 0.5, 0.5, winW - 1, winH - 1, r);
  g.stroke();
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    g.beginPath();
    g.arc((20 + i * 20) * u, bar / 2, 6 * u, 0, Math.PI * 2);
    g.fillStyle = c;
    g.fill();
  });
  g.font = `500 ${Math.round(13 * u)}px ${FONT_STACK}`;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title, winW / 2, bar / 2 + 1);
  g.restore();
}

// Quadrant block elements as [top-left, top-right, bottom-left, bottom-right].
const QUADRANTS: Record<string, [number, number, number, number]> = {
  "█": [1, 1, 1, 1],
  "▀": [1, 1, 0, 0],
  "▄": [0, 0, 1, 1],
  "▌": [1, 0, 1, 0],
  "▐": [0, 1, 0, 1],
  "▖": [0, 0, 1, 0],
  "▗": [0, 0, 0, 1],
  "▘": [1, 0, 0, 0],
  "▝": [0, 1, 0, 0],
  "▙": [1, 0, 1, 1],
  "▛": [1, 1, 1, 0],
  "▜": [1, 1, 0, 1],
  "▟": [0, 1, 1, 1],
  "▚": [1, 0, 0, 1],
  "▞": [0, 1, 1, 0],
};

// Box drawing and Claude Code's bullets drawn as vectors so they join seamlessly across cells.
function drawVector(g: SKRSContext2D, ch: string, x: number, cw: number, lh: number, fg: string, u: number): boolean {
  const xm = x + cw / 2;
  const ym = lh / 2;
  const quad = QUADRANTS[ch];
  if (quad) {
    g.fillStyle = fg;
    // snap edges to whole pixels so neighbouring cells meet without antialiased seams
    const xs = [Math.round(x), Math.round(x + cw / 2), Math.round(x + cw)];
    const ys = [0, Math.round(lh / 2), lh];
    quad.forEach((on, i) => {
      const cx = i % 2;
      const cy = Math.floor(i / 2);
      if (on) g.fillRect(xs[cx]!, ys[cy]!, xs[cx + 1]! - xs[cx]!, ys[cy + 1]! - ys[cy]!);
    });
    return true;
  }
  const code = ch.codePointAt(0)!;
  if (code > 0x2800 && code <= 0x28ff) {
    // Braille: dots 1-3 and 7 down the left column, 4-6 and 8 down the right
    const bits = code - 0x2800;
    const r = Math.max(0.6, cw * 0.11);
    g.fillStyle = fg;
    g.beginPath();
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]].forEach(([cx, cy], i) => {
      if (!(bits & (1 << i))) return;
      const px = x + cw * (cx ? 0.72 : 0.28);
      const py = lh * (0.125 + cy! * 0.25);
      g.moveTo(px + r, py);
      g.arc(px, py, r, 0, Math.PI * 2);
    });
    g.fill();
    return true;
  }
  const stroke = (draw: () => void) => {
    g.strokeStyle = fg;
    g.lineWidth = 1.4 * u;
    g.lineCap = "butt";
    g.beginPath();
    draw();
    g.stroke();
    return true;
  };
  switch (ch) {
    case "─":
      return stroke(() => {
        g.moveTo(x, ym);
        g.lineTo(x + cw + 0.5, ym);
      });
    case "│":
      return stroke(() => {
        g.moveTo(xm, 0);
        g.lineTo(xm, lh);
      });
    case "╭":
      return stroke(() => {
        g.moveTo(x + cw + 0.5, ym);
        g.arcTo(xm, ym, xm, lh, cw / 2);
        g.lineTo(xm, lh);
      });
    case "╮":
      return stroke(() => {
        g.moveTo(x, ym);
        g.arcTo(xm, ym, xm, lh, cw / 2);
        g.lineTo(xm, lh);
      });
    case "╰":
      return stroke(() => {
        g.moveTo(xm, 0);
        g.arcTo(xm, ym, x + cw, ym, cw / 2);
        g.lineTo(x + cw + 0.5, ym);
      });
    case "╯":
      return stroke(() => {
        g.moveTo(xm, 0);
        g.arcTo(xm, ym, x, ym, cw / 2);
        g.lineTo(x, ym);
      });
    case "⎿":
      return stroke(() => {
        g.moveTo(x + cw * 0.3, lh * 0.08);
        g.lineTo(x + cw * 0.3, lh * 0.58);
        g.lineTo(x + cw, lh * 0.58);
      });
    case "⏺":
      g.fillStyle = fg;
      g.beginPath();
      g.arc(xm, ym, cw * 0.36, 0, Math.PI * 2);
      g.fill();
      return true;
    case "┃":
      g.fillStyle = fg;
      g.fillRect(Math.round(xm - 1.4 * u), 0, Math.round(2.8 * u), lh);
      return true;
    case "◆":
    case "◈": {
      const diamond = (r: number) => {
        g.moveTo(xm, ym - r);
        g.lineTo(xm + r, ym);
        g.lineTo(xm, ym + r);
        g.lineTo(xm - r, ym);
        g.closePath();
      };
      const r = cw * 0.42;
      if (ch === "◆") {
        g.fillStyle = fg;
        g.beginPath();
        diamond(r);
        g.fill();
        return true;
      }
      // a diamond outline around a smaller solid one
      stroke(() => diamond(r));
      g.fillStyle = fg;
      g.beginPath();
      diamond(r * 0.45);
      g.fill();
      return true;
    }
    default:
      return false;
  }
}

function roundRect(g: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, topOnly = false): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  if (topOnly) {
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
  } else {
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
  }
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const withAlpha = (c: string, a: number) => `rgba(${hex(c).join(",")},${a})`;
function mix(a: string, b: string, k: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, "0")).join("")}`;
}
