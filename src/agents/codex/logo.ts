// The blossom mark Codex draws on an empty conversation: the Codex/OpenAI logo as a lit 3D
// surface, rasterized into Braille dots. Ported from openai/codex (Apache-2.0),
// codex-rs/tui/src/empty_state_animation/{paths,geometry,lighting,renderer,sequence}.rs.
// Dejavu only needs the settled, faded pose shown behind an empty composer.
import type { Span } from "../../core/types.js";

const CODEX: [string, [number, number, number, number]] = [
  "M16.585 10C16.585 6.3632 13.6368 3.41504 10 3.41504C6.3632 3.41504 3.41504 6.3632 3.41504 10C3.41504 13.6368 6.3632 16.585 10 16.585C13.6368 16.585 16.585 13.6368 16.585 10ZM13.333 11.418L13.4678 11.4316C13.7705 11.4938 13.9979 11.7619 13.998 12.083C13.998 12.4042 13.7706 12.6722 13.4678 12.7344L13.333 12.748H10.833C10.4659 12.7479 10.168 12.4502 10.168 12.083C10.1681 11.716 10.466 11.4181 10.833 11.418H13.333ZM7.65332 12.4258C7.46427 12.7404 7.05603 12.8422 6.74121 12.6533C6.42642 12.4644 6.32391 12.0561 6.5127 11.7412L7.65332 12.4258ZM8.90332 9.6582C9.02956 9.86872 9.02956 10.1313 8.90332 10.3418L7.65332 12.4258L7.08301 12.083L6.5127 11.7412L7.55664 10L6.5127 8.25879L7.08301 7.91699L7.65332 7.57422L8.90332 9.6582ZM6.74121 7.34668C7.05603 7.15779 7.46427 7.25955 7.65332 7.57422L6.5127 8.25879C6.32391 7.94392 6.42642 7.53563 6.74121 7.34668ZM17.915 10C17.915 14.3713 14.3713 17.915 10 17.915C5.62867 17.915 2.08496 14.3713 2.08496 10C2.08496 5.62867 5.62867 2.08496 10 2.08496C14.3713 2.08496 17.915 5.62867 17.915 10Z",
  [2.08496, 2.08496, 17.915, 17.915],
];
const OPENAI: [string, [number, number, number, number]] = [
  "M11.6475 18.3409C11.0975 18.3409 10.575 18.2364 10.08 18.0274C9.58502 17.8184 9.14502 17.5269 8.76002 17.1529C8.34202 17.2959 7.90751 17.3674 7.45651 17.3674C6.71951 17.3674 6.03751 17.1859 5.41051 16.8229C4.78351 16.4599 4.27751 15.9649 3.89251 15.3379C3.51851 14.7109 3.33151 14.0124 3.33151 13.2424C3.33151 12.9234 3.37551 12.5769 3.46351 12.2029C3.02351 11.7959 2.68251 11.3284 2.44051 10.8004C2.19851 10.2614 2.07751 9.70044 2.07751 9.11744C2.07751 8.52344 2.20401 7.95144 2.45701 7.40144C2.71001 6.85144 3.06201 6.37844 3.51301 5.98244C3.97501 5.57544 4.50851 5.29494 5.11351 5.14094C5.23451 4.51394 5.48751 3.95294 5.87251 3.45794C6.26851 2.95194 6.75252 2.55594 7.32452 2.26994C7.89652 1.98394 8.50702 1.84094 9.15602 1.84094C9.70602 1.84094 10.2285 1.94544 10.7235 2.15444C11.2185 2.36344 11.6585 2.65494 12.0435 3.02894C12.4615 2.88594 12.896 2.81444 13.347 2.81444C14.084 2.81444 14.766 2.99594 15.393 3.35894C16.02 3.72194 16.5205 4.21694 16.8945 4.84394C17.2795 5.47094 17.472 6.16944 17.472 6.93944C17.472 7.25844 17.428 7.60494 17.34 7.97894C17.78 8.38594 18.121 8.85894 18.363 9.39794C18.605 9.92594 18.726 10.4814 18.726 11.0644C18.726 11.6584 18.5995 12.2304 18.3465 12.7804C18.0935 13.3304 17.736 13.8089 17.274 14.2159C16.823 14.6119 16.295 14.8869 15.69 15.0409C15.569 15.6679 15.3105 16.2289 14.9145 16.7239C14.5295 17.2299 14.051 17.6259 13.479 17.9119C12.907 18.1979 12.2965 18.3409 11.6475 18.3409ZM7.57201 16.2784C8.12201 16.2784 8.60051 16.1629 9.00751 15.9319L12.1095 14.1499C12.2195 14.0729 12.2745 13.9684 12.2745 13.8364V12.4174L8.28152 14.7109C8.03952 14.8539 7.79751 14.8539 7.55552 14.7109L4.43701 12.9124C4.43701 12.9454 4.43151 12.9839 4.42051 13.0279C4.42051 13.0719 4.42051 13.1379 4.42051 13.2259C4.42051 13.7869 4.55252 14.3039 4.81651 14.7769C5.09152 15.2389 5.47101 15.6019 5.95501 15.8659C6.43901 16.1409 6.97801 16.2784 7.57201 16.2784ZM7.73701 13.5889C7.80301 13.6219 7.86351 13.6384 7.91851 13.6384C7.97351 13.6384 8.02852 13.6219 8.08352 13.5889L9.32101 12.8794L5.34451 10.5694C5.10251 10.4264 4.98151 10.2119 4.98151 9.92594V6.34544C4.43151 6.58744 3.99151 6.96144 3.66151 7.46744C3.33151 7.96244 3.16651 8.51244 3.16651 9.11744C3.16651 9.65644 3.30401 10.1734 3.57901 10.6684C3.85401 11.1634 4.21151 11.5374 4.65151 11.7904L7.73701 13.5889ZM11.6475 17.2519C12.2305 17.2519 12.7585 17.1199 13.2315 16.8559C13.7045 16.5919 14.0785 16.2289 14.3535 15.7669C14.6285 15.3049 14.766 14.7879 14.766 14.2159V10.6519C14.766 10.5199 14.711 10.4209 14.601 10.3549L13.347 9.62894V14.2324C13.347 14.5184 13.226 14.7329 12.984 14.8759L9.86551 16.6744C10.4045 17.0594 10.9985 17.2519 11.6475 17.2519ZM12.2745 11.2129V8.96894L10.41 7.91294L8.52902 8.96894V11.2129L10.41 12.2689L12.2745 11.2129ZM7.45651 5.94944C7.45651 5.66344 7.57752 5.44894 7.81952 5.30594L10.938 3.50744C10.399 3.12244 9.80502 2.92994 9.15602 2.92994C8.57302 2.92994 8.04501 3.06194 7.57201 3.32594C7.09902 3.58994 6.72502 3.95294 6.45002 4.41494C6.18602 4.87694 6.05401 5.39394 6.05401 5.96594V9.51344C6.05401 9.64544 6.10901 9.74994 6.21902 9.82694L7.45651 10.5529V5.94944ZM15.8385 13.8364C16.3885 13.5944 16.823 13.2204 17.142 12.7144C17.472 12.2084 17.637 11.6584 17.637 11.0644C17.637 10.5254 17.4995 10.0084 17.2245 9.51344C16.9495 9.01844 16.592 8.64444 16.152 8.39144L13.0665 6.60944C13.0005 6.56544 12.94 6.54894 12.885 6.55994C12.83 6.55994 12.775 6.57644 12.72 6.60944L11.4825 7.30244L15.4755 9.62894C15.5965 9.69494 15.6845 9.78294 15.7395 9.89294C15.8055 9.99194 15.8385 10.1129 15.8385 10.2559V13.8364ZM12.522 5.45444C12.764 5.30044 13.006 5.30044 13.248 5.45444L16.383 7.28594C16.383 7.20894 16.383 7.10994 16.383 6.98894C16.383 6.46094 16.251 5.96044 15.987 5.48744C15.734 5.00344 15.3655 4.61844 14.8815 4.33244C14.4085 4.04644 13.8585 3.90344 13.2315 3.90344C12.6815 3.90344 12.203 4.01894 11.796 4.24994L8.69402 6.03194C8.58402 6.10894 8.52902 6.21344 8.52902 6.34544V7.76444L12.522 5.45444Z",
  [2.07751, 1.84094, 18.726, 18.3409],
];

