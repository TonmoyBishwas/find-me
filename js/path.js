// Route planning (grid A* + string pulling + rounded corners) and a natural speed profile.
import { W, H } from "./rooms.js";

const CELL = 6;
const INF = 13; // body clearance around walls and tables

export function makeGrid(layout, occupiedSeats) {
  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL), n = cols * rows;
  const blocked = new Uint8Array(n), crowd = new Uint8Array(n);
  const { room: R, door, tables } = layout;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
      let free = x > R.x0 + INF && x < R.x1 - INF && y > R.y0 + INF && y < R.y1 - INF;
      if (Math.abs(x - door.x) < door.w / 2 - INF + 4 && y >= R.y1 - INF - 1 && y < H - 4) free = true;
      if (free) {
        for (const t of tables) {
          if (x > t.x0 - INF && x < t.x1 + INF && y > t.y0 - INF && y < t.y1 + INF) { free = false; break; }
        }
      }
      blocked[r * cols + c] = free ? 0 : 1;
      if (free) {
        for (const s of occupiedSeats) {
          if (Math.hypot(x - s.x, y - (s.y - 8)) < 20) { crowd[r * cols + c] = 1; break; }
        }
      }
    }
  }
  // Chamfer distance (px) to the nearest blocked cell.
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = blocked[i] ? 0 : 1e9;
  const D = CELL, DD = CELL * Math.SQRT2;
  const relax = (i, j, w) => { if (dist[j] + w < dist[i]) dist[i] = dist[j] + w; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c > 0) relax(i, i - 1, D);
    if (r > 0) { relax(i, i - cols, D); if (c > 0) relax(i, i - cols - 1, DD); if (c < cols - 1) relax(i, i - cols + 1, DD); }
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c;
    if (c < cols - 1) relax(i, i + 1, D);
    if (r < rows - 1) { relax(i, i + cols, D); if (c < cols - 1) relax(i, i + cols + 1, DD); if (c > 0) relax(i, i + cols - 1, DD); }
  }
  return { cols, rows, blocked, crowd, dist };
}

const cellOf = (g, x, y) => {
  const c = Math.min(g.cols - 1, Math.max(0, Math.floor(x / CELL)));
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor(y / CELL)));
  return r * g.cols + c;
};
const center = (g, i) => [(i % g.cols + 0.5) * CELL, (Math.floor(i / g.cols) + 0.5) * CELL];

function nearestFree(g, p) {
  const i0 = cellOf(g, p[0], p[1]);
  if (!g.blocked[i0]) return { i: i0, p };
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.blocked.length; i++) {
    if (g.blocked[i]) continue;
    const [x, y] = center(g, i), d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, p: center(g, best) };
}

function astar(g, s, t) {
  const n = g.blocked.length, cost = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const [tx, ty] = center(g, t);
  const heap = []; // [f, i]
  const push = (f, i) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  const pen = (i) => 1 + 3.5 * Math.max(0, 1 - g.dist[i] / 34) + (g.crowd[i] ? 6 : 0);
  cost[s] = 0; push(0, s);
  while (heap.length) {
    const [, i] = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === t) break;
    const c = i % g.cols, r = (i - c) / g.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (g.blocked[j] || closed[j]) continue;
      if (dr && dc && (g.blocked[r * g.cols + nc] || g.blocked[nr * g.cols + c])) continue;
      const step = (dr && dc ? Math.SQRT2 : 1) * CELL * (pen(i) + pen(j)) / 2;
      const nc2 = cost[i] + step;
      if (nc2 < cost[j]) {
        cost[j] = nc2; from[j] = i;
        const [x, y] = center(g, j);
        push(nc2 + Math.hypot(x - tx, y - ty), j);
      }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const out = [];
  for (let i = t; i >= 0; i = from[i]) { out.push(center(g, i)); if (i === s) break; }
  return out.reverse();
}

