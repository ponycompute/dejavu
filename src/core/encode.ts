// Streams rendered frames into ffmpeg.
import { spawn } from "node:child_process";
import path from "node:path";
import type { Renderer } from "./draw.js";
import type { Scene } from "./types.js";

export interface EncodeOptions {
  scene: Scene;
  renderer: Renderer;
  fps: number;
  out: string;
  onProgress?: (frame: number, total: number) => void;
}

function codecArgs(out: string): string[] {
  switch (path.extname(out).toLowerCase()) {
    case ".gif":
      return ["-vf", "scale=iw/2:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", "-loop", "0"];
    case ".webm":
      return ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-pix_fmt", "yuv420p"];
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  }
}

export async function encode({ scene, renderer, fps, out, onProgress }: EncodeOptions): Promise<{ frames: number; seconds: number }> {
  const { width, height } = renderer;
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
    ...codecArgs(out),
    out,
  ], { stdio: ["pipe", "inherit", "pipe"] });
  // ffmpeg reports a harmless short read on the first frame from a pipe; pass everything else through
  ff.stderr.setEncoding("utf8");
  ff.stderr.on("data", (chunk: string) => {
    const text = chunk.split("\n").filter((l) => !/^Truncating packet of size/.test(l)).join("\n");
    if (text.trim()) process.stderr.write(text);
  });

  const done = new Promise<void>((resolve, reject) => {
    ff.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new Error("ffmpeg not found — install it (brew install ffmpeg)") : e));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
  let broken = false;
  ff.stdin.on("error", () => {
    broken = true;
  });
  const closed = new Promise<void>((r) => ff.once("close", () => r()));

  const total = Math.ceil(scene.duration * fps);
  for (let f = 0; f < total && !broken; f++) {
    const t = f / fps;
    const frame = renderer.render(scene.frame(t), t).data();
    if (!ff.stdin.write(frame)) {
      await Promise.race([new Promise<void>((r) => ff.stdin.once("drain", r)), closed]);
    }
    onProgress?.(f + 1, total);
  }
  ff.stdin.end();
  await done;
  return { frames: total, seconds: total / fps };
}