// --- geometry: signed distance fields of the two marks ----------------------------------------

const GRID = 160;
const EXTENT = 1.08;
const STEP = (EXTENT * 2) / (GRID - 1);

type P = [number, number];

function field([d, bounds]: [string, [number, number, number, number]]): Float32Array {
  const tokens = d.match(/[MLHVCZ]|-?(?:\d+\.?\d*|\.\d+)/g)!;
  let k = 0;
  const num = () => Number(tokens[k++]);
  const pt = (): P => [num(), num()];
  let point: P = [0, 0];
  let start: P = point;
  const segments: Array<[P, P]> = [];
  while (k < tokens.length) {
    const cmd = tokens[k++]!;
    let next: P;
    if (cmd === "M") {
      point = pt();
      start = point;
      continue;
    } else if (cmd === "L") next = pt();
    else if (cmd === "H") next = [num(), point[1]];
    else if (cmd === "V") next = [point[0], num()];
    else if (cmd === "Z") next = start;
    else if (cmd === "C") {
      const origin = point;
      const a = pt();
      const b = pt();
      const end = pt();
      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        const u = 1 - t;
        const n = [0, 1].map((i) => u ** 3 * origin[i]! + 3 * u * u * t * a[i]! + 3 * u * t * t * b[i]! + t ** 3 * end[i]!) as P;
        segments.push([point, n]);
        point = n;
      }
      continue;
    } else throw new Error(`unexpected path command ${cmd}`);
    segments.push([point, next]);
    point = next;
  }
  const scale = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2;
  const norm = segments.map(([a, b]) =>
    [a, b].map((p) => [0, 1].map((axis) => (p[axis]! - (bounds[axis]! + bounds[axis + 2]!) / 2) / scale) as P) as [P, P]);

  const inside = new Uint8Array(GRID * GRID);
  for (let row = 0; row < GRID; row++) {
    const y = row * STEP - EXTENT;
    const crossings = norm
      .filter(([a, b]) => (a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
      .map(([a, b]): [number, number] => [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1])
      .sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    let winding = 0;
    for (let column = 0; column < GRID; column++) {
      const x = column * STEP - EXTENT;
      while (cursor < crossings.length && crossings[cursor]![0] <= x) winding += crossings[cursor++]![1];
      inside[row * GRID + column] = winding !== 0 ? 1 : 0;
    }
  }
  const distance = new Float32Array(GRID * GRID).fill(GRID);
  for (let row = 1; row < GRID - 1; row++) {
    for (let column = 1; column < GRID - 1; column++) {
      const i = row * GRID + column;
      if ([i - 1, i + 1, i - GRID, i + GRID].some((j) => inside[i] !== inside[j])) distance[i] = 0.5;
    }
  }
  for (const reverse of [false, true]) {
    for (let row = 1; row < GRID - 1; row++) {
      for (let column = 1; column < GRID - 1; column++) {
        const i = reverse ? (GRID - 1 - row) * GRID + GRID - 1 - column : row * GRID + column;
        const neighbors = reverse ? [i + 1, i + GRID, i + GRID - 1, i + GRID + 1] : [i - 1, i - GRID, i - GRID - 1, i - GRID + 1];
        const steps = [1, 1, Math.SQRT2, Math.SQRT2];
        let d = distance[i]!;
        neighbors.forEach((j, n) => {
          d = Math.min(d, distance[j]! + steps[n]!);
        });
        distance[i] = d;
      }
    }
  }
  for (let i = 0; i < distance.length; i++) distance[i] = distance[i]! * STEP * (inside[i] ? 1 : -1);
  return distance;
}

// --- lighting: fixed studio lights for a dark terminal ----------------------------------------

const LIGHT = {
  key: [210, 221, 235],
  shadow: [52, 71, 105],
  fill: [76, 118, 159],
  rim: [91, 196, 216],
  highlight: [255, 244, 218],
};

function shade(bg: number[], [nx, ny, nz]: number[], depth: number, grain: number): number[] {
  const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const diffuse = clamp(nx! * -0.41 + ny! * -0.564 + nz! * 0.718 + grain);
  const bounce = clamp(nx! * 0.55 + ny! * 0.2 - nz! * 0.35) * (1 - diffuse) * 0.38;
  const edge = (1 - Math.abs(clamp(nz!, -1, 1))) ** 2.4 * clamp(nx! * 0.85 - ny! * 0.38) * 0.82;
  const gloss = clamp(nx! * -0.22 + ny! * -0.302 + nz! * 0.928) ** 18 * 0.96;
  const base = (1 - bounce) * (1 - edge) * (1 - gloss);
  const gain = clamp(0.9 + depth * 0.18, 0.68, 1);
  return [0, 1, 2].map((i) => {
    const value = LIGHT.shadow[i]! * (1 - diffuse) * base
      + LIGHT.key[i]! * diffuse * base
      + LIGHT.fill[i]! * bounce * (1 - edge) * (1 - gloss)
      + LIGHT.rim[i]! * edge * (1 - gloss)
      + LIGHT.highlight[i]! * gloss;
    return Math.round(bg[i]! + (value - bg[i]!) * gain);
  });
}

// --- renderer: project the surface and rasterize into Braille cells ---------------------------

const MAX_COLUMNS = 60;
const STAGE_ROWS = 21;
const MIN_STAGE_ROWS = 14;
const DOT_BITS = [1, 8, 2, 16, 4, 32, 64, 128];
const HALF_DEPTH = 0.1642880353482906;
const WOBBLE = 0.11242630996974184;
const GRAIN_PHASE = 3.8990964158506114;
// the idle pose (half a loop) at the faded opacity Codex leaves it at
const SETTLED = 0.5;
const STATIC_OPACITY = 0.18;

const smooth = (v: number) => {
  const t = Math.min(1, Math.max(0, v));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

let fields: [Float32Array, Float32Array] | null = null;

/** Braille cells (dots + color) of the mark at `phase`, `columns` × `rows`. */
function frame(columns: number, rows: number, phase: number, bg: number[]): Array<{ dots: number; rgb: number[] }> {
  fields ??= [field(CODEX), field(OPENAI)];
  phase = ((phase % 1) + 1) % 1;
  const second = phase >= 0.5 ? 1 : 0;
  const spin = smooth((phase * 2 - second) / 0.82);
  const morph = smooth((spin - 2 / 3) * 3);
  const rotation = (second + spin) * Math.PI * 2;
  const blend = second === 1 ? 1 - morph : morph;
  const wob = Math.sin(rotation) * WOBBLE;
  const [sx, cx] = [Math.sin(wob), Math.cos(wob)];
  const [sy, cy] = [Math.sin(rotation), Math.cos(rotation)];
  const tilt = Math.sin(phase * Math.PI * 2) * 0.045;
  const [sz, cz] = [Math.sin(tilt), Math.cos(tilt)];
  const bevel = 0.075 + blend * 0.012;
  const dotColumns = columns * 2;
  const dotRows = rows * 4;
  const dotWidth = 800 / dotColumns;
  const dotHeight = 550 / dotRows;
  const depth = new Float32Array(dotColumns * dotRows).fill(-Infinity);
  const colors: number[][] = new Array(dotColumns * dotRows);
  const shape = new Float32Array(GRID * GRID);
  for (let i = 0; i < shape.length; i++) shape[i] = fields[0][i]! * (1 - blend) + fields[1][i]! * blend;

  const project = ([x, y, z]: number[], [nx, ny, nz]: number[]) => {
    const u = x! * 2.2 + y! * 0.7;
    const v = y! * 2.8 - x! * 0.4;
    const zz = z! + Math.sin(u) * 0.075 + Math.sin(v) * 0.04;
    let mx = nx! - nz! * (Math.cos(u) * 0.165 - Math.cos(v) * 0.016);
    let my = ny! - nz! * (Math.cos(u) * 0.0525 + Math.cos(v) * 0.112);
    let mz = nz!;
    const len = Math.hypot(mx, my, mz) || 1;
    mx /= len;
    my /= len;
    mz /= len;
    const x1 = x! * cy + zz * sy;
    const z1 = -x! * sy + zz * cy;
    const y2 = y! * cx - z1 * sx;
    const z2 = y! * sx + z1 * cx;
    const x3 = x1 * cz - y2 * sz;
    const y3 = x1 * sz + y2 * cz;
    const perspective = 4.4 / (4.4 - z2);
    const column = Math.floor((400 + x3 * 206 * perspective) / dotWidth);
    const row = Math.floor((275 + y3 * 206 * perspective) / dotHeight);
    if (column < 0 || column >= dotColumns || row < 0 || row >= dotRows) return;
    const i = row * dotColumns + column;
    if (z2 <= depth[i]!) return;
    const nx1 = mx * cy + mz * sy;
    const nz1 = -mx * sy + mz * cy;
    const ny2 = my * cx - nz1 * sx;
    const nz2 = my * sx + nz1 * cx;
    depth[i] = z2;
    colors[i] = shade(bg, [nx1 * cz - ny2 * sz, nx1 * sz + ny2 * cz, nz2], z2, Math.sin(x! * 23 + y! * 19 + GRAIN_PHASE) * 0.01);
  };

  for (let row = 1; row < GRID - 1; row++) {
    for (let column = 1; column < GRID - 1; column++) {
      const i = row * GRID + column;
      const d = shape[i]!;
      if (d < -STEP) continue;
      const x = column * STEP - EXTENT;
      const y = row * STEP - EXTENT;
      const dx = shape[i + 1]! - shape[i - 1]!;
      const dy = shape[i + GRID]! - shape[i - GRID]!;
      const length = Math.hypot(dx, dy) || 1;
      const gx = dx / length;
      const gy = dy / length;
      if (d > 0) {
        const edge = Math.min(1, Math.max(0, 1 - d / bevel));
        const nz = Math.sqrt(1 - edge * edge);
        const z = HALF_DEPTH - bevel + bevel * nz;
        project([x, y, z], [-gx * edge, -gy * edge, nz]);
        project([x, y, -z], [-gx * edge, -gy * edge, -nz]);
      }
      if (Math.abs(d) < STEP * 0.8) {
        const sideDepth = HALF_DEPTH - bevel;
        const layers = Math.ceil((sideDepth * 2) / STEP);
        for (let layer = 0; layer <= layers; layer++) {
          project([x - gx * d, y - gy * d, -sideDepth + (layer / layers) * sideDepth * 2], [-gx, -gy, 0]);
        }
      }
    }
  }

  const cells: Array<{ dots: number; rgb: number[] }> = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let dots = 0;
      let count = 0;
      const sum = [0, 0, 0];
      DOT_BITS.forEach((bit, point) => {
        const i = (row * 4 + Math.floor(point / 2)) * dotColumns + column * 2 + (point % 2);
        if (!Number.isFinite(depth[i]!)) return;
        dots |= bit;
        colors[i]!.forEach((c, ch) => (sum[ch]! += c));
        count++;
      });
      cells.push({ dots, rgb: count ? sum.map((v) => Math.floor((v + Math.floor(count / 2)) / count)) : [0, 0, 0] });
    }
  }
  return cells;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export interface Logo {
  /** Screen row and column of the stage's top-left cell. */
  top: number;
  left: number;
  rows: Span[][];
}

const cache = new Map<string, Logo | null>();

/**
 * The faded mark centered on a `cols` × `screenRows` terminal, or null when the screen is too
 * small for it (Codex skips it below 14 stage rows).
 */
export function idleLogo(cols: number, screenRows: number, bg: string): Logo | null {
  const key = `${cols}x${screenRows}${bg}`;
  if (cache.has(key)) return cache.get(key)!;
  const width = Math.min(Math.max(0, cols - 4), MAX_COLUMNS);
  const height = Math.floor((width * STAGE_ROWS) / MAX_COLUMNS);
  let logo: Logo | null = null;
  if (height >= MIN_STAGE_ROWS && height <= screenRows) {
    const back = hex(bg);
    const cells = frame(width, height, SETTLED, back);
    const rows: Span[][] = [];
    for (let r = 0; r < height; r++) {
      const spans: Span[] = [];
      for (let c = 0; c < width; c++) {
        const cell = cells[r * width + c]!;
        if (!cell.dots) {
          spans.push({ t: " " });
          continue;
        }
        const color = cell.rgb.map((v, i) => v * STATIC_OPACITY + back[i]! * (1 - STATIC_OPACITY));
        spans.push({ t: String.fromCodePoint(0x2800 + cell.dots), fg: toHex(color) });
      }
      rows.push(spans);
    }
    logo = { top: Math.floor((screenRows - height) / 2), left: Math.floor((cols - width) / 2), rows };
  }
  cache.set(key, logo);
  return logo;
}