function lineOfSight(g, a, b) {
  const crowdOk = g.crowd[cellOf(g, a[0], a[1])] && g.crowd[cellOf(g, b[0], b[1])];
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
  for (let k = 0; k <= n; k++) {
    const i = cellOf(g, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
    if (g.blocked[i] || (!crowdOk && g.crowd[i])) return false;
  }
  return true;
}

export function planPath(grid, from, to) {
  const s = nearestFree(grid, from), t = nearestFree(grid, to);
  const raw = astar(grid, s.i, t.i) || [s.p, t.p];
  raw[0] = s.p; raw[raw.length - 1] = t.p;
  const out = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !lineOfSight(grid, raw[i], raw[j])) j--;
    out.push(raw[j]); i = j;
  }
  return out;
}

// --- motion along a polyline --------------------------------------------------------

function roundCorners(pts, radius) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p = [bx - (bx - ax) / l1 * r, by - (by - ay) / l1 * r];
    const q = [bx + (cx - bx) / l2 * r, by + (cy - by) / l2 * r];
    for (let k = 0; k <= 12; k++) {
      const u = k / 12, v = 1 - u;
      out.push([v * v * p[0] + 2 * u * v * bx + u * u * q[0], v * v * p[1] + 2 * u * v * by + u * u * q[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resample(pts, ds) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = ds - carry;
    while (d <= len) { out.push([ax + (bx - ax) * d / len, ay + (by - ay) * d / len]); d += ds; }
    carry = len - (d - ds);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 0.01) out.push(last);
  return out;
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** Arc-length parametrised motion that starts and ends at rest and slows down through bends. */
export function buildMotion(points, { vmax = 112, accel = 210, decel = 170, aLat = 260 } = {}) {
  const ds = 2;
  const pts = resample(roundCorners(points, 34), ds);
  const N = pts.length;
  const heading = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
  const kappa = heading.map((_, i) => {
    const a = Math.max(0, i - 3), b = Math.min(N - 1, i + 3);
    return b > a ? Math.abs(angDiff(heading[b], heading[a])) / ((b - a) * ds) : 0;
  });
  const v = kappa.map((k) => Math.min(vmax, k > 1e-6 ? Math.sqrt(aLat / k) : vmax));
  v[0] = 0; v[N - 1] = 0;
  for (let i = 1; i < N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * ds));
  for (let i = N - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * decel * ds));
  const time = new Float64Array(N);
  for (let i = 1; i < N; i++) time[i] = time[i - 1] + 2 * ds / Math.max(1e-3, v[i - 1] + v[i]);

  // Which way the figure faces: side view for mostly-horizontal motion, front/back for vertical.
  // Uses a smoothed direction and hysteresis so the view doesn't flicker at diagonal bits.
  const views = new Array(N), facing = new Array(N);
  let view = null, f = 1;
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 8)], b = pts[Math.min(N - 1, i + 8)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (view === null) view = ax > ay ? "side" : dy > 0 ? "front" : "back";
    else if (view === "side" && ay > 1.5 * ax) view = dy > 0 ? "front" : "back";
    else if (view !== "side" && ax > 1.5 * ay) view = "side";
    else if (view !== "side") view = dy > 0 ? "front" : "back";
    if (view === "side" && ax > 0.01) f = dx > 0 ? 1 : -1;
    views[i] = view; facing[i] = f;
  }

  const duration = time[N - 1];
  return {
    pts, duration, length: (N - 1) * ds,
    at(t) {
      if (t <= 0) return { x: pts[0][0], y: pts[0][1], s: 0, v: 0, view: views[0], facing: facing[0] };
      if (t >= duration) return { x: pts[N - 1][0], y: pts[N - 1][1], s: (N - 1) * ds, v: 0, view: views[N - 1], facing: facing[N - 1] };
      let lo = 0, hi = N - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (time[m] <= t) lo = m; else hi = m; }
      const u = (t - time[lo]) / (time[hi] - time[lo] || 1);
      return {
        x: pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u,
        y: pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u,
        s: (lo + u) * ds,
        v: v[lo] + (v[hi] - v[lo]) * u,
        view: views[lo], facing: facing[lo],
      };
    },
  };
}
