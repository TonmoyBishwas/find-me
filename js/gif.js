import { GIFEncoder, applyPalette } from "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js";
import { FRAME } from "./scene.js";

// Everything is black & white, so a fixed palette of 8 greys is enough for smooth anti-aliased
// lines. Index 8 marks "unchanged since the previous frame" (transparent), which turns the static
// parts of each frame into long runs that compress to almost nothing.
const GREYS = Array.from({ length: 8 }, (_, i) => { const v = Math.round((i * 255) / 7); return [v, v, v]; });
const KEEP = 8;
const PALETTE = [...GREYS, [255, 0, 255], ...Array.from({ length: 7 }, () => [0, 0, 0])];

// Frame timing (GIF delays are in 10 ms steps): 20 fps normally, ~17 fps while the camera pans,
// because pan frames change every pixel and cost ~6x more bytes than held frames.
const STEP = 0.05, PAN_STEP = 0.06;

export async function exportGif(scene, { width = FRAME.w, onProgress } = {}) {
  const scale = width / FRAME.w;
  const w = Math.round(FRAME.w * scale), h = Math.round(FRAME.h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const gif = GIFEncoder();
  let prev = null, n = 0;
  for (let t = 0; t < scene.duration; n++) {
    const step = scene.isMoving(t) ? PAN_STEP : STEP;
    const last = t + step >= scene.duration;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    scene.renderFrame(ctx, t);
    const index = applyPalette(ctx.getImageData(0, 0, w, h).data, GREYS);
    const opts = { delay: last ? 1500 : Math.round(step * 1000), dispose: 1 };
    if (!prev) {
      gif.writeFrame(index, w, h, { ...opts, palette: PALETTE, repeat: 0 });
    } else {
      const delta = new Uint8Array(index.length);
      for (let k = 0; k < index.length; k++) delta[k] = index[k] === prev[k] ? KEEP : index[k];
      gif.writeFrame(delta, w, h, { ...opts, transparent: true, transparentIndex: KEEP });
    }
    prev = index;
    t += step;
    if (n % 5 === 0) { onProgress?.(t / scene.duration); await new Promise((r) => setTimeout(r)); }
  }
  gif.finish();
  onProgress?.(1);
  return new Blob([gif.bytes()], { type: "image/gif" });
}
