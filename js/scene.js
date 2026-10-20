// The "friend walks in and finds me" story. Everything is a pure function of time, so the
// live preview and the exported GIF are frame-for-frame identical.
//   renderWorld(ctx, t, ui)  – the whole room in world coordinates (used for the seat-picker map)
//   renderFrame(ctx, t)      – the portrait phone frame: caption + a camera that follows the friend
import { W, H, buildLayout, describeSeat } from "./rooms.js";
import { makeGrid, planPath, buildMotion } from "./path.js";
import * as C from "./character.js";

export const FONT = '"Patrick Hand", "Comic Sans MS", "Segoe Print", cursive';
const INK = "#111", PAPER = "#fff", CROWD_INK = "#b0b0b0", FLOOR_INK = "#c9c9c9";
const SIZE = 64;
const LOOK = 1.3, START_IDLE = 1.35;

// Portrait output frame (4:5 fills a WhatsApp chat bubble on a phone).
export const FRAME = { w: 540, h: 675, cap: 118 };
const VIEW = { w: FRAME.w, h: FRAME.h - FRAME.cap };
const ZOOM_FOLLOW = 1.15, PAN = 0.75;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOutBack = (k) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function createScene(room, seatId, { me = "m", friend = "f", crowd = 0.35 } = {}) {
  const layout = buildLayout(room);
  const seat = layout.seatById[seatId] || layout.seats[0];
  const { door, room: R } = layout;
  const stride = C.STRIDE_UNITS * SIZE / 105;

  // Where the friend ends up: middle of the walkway beside my table, a little in front of me
  // so the two figures don't overlap.
  const tbl = seat.table;
  const beside = layout.tables.filter((o) => o.row === tbl.row && (seat.side < 0 ? o.x < tbl.x : o.x > tbl.x));
  const edge = seat.side < 0 ? Math.max(R.x0, ...beside.map((o) => o.x1)) : Math.min(R.x1, ...beside.map((o) => o.x0));
  const goal = [(edge + (seat.side < 0 ? tbl.x0 : tbl.x1)) / 2, seat.y + 42];

  const rand = rng(`${room.name}|${seat.id}`);
  const people = layout.seats
    .filter((s) => s !== seat && Math.hypot(s.x - goal[0], s.y - goal[1]) > 40 && rand() < crowd)
    .map((s) => ({ seat: s, gender: rand() < 0.5 ? "m" : "f", seed: rand() * 10 }));

  const grid = makeGrid(layout, people.map((p) => p.seat));
  const start = [door.x, door.y + 108], inside = [door.x, door.y - 52];
  const m1 = buildMotion([start, inside]);
  const m2 = buildMotion(planPath(grid, inside, goal));

  const t1s = START_IDLE, t1e = t1s + m1.duration, t2s = t1e + LOOK, t2e = t2s + m2.duration;
  const standStart = Math.max(t2s + 0.4, t2e - 1.7);
  const route = m1.pts.concat(m2.pts);
  const meFacing = -seat.side;
  const lookFirst = seat.x > door.x ? -1 : 1;
  const directions = describeSeat(seat);

  function friendState(t) {
    if (t < t1s) return { ...m1.at(0), S: 0, view: "back", pose: C.frontStand() };
    if (t < t1e) {
      const m = m1.at(t - t1s);
      return { ...m, S: m.s, pose: walkPose(m) };
    }
    const end1 = m1.at(m1.duration);
    if (t < t2s) {
      const k = (t - t1e) / LOOK;
      const S = m1.length;
      if (k < 0.1 || k > 0.9) return { ...end1, S, view: "back", pose: C.frontStand() };
      const half = k < 0.5 ? 0 : 1;
      const local = (k - (half ? 0.5 : 0.1)) / (half ? 0.4 : 0.4);
      const pose = C.lerpPose(C.sideStand(), C.sideSearch(t), smooth(0, 0.3, local) * (1 - smooth(0.8, 1, local)));
      return { ...end1, S, view: "side", facing: half ? -lookFirst : lookFirst, pose, thinking: true };
    }
    if (t < t2e) {
      const m = m2.at(t - t2s);
      return { ...m, S: m1.length + m.s, pose: walkPose(m) };
    }
    const m = m2.at(m2.duration);
    const k = t - t2e;
    const facing = seat.x >= m.x ? 1 : -1;
    const pose = k > 0.15 && k < 1.5 ? C.lerpPose(C.sideStand(), C.sideWave(t), smooth(0.15, 0.35, k) * (1 - smooth(1.3, 1.5, k)))
      : { ...C.sideStand(), mouth: "open" };
    return { ...m, S: m1.length + m2.length, view: "side", facing, pose, arrived: true };
  }

  function walkPose(m) {
    const phi = (m.s / stride) * Math.PI * 2;
    const amt = smooth(0, 45, m.v);
    return m.view === "side" ? C.lerpPose(C.sideStand(), C.sideWalk(phi), amt) : C.lerpFront(C.frontStand(), C.frontWalk(phi), amt);
  }

  function meState(t) {
    if (t < standStart) return { view: "side", facing: meFacing, pose: C.sideSit(t, 0.3), seated: true };
    const k = (t - standStart) / 0.5;
    if (k < 1) return { view: "side", facing: meFacing, pose: C.lerpPose(C.sideSit(t, 0.3), C.sideStand(), smooth(0, 1, k)), seated: k < 0.5 };
    const waveEnd = t2e + 1.1;
    if (t < waveEnd) return { view: "front", pose: C.frontWave(t) };
    return { view: "front", pose: C.lerpFront(C.frontWave(t), { ...C.frontStand(), mouth: "open" }, smooth(waveEnd, waveEnd + 0.3, t)) };
  }

  // ---------------------------------------------------------------- camera
  // The camera works in "shots": it holds still while the friend walks through the frame and
  // glides to a new framing only when they near the edge. Held frames barely change, which keeps
  // the GIF small, and it reads like a filmed scene rather than a jittery tracking cam.

  const bounds = { x0: R.x0 - 24, x1: R.x1 + 24, y0: R.y0 - 40, y1: H };
  function clampCam(x, y, z) {
    const hw = VIEW.w / 2 / z, hh = VIEW.h / 2 / z;
    const cx = bounds.x1 - bounds.x0 <= 2 * hw ? (bounds.x0 + bounds.x1) / 2 : Math.max(bounds.x0 + hw, Math.min(bounds.x1 - hw, x));
    const cy = bounds.y1 - bounds.y0 <= 2 * hh ? (bounds.y0 + bounds.y1) / 2 : Math.max(bounds.y0 + hh, Math.min(bounds.y1 - hh, y));
    return { x: cx, y: cy, z };
  }
  const overview = (() => {
    const x0 = R.x0 - 14, x1 = R.x1 + 14, y0 = R.y0 - 30, y1 = H - 4;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: Math.min(VIEW.w / (x1 - x0), VIEW.h / (y1 - y0)) };
  })();

  const shots = [];
  function camAt(t) {
    let cur = shots[0].to;
    for (const s of shots) {
      if (s.t > t) break;
      const k = easeInOut(clamp01((t - s.t) / s.dur));
      cur = {
        x: s.from.x + (s.to.x - s.from.x) * k,
        y: s.from.y + (s.to.y - s.from.y) * k,
        z: s.from.z * (s.to.z / s.from.z) ** k,
      };
    }
    return cur;
  }
  function addShot(t, target, dur) {
    const to = target === overview ? overview : clampCam(target.x, target.y, target.z);
    shots.push({ t, dur, from: shots.length ? camAt(t) : to, to });
  }

  // Establishing shot of the whole room, then a cut to the door.
  addShot(0, overview, 0.01);
  addShot(1.2, { x: door.x, y: door.y - 30, z: ZOOM_FOLLOW }, 0.01);
  const hw = VIEW.w / 2 / ZOOM_FOLLOW, hh = VIEW.h / 2 / ZOOM_FOLLOW;
  const panTo = (t, x, y) => {
    const last = shots[shots.length - 1], c = clampCam(x, y, ZOOM_FOLLOW);
    if (Math.hypot(c.x - last.to.x, c.y - last.to.y) > 30) addShot(t, c, PAN);
  };
  // Follow: pan ahead only when the friend nears the edge of the current framing.
  const meetAt = t2e - 0.9;
  for (let t = START_IDLE + 0.3; t < meetAt; t += 0.05) {
    const last = shots[shots.length - 1];
    if (t < last.t + last.dur) continue;
    const p = friendState(t), cx = p.x, cy = p.y - 32;
    if (Math.abs(cx - last.to.x) < hw * 0.6 && Math.abs(cy - last.to.y) < hh * 0.55) continue;
    const ahead = friendState(Math.min(t + 2, t2e));
    panTo(t, (cx + ahead.x) / 2, (cy + ahead.y - 32) / 2);
  }
  {
    const last = shots[shots.length - 1];
    panTo(Math.max(meetAt, last.t + last.dur), (seat.x + goal[0]) / 2, (seat.y + goal[1]) / 2 - 40);
  }
  // Pull back to the whole room so the full route is the last thing they see.
  const outroAt = t2e + 1.9;
  addShot(outroAt, overview, 1.0);
  const duration = outroAt + 1.0 + 1.5;
  const isMoving = (t) => shots.some((x) => x.dur > 0.05 && t >= x.t && t < x.t + x.dur);

  // ---------------------------------------------------------------- drawing

  function drawRoom(ctx) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    // corridor outside the door
    ctx.strokeStyle = "#e3e3e3"; ctx.lineWidth = 1.5; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(R.x0, H - 10); ctx.lineTo(R.x1, H - 10); ctx.stroke();
    ctx.setLineDash([]);
    // walls with a door gap
    ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(door.x - door.w / 2, R.y1); ctx.lineTo(R.x0, R.y1); ctx.lineTo(R.x0, R.y0);
    ctx.lineTo(R.x1, R.y0); ctx.lineTo(R.x1, R.y1); ctx.lineTo(door.x + door.w / 2, R.y1);
    ctx.stroke();
    // floor labels
    ctx.fillStyle = "#9b9b9b"; ctx.font = `20px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("← left side", R.x0 + 18, R.y1 - 22);
    ctx.textAlign = "right"; ctx.fillText("right side →", R.x1 - 18, R.y1 - 22);
    ctx.textAlign = "left"; ctx.fillText("DOOR", door.x + door.w / 2 + 10, R.y1 + 24);
    const rowLabel = (txt, y) => {
      ctx.save(); ctx.translate(R.x0 + 20, y); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.fillText(txt, 0, 0); ctx.restore();
    };
    const tb = layout.tables.find((t) => t.row === "B"), ta = layout.tables.find((t) => t.row === "A");
    if (tb) rowLabel("back row", (tb.y0 + tb.y1) / 2);
    if (ta) rowLabel("front row", (ta.y0 + ta.y1) / 2);
    // tables: flat top plus a thin front edge for a bit of depth
    for (const t of layout.tables) {
      ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.roundRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillRect(t.x0, t.y1 - 1, t.x1 - t.x0, 6);
    }
  }

  function drawDoor(ctx, S) {
    const open = smooth(108 - 90, 108 - 35, S) * (1 - smooth(m1.length + 40, m1.length + 130, S));
    const a = open * Math.PI / 2 * 0.96;
    const hx = door.x - door.w / 2, hy = R.y1;
    if (open > 0.02) {
      ctx.strokeStyle = FLOOR_INK; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(hx, hy, door.w, -a, 0); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(-a) * door.w, hy + Math.sin(-a) * door.w); ctx.stroke();
  }

  function drawRoute(ctx, S) {
    // full route as faint dots + direction chevrons, travelled part as a solid line
    ctx.strokeStyle = FLOOR_INK; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.setLineDash([0.1, 9]);
    ctx.beginPath(); route.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;
    for (let i = 30; i < route.length - 20; i += 34) {
      const [x0, y0] = route[i - 2], [x1, y1] = route[i + 2];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const [x, y] = route[i];
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang - 0.7) * 7, y - Math.sin(ang - 0.7) * 7); ctx.lineTo(x, y);
      ctx.lineTo(x - Math.cos(ang + 0.7) * 7, y - Math.sin(ang + 0.7) * 7);
      ctx.stroke();
    }
    const n = Math.min(route.length, Math.floor(S / 2) + 1);
    if (n > 1) {
      ctx.strokeStyle = "#555"; ctx.lineWidth = 3.5;
      ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, route[i][0], route[i][1]); ctx.stroke();
    }
  }

  function pill(ctx, x, y, text, dark) {
    ctx.font = `bold 17px ${FONT}`;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = dark ? INK : PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12, w, 24, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dark ? PAPER : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
  }

  // Speech bubble whose tail points at (x, y). `dx` shifts the body sideways; it is also
  // kept inside the camera bounds.
  function bubble(ctx, x, y, text, k, dx = 0) {
    if (k <= 0) return;
    const s = easeOutBack(clamp01(k));
    ctx.font = `bold 24px ${FONT}`;
    const w = ctx.measureText(text).width + 26, h = 38;
    const bx = Math.max(bounds.x0 + w / 2 + 6, Math.min(bounds.x1 - w / 2 - 6, x + dx)) - x;
    const tx = Math.max(bx - w / 2 + 16, Math.min(bx + w / 2 - 16, 0));
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.roundRect(bx - w / 2, -h - 12, w, h, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 8, -13.5); ctx.lineTo(0, 0); ctx.lineTo(tx + 8, -13.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - 8, -12); ctx.lineTo(0, 0); ctx.lineTo(tx + 8, -12); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, bx, -h / 2 - 11);
    ctx.restore();
  }

  let captionLines = null;
  function drawCaption(ctx) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, FRAME.w, FRAME.cap);
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `bold 32px ${FONT}`; ctx.fillText(room.name, FRAME.w / 2, 30);
    ctx.font = `22px ${FONT}`;
    if (!captionLines) {
      captionLines = [];
      let line = "";
      for (const part of directions.split(" · ")) {
        const next = line ? `${line} · ${part}` : part;
        if (line && ctx.measureText(next).width > FRAME.w - 28) { captionLines.push(line); line = part; } else line = next;
      }
      captionLines.push(line);
    }
    const y0 = captionLines.length > 2 ? 58 : 66;
    captionLines.forEach((l, i) => ctx.fillText(l, FRAME.w / 2, y0 + i * 25));
    ctx.fillStyle = "#e2e2e2"; ctx.fillRect(16, FRAME.cap - 2, FRAME.w - 32, 2);
  }

  // Off-screen pointer to "ME" so the destination is always clear while zoomed in.
  function drawMePointer(ctx, cam, t) {
    if (t > t2e) return;
    const sx = (seat.x - cam.x) * cam.z + VIEW.w / 2;
    const sy = (seat.y - 40 - cam.y) * cam.z + FRAME.cap + VIEW.h / 2;
    const m = 30, x0 = m, x1 = VIEW.w - m, y0 = FRAME.cap + m, y1 = FRAME.h - m;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return;
    const px = Math.max(x0, Math.min(x1, sx)), py = Math.max(y0, Math.min(y1, sy));
    const ang = Math.atan2(sy - py, sx - px);
    ctx.save(); ctx.translate(px, py);
    ctx.fillStyle = INK;
    ctx.save(); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(16, -9); ctx.lineTo(16, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(-22, -13, 44, 26, 13); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = `bold 18px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ME", 0, 1);
    ctx.restore();
  }

  function renderFrame(ctx, t) {
    const cam = camAt(t);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, FRAME.w, FRAME.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, FRAME.cap, VIEW.w, VIEW.h); ctx.clip();
    ctx.translate(VIEW.w / 2, FRAME.cap + VIEW.h / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    renderWorld(ctx, t);
    ctx.restore();
    drawMePointer(ctx, cam, t);
    drawCaption(ctx);
  }

  // ui: { map: true } draws a still map for seat picking (no friend), { noSeat } hides "me",
  // { showSeats, hoverId } adds the seat dots.
  function renderWorld(ctx, t, ui = {}) {
    const fr = friendState(t), ms = meState(t);
    drawRoom(ctx);
    if (!ui.noSeat) drawRoute(ctx, ui.map ? 0 : fr.S);
    drawDoor(ctx, ui.map ? 0 : fr.S);

    // target ring under me until the friend arrives
    if (!ui.noSeat && t < t2e + 0.4) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 1 - smooth(t2e, t2e + 0.4, t);
      ctx.beginPath(); ctx.ellipse(seat.x, seat.y, 26 + pulse * 5, 10 + pulse * 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // characters, back to front
    const actors = people.map((p) => ({
      y: p.seat.y, draw: () => {
        C.drawChair(ctx, p.seat.x, p.seat.y, -p.seat.side, SIZE, "#cfcfcf");
        C.drawFigure(ctx, p.seat.x, p.seat.y, { size: SIZE, gender: p.gender, view: "side", facing: -p.seat.side, pose: C.sideSit(t, p.seed), ink: CROWD_INK });
      },
    }));
    if (!ui.noSeat) actors.push({
      y: seat.y + 0.1, draw: () => {
        C.drawChair(ctx, seat.x, seat.y, meFacing, SIZE, ms.seated ? INK : "#bbb");
        C.drawFigure(ctx, seat.x, seat.y, { size: SIZE, gender: me, view: ms.view, facing: ms.facing ?? meFacing, pose: ms.pose });
      },
    });
    if (!ui.map) actors.push({ y: fr.y, draw: () => C.drawFigure(ctx, fr.x, fr.y, { size: SIZE, gender: friend, view: fr.view, facing: fr.facing, pose: fr.pose }) });
    actors.sort((a, b) => a.y - b.y).forEach((a) => a.draw());

    // seat picker overlay (live preview only)
    if (ui.showSeats) {
      for (const s of layout.seats) {
        const on = !ui.noSeat && s.id === seat.id, hov = s.id === ui.hoverId;
        ctx.beginPath(); ctx.arc(s.x, s.y - 18, hov ? 9 : 6, 0, Math.PI * 2);
        ctx.fillStyle = on || hov ? INK : PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke();
      }
    }

    if (ui.map) {
      if (!ui.noSeat) pill(ctx, seat.x, seat.y - 0.86 * SIZE - 14, "ME", true);
      return;
    }

    // labels and speech
    const meHead = seat.y - (ms.seated ? 0.86 : 1.08) * SIZE;
    const frHead = fr.y - 1.08 * SIZE;
    const meSays = t >= standStart + 0.45 && t < t2e + 0.3;
    const frSays = t >= t2e + 0.3;
    const close = Math.hypot(fr.x - seat.x, fr.y - seat.y) < 90;
    const away = Math.abs(fr.x - seat.x) > 4 ? Math.sign(fr.x - seat.x) : seat.side;
    if (fr.thinking) bubble(ctx, fr.x, frHead - 4, "?", ((t - t1e) / LOOK - 0.12) / 0.08);
    else if (!frSays && !close) pill(ctx, fr.x, frHead - 14, "YOU", false);
    if (meSays) bubble(ctx, seat.x, meHead - 4, "Over here!", (t - standStart - 0.45) / 0.25);
    else if (!frSays) pill(ctx, seat.x, meHead - 14, "ME", true);
    if (frSays) bubble(ctx, fr.x + away * 10, frHead + 6, "Found you!", (t - t2e - 0.3) / 0.25, away * 62);
  }

  return { duration, renderWorld, renderFrame, isMoving, camAt, shots, layout, seat, directions, timings: { t1s, t1e, t2s, t2e, standStart } };
}

export { W, H };
