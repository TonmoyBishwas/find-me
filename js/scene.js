// The "friend walks in and finds me" story. Everything is a pure function of time, so the
// live preview and the exported GIF are frame-for-frame identical.
//   renderWorld(ctx, t, ui)  – the whole room in world coordinates (used for the seat-picker map)
//   renderFrame(ctx, t)      – the phone frame (size: scene.frame) in one of the STYLES below
import { W, H, buildLayout, describeSeat } from "./rooms.js";
import { makeGrid, planPath, buildMotion } from "./path.js";
import * as C from "./character.js";

export const FONT = '"Patrick Hand", "Comic Sans MS", "Segoe Print", cursive';
// The ME / YOU tags use a plain font: at tag size the hand-drawn bold M reads like an H.
const TAG_FONT = 'Arial, "Helvetica Neue", sans-serif';
const INK = "#111", PAPER = "#fff", CROWD_INK = "#b0b0b0", FLOOR_INK = "#c9c9c9";
// The one colour in the picture: my bench, filled like a highlighter, so it stands out at a glance.
export const ACCENT = [255, 212, 59];
const ACCENT_CSS = `rgb(${ACCENT})`;
const ACCENT_PALE_CSS = `rgb(${ACCENT.map((v) => Math.round(v + (255 - v) * 0.5))})`; // the rest of my bench (a GIF palette blend)
const SIZE = 64;
const LOOK = 1.3, START_IDLE = 1.35;

// Portrait output frame (4:5 fills a WhatsApp chat bubble on a phone).
export const FRAME = { w: 540, h: 675, cap: 118 };
const VIEW = { w: FRAME.w, h: FRAME.h - FRAME.cap };
const ZOOM_FOLLOW = 1.15, PAN = 0.75;

// GIF styles. All but "follow" show the room in a frame shaped like the room.
export const STYLES = [
  { id: "follow", name: "Zoom & follow" },   // the camera follows the friend
  { id: "map", name: "Whole room" },         // the whole room, the whole time
  { id: "zoom", name: "Room, then zoom" },   // whole room until halfway, then zoom into my part of it
  { id: "spotlight", name: "Spotlight" },    // whole room dimmed, a spotlight on the friend and on me
  { id: "treasure", name: "Treasure map" },  // no friend: the path draws itself to an X at my seat
];

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

export function createScene(room, seatId, { me = "m", friend = "f", crowd = 0.35, style = "follow" } = {}) {
  const layout = buildLayout(room);
  const seat = layout.seatById[seatId] || layout.seats[0];
  const { door, room: R } = layout;
  // Layout and route planning live in room coordinates (door at the bottom). A room whose door
  // is on the left is turned a quarter clockwise only when drawn; figures stay upright.
  const rot = room.door === "left";
  const P = rot ? (x, y) => [H - y, x] : (x, y) => [x, y];
  const world = rot ? { w: H, h: W } : { w: W, h: H };
  const at = (s) => {
    const [x, y] = P(s.x, s.y);
    // Someone facing us sits behind their table: put them on its centre line so the table hides their legs.
    return rot && s.side < 0 ? { x, y: P(s.table.x, s.y)[1] } : { x, y };
  };
  const me0 = at(seat);
  // Seats sit beside a table, facing it. Turned, the tables lie flat on screen, so people sit above
  // (seen from the front) or below (seen from behind) and face up or down, towards a side wall.
  const faceOf = (s) => -s.side;
  const sitView = (s) => (!rot ? "side" : s.side < 0 ? "front" : "back");
  const seatedPose = (s, t, seed) => (sitView(s) === "side" ? C.sideSit(t, seed) : C.frontSit(t, seed));
  function drawSeated(ctx, s, q, fig, chairInk) {
    const view = sitView(s);
    if (view !== "back") C.drawChair(ctx, q.x, q.y, faceOf(s), SIZE, chairInk, view);
    C.drawFigure(ctx, q.x, q.y, { size: SIZE, view, facing: faceOf(s), ...fig });
    if (view === "back") C.drawChair(ctx, q.x, q.y, faceOf(s), SIZE, chairInk, view);
    if (view === "front") drawTable(ctx, s.table);
  }
  const stride = C.STRIDE_UNITS * SIZE / 105;

  // Where the friend ends up: middle of the walkway beside my table, a step along from me so the
  // two figures don't overlap. Seen from the side that step is up/down the screen, and the walkway
  // can be too narrow to keep us apart sideways, so it's a full body height; turned, it's sideways.
  const tbl = seat.table;
  const beside = layout.tables.filter((o) => o.row === tbl.row && (seat.side < 0 ? o.x < tbl.x : o.x > tbl.x));
  const edge = seat.side < 0 ? Math.max(R.x0, ...beside.map((o) => o.x1)) : Math.min(R.x1, ...beside.map((o) => o.x0));
  const step = rot ? 42 : SIZE + 8;
  // The front row stands against the door wall: if there's no room past me, stop just before me.
  const gy = seat.y + step <= R.y1 - 22 ? seat.y + step : seat.y - step;
  // She always comes down the walkway on my side of the table. Turned, a walkway is shorter on
  // screen than a standing figure, so anyone standing in the middle of one reaches over the next
  // table. Instead she walks along it (never out into the wide gap by the door) and then steps in
  // level with me: behind the table beside me if I sit above it (it hides her legs, as it does
  // mine), or in front of it beside me if I sit below it.
  const near = seat.side < 0 ? tbl.x0 : tbl.x1;
  const goal = [near + seat.side * (rot ? Math.min(28, Math.abs(edge - near) / 2) : Math.abs(edge - near) / 2), gy];
  const standAt = !rot ? goal : [seat.side < 0 ? tbl.x : seat.x, gy];

  const rand = rng(`${room.name}|${seat.id}`);
  const people = layout.seats
    .filter((s) => s !== seat && Math.hypot(s.x - standAt[0], s.y - standAt[1]) > 40 && rand() < crowd)
    .map((s) => ({ seat: s, gender: rand() < 0.5 ? "m" : "f", seed: rand() * 10 }));

  const grid = makeGrid(layout, people.map((p) => p.seat));
  const start = [door.x, door.y + 108], inside = [door.x, door.y - 52];
  const m1 = buildMotion([P(...start), P(...inside)]);
  const m2 = buildMotion([...planPath(grid, inside, goal), ...(standAt !== goal ? [standAt] : [])].map((q) => P(...q)));

  const t1s = START_IDLE, t1e = t1s + m1.duration, t2s = t1e + LOOK, t2e = t2s + m2.duration;
  const standStart = Math.max(t2s + 0.4, t2e - 1.7);
  const route = m1.pts.concat(m2.pts);
  const meFacing = faceOf(seat);
  const lookFirst = rot ? 1 : seat.x > door.x ? -1 : 1;
  // When the friend stops above or below me on screen she faces me up/down the screen: from the
  // front if she's higher, from behind if lower. Turned, I sit facing away from the walkway, so I
  // turn round to face her too; otherwise I face the camera and wave.
  const fEnd = m2.at(m2.duration);
  const upDown = Math.abs(fEnd.y - me0.y) > Math.abs(fEnd.x - me0.x);
  const friendEndView = !upDown ? "side" : fEnd.y < me0.y ? "front" : "back";
  const meEndView = rot && friendEndView === "front" ? "back" : "front";
  const directions = describeSeat(seat);

  function friendState(t) {
    if (t < t1s) return { ...m1.at(0), S: 0, pose: stand(m1.at(0)) };
    if (t < t1e) {
      const m = m1.at(t - t1s);
      return { ...m, S: m.s, pose: walkPose(m) };
    }
    const end1 = m1.at(m1.duration);
    if (t < t2s) {
      const k = (t - t1e) / LOOK;
      const S = m1.length;
      if (k < 0.1 || k > 0.9) return { ...end1, S, pose: stand(end1) };
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
    const facing = me0.x >= m.x ? 1 : -1;
    const wave = smooth(0.15, 0.35, k) * (1 - smooth(1.3, 1.5, k));
    const pose = friendEndView === "side"
      ? (k > 0.15 && k < 1.5 ? C.lerpPose(C.sideStand(), C.sideWave(t), wave) : { ...C.sideStand(), mouth: "open" })
      : C.lerpFront({ ...C.frontStand(), mouth: "open" }, C.frontWave(t), wave);
    return { ...m, S: m1.length + m2.length, view: friendEndView, facing, pose, arrived: true };
  }

  function stand(m) { return m.view === "side" ? C.sideStand() : C.frontStand(); }

  function walkPose(m) {
    const phi = (m.s / stride) * Math.PI * 2;
    const amt = smooth(0, 45, m.v);
    return m.view === "side" ? C.lerpPose(C.sideStand(), C.sideWalk(phi), amt) : C.lerpFront(C.frontStand(), C.frontWalk(phi), amt);
  }

  function meState(t) {
    const sv = sitView(seat);
    if (t < standStart) return { view: sv, facing: meFacing, pose: seatedPose(seat, t, 0.3), seated: true };
    const k = (t - standStart) / 0.5;
    if (k < 1) {
      const pose = sv === "side" ? C.lerpPose(C.sideSit(t, 0.3), C.sideStand(), smooth(0, 1, k))
        : C.lerpFront(C.frontSit(t, 0.3), C.frontStand(), smooth(0, 1, k));
      return { view: sv, facing: meFacing, pose, seated: k < 0.5 };
    }
    const waveEnd = t2e + 1.1;
    if (t < waveEnd) return { view: meEndView, pose: C.frontWave(t) };
    return { view: meEndView, pose: C.lerpFront(C.frontWave(t), { ...C.frontStand(), mouth: "open" }, smooth(waveEnd, waveEnd + 0.3, t)) };
  }

  // ---------------------------------------------------------------- camera
  // The camera works in "shots": it holds still while the friend walks through the frame and
  // glides to a new framing only when they near the edge. Held frames barely change, which keeps
  // the GIF small, and it reads like a filmed scene rather than a jittery tracking cam.

  const box = (x0, y0, x1, y1) => {
    const [ax, ay] = P(x0, y0), [bx, by] = P(x1, y1);
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
  };
  // Rotated, heads poke above the left-side tables, so keep a strip of headroom there too.
  const bounds = rot ? { ...box(R.x0 - 24, R.y0 - 40, R.x1 + 24, H), y0: R.x0 - 40 } : box(R.x0 - 24, R.y0 - 40, R.x1 + 24, H);
  function clampCam(x, y, z) {
    const hw = VIEW.w / 2 / z, hh = VIEW.h / 2 / z;
    const cx = bounds.x1 - bounds.x0 <= 2 * hw ? (bounds.x0 + bounds.x1) / 2 : Math.max(bounds.x0 + hw, Math.min(bounds.x1 - hw, x));
    const cy = bounds.y1 - bounds.y0 <= 2 * hh ? (bounds.y0 + bounds.y1) / 2 : Math.max(bounds.y0 + hh, Math.min(bounds.y1 - hh, y));
    return { x: cx, y: cy, z };
  }
  // The whole room (with the corridor outside the door), and a camera that fits it into a w×h box.
  const roomBox = rot ? { ...box(R.x0 - 14, R.y0 - 14, R.x1 + 14, H - 4), y0: R.x0 - 36 } : box(R.x0 - 14, R.y0 - 30, R.x1 + 14, H - 4);
  const fitRoom = (w, h) => ({
    x: (roomBox.x0 + roomBox.x1) / 2, y: (roomBox.y0 + roomBox.y1) / 2,
    z: Math.min(w / (roomBox.x1 - roomBox.x0), h / (roomBox.y1 - roomBox.y0)),
  });
  const overview = fitRoom(VIEW.w, VIEW.h);

  // Frame layout for the chosen style: "follow" uses the fixed portrait frame, the rest a frame
  // shaped like the room.
  const rbw = roomBox.x1 - roomBox.x0, rbh = roomBox.y1 - roomBox.y0;
  const follow = !STYLES.some((s) => s.id === style) || style === "follow";
  let frame, viewRect;
  if (follow) {
    frame = { ...FRAME };
    viewRect = { x: 0, y: FRAME.cap, w: VIEW.w, h: VIEW.h };
  } else {
    const h = Math.round(Math.min(860, rbh * FRAME.w / rbw));
    frame = { w: FRAME.w, h: FRAME.cap + h };
    viewRect = { x: 0, y: FRAME.cap, w: FRAME.w, h };
  }
  const roomCam = fitRoom(viewRect.w, viewRect.h);

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
  { const [x, y] = P(door.x, door.y - (rot ? 0 : 30)); addShot(1.2, { x, y: y - (rot ? 30 : 0), z: ZOOM_FOLLOW }, 0.01); }
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
    const g = P(...standAt);
    panTo(Math.max(meetAt, last.t + last.dur), (me0.x + g[0]) / 2, (me0.y + g[1]) / 2 - 40);
  }
  // Pull back to the whole room so the full route is the last thing they see.
  const outroAt = t2e + 1.9;
  addShot(outroAt, overview, 1.0);
  const duration = outroAt + 1.0 + 1.5;
  // "Room, then zoom": once the friend is halfway along the route, glide in on my part of the room.
  const ZOOM_GLIDE = 1.1;
  let zoomAt = t2e;
  for (let t = t1s; t < t2e; t += 0.05) if (friendState(t).S >= (m1.length + m2.length) / 2) { zoomAt = t; break; }
  const zoomCam = (() => {
    const z = Math.min(1.25, roomCam.z * 1.8), hw = viewRect.w / 2 / z, hh = viewRect.h / 2 / z;
    const g = P(...standAt), x = (me0.x + g[0]) / 2, y = (me0.y + g[1]) / 2 - 30;
    const fit = (v, a, b, half) => (b - a <= 2 * half ? (a + b) / 2 : Math.max(a + half, Math.min(b - half, v)));
    return { x: fit(x, roomBox.x0, roomBox.x1, hw), y: fit(y, roomBox.y0, roomBox.y1, hh), z };
  })();
  function frameCam(t) {
    if (follow) return camAt(t);
    if (style !== "zoom") return roomCam;
    // and, like "follow", pull back to the whole room at the end
    const k = easeInOut(clamp01((t - zoomAt) / ZOOM_GLIDE)) * (1 - easeInOut(clamp01((t - outroAt) / 1.0)));
    return {
      x: roomCam.x + (zoomCam.x - roomCam.x) * k, y: roomCam.y + (zoomCam.y - roomCam.y) * k,
      z: roomCam.z * (zoomCam.z / roomCam.z) ** k,
    };
  }
  const isMoving = (t) => follow ? shots.some((x) => x.dur > 0.05 && t >= x.t && t < x.t + x.dur)
    : style === "zoom" && ((t >= zoomAt && t < zoomAt + ZOOM_GLIDE) || (t >= outroAt && t < outroAt + 1.0));

  // ---------------------------------------------------------------- drawing

  // Draws in room coordinates, turned with the room.
  const inRoom = (ctx, fn) => { ctx.save(); if (rot) ctx.transform(0, 1, -1, 0, H, 0); fn(); ctx.restore(); };

  function drawRoom(ctx) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, world.w, world.h);
    inRoom(ctx, () => drawShell(ctx));
    // labels stay upright
    ctx.fillStyle = "#9b9b9b"; ctx.font = `20px ${FONT}`; ctx.textBaseline = "middle";
    const label = (txt, x, y, align, vertical) => {
      const [px, py] = P(x, y);
      ctx.save(); ctx.translate(px, py); if (vertical) ctx.rotate(-Math.PI / 2);
      ctx.textAlign = align; ctx.fillText(txt, 0, 0); ctx.restore();
    };
    // Left and right (as you walk in) are what she needs most, so they're bigger and darker.
    const sideLabel = (...a) => { ctx.save(); ctx.font = `bold 28px ${FONT}`; ctx.fillStyle = "#6b6b6b"; label(...a); ctx.restore(); };
    const tb = layout.tables.find((t) => t.row === "B"), ta = layout.tables.find((t) => t.row === "A");
    // The front row reaches the door wall, so the side labels go in the aisle between the rows.
    const ay = tb && ta ? (tb.y1 + ta.y0) / 2 : R.y1 - 22;
    if (rot) {
      sideLabel("↑ Left", R.x0 + 22, ay, "center");
      sideLabel("↓ Right", R.x1 - 22, ay, "center");
      label("DOOR", door.x + door.w / 2 + 26, R.y1 + 30, "center");
      if (tb) label("back row", R.x1 - 18, (tb.y0 + tb.y1) / 2, "center");
      if (ta) label("front row", R.x1 - 18, (ta.y0 + ta.y1) / 2, "center");
    } else {
      sideLabel("← Left", R.x0 + 18, ay, "left");
      sideLabel("Right →", R.x1 - 18, ay, "right");
      label("DOOR", door.x + door.w / 2 + 10, R.y1 + 24, "left");
      if (tb) label("back row", R.x0 + 20, (tb.y0 + tb.y1) / 2, "center", true);
      if (ta) label("front row", R.x0 + 20, (ta.y0 + ta.y1) / 2, "center", true);
    }
    for (const t of layout.tables) drawTable(ctx, t);
  }

  // Flat top plus a thin front edge (always at the bottom on screen) for a bit of depth.
  let hlTable = null; // my bench, once a seat is picked
  function drawTable(ctx, t) {
    const b = box(t.x0, t.y0, t.x1, t.y1);
    const mine = t === hlTable;
    ctx.fillStyle = mine ? ACCENT_PALE_CSS : PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 3); ctx.fill();
    if (mine) {
      // My bench: pale, split into one part per seat, with my part solid and outlined.
      // Turned, people sit 12 further along than seen from the side (where that's their feet).
      const n = seat.count, len = (layout.tableLen - 14) / n, at0 = t.y0 + 7 + (rot ? 12 : 0);
      const cut = (i) => (i === 0 ? t.y0 : i === n ? t.y1 : at0 + i * len); // the end parts run to the table's ends
      const part = (i) => box(t.x0, cut(i), t.x1, cut(i + 1));
      ctx.strokeStyle = "#8a8a8a"; ctx.lineWidth = 1.5;
      for (let i = 1; i < n; i++) {
        const [x0, y0] = P(t.x0, cut(i)), [x1, y1] = P(t.x1, cut(i));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      const p = part(seat.index);
      ctx.fillStyle = ACCENT_CSS; ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 3);
    }
    ctx.stroke();
    ctx.fillStyle = INK; ctx.fillRect(b.x0, b.y1 - 1, b.x1 - b.x0, 6);
  }

  function drawShell(ctx) {
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
  }

  // A plan-view door: frame posts, a swing arc, and a door leaf with a handle. It rests ajar and
  // swings wide open while the friend walks through. An outward door swings into the corridor.
  function drawDoor(ctx, S) {
    const open = smooth(108 - 90, 108 - 35, S) * (1 - smooth(m1.length + 40, m1.length + 130, S));
    const a = (0.22 + 0.74 * open) * Math.PI / 2;
    const hx = door.x - door.w / 2, hy = R.y1, L = door.w - 4;
    // frame posts on both sides of the opening
    ctx.fillStyle = INK;
    ctx.fillRect(hx - 4, hy - 8, 8, 16);
    ctx.fillRect(door.x + door.w / 2 - 4, hy - 8, 8, 16);
    // swing arc and leaf, mirrored across the wall for an outward door
    ctx.save(); ctx.translate(hx, hy); if (room.doorSwing === "out") ctx.scale(1, -1);
    ctx.strokeStyle = FLOOR_INK; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(0, 0, L, -Math.PI / 2, 0); ctx.stroke(); ctx.setLineDash([]);
    ctx.rotate(-a);
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.roundRect(2, -3.5, L - 2, 7, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(L - 8, -7, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawRoute(ctx, S, treasure) {
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
    if (treasure) {
      // a big X where the path ends, then the path drawn in thick dashes with an arrowhead
      const [gx, gy] = route[route.length - 1];
      ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(gx - 13, gy - 13); ctx.lineTo(gx + 13, gy + 13); ctx.moveTo(gx + 13, gy - 13); ctx.lineTo(gx - 13, gy + 13); ctx.stroke();
      if (n > 1) {
        ctx.lineWidth = 5; ctx.setLineDash([14, 10]);
        ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, route[i][0], route[i][1]); ctx.stroke();
        ctx.setLineDash([]);
        if (n < route.length) {
          const [x0, y0] = route[Math.max(0, n - 6)], [x, y] = route[n - 1];
          const ang = Math.atan2(y - y0, x - x0);
          ctx.fillStyle = INK; ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14);
          ctx.lineTo(x + Math.cos(ang + 2.4) * 14, y + Math.sin(ang + 2.4) * 14);
          ctx.lineTo(x + Math.cos(ang - 2.4) * 14, y + Math.sin(ang - 2.4) * 14);
          ctx.closePath(); ctx.fill();
        }
      }
      return;
    }
    if (n > 1) {
      ctx.strokeStyle = "#555"; ctx.lineWidth = 3.5;
      ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, route[i][0], route[i][1]); ctx.stroke();
    }
  }

  // Everything outside a circle around the friend (and a smaller one around me) is faded out.
  function drawSpotlight(ctx, fr, t) {
    const a = { x: fr.x, y: fr.y - 34, r: 95 }, b = { x: me0.x, y: me0.y - 30, r: 62 + 6 * Math.sin(t * 5) };
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const holes = d < a.r + b.r - 20
      ? [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: d / 2 + Math.max(a.r, b.r) }]
      : [a, b];
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.beginPath(); ctx.rect(roomBox.x0 - 400, roomBox.y0 - 400, rbw + 800, rbh + 800);
    for (const h of holes) { ctx.moveTo(h.x + h.r, h.y); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); }
    ctx.fill("evenodd");
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    for (const h of holes) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  // Labels are drawn labelK times bigger on a zoomed-out map, so they stay readable.
  let labelK = 1;
  function pill(ctx, x, y, text, dark) {
    ctx.save(); ctx.translate(x, y + 12); ctx.scale(labelK, labelK); ctx.translate(0, -12);
    ctx.font = `bold 14px ${TAG_FONT}`;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = dark ? INK : PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-w / 2, -12, w, 24, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dark ? PAPER : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  // Speech bubble whose tail points at (x, y). `dx` shifts the body sideways; it is also
  // kept inside the camera bounds.
  function bubble(ctx, x, y, text, k, dx = 0) {
    if (k <= 0) return;
    const s = easeOutBack(clamp01(k)) * labelK;
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
      for (const part of directions.split(", ")) {
        const next = line ? `${line}, ${part}` : part;
        if (line && ctx.measureText(next).width > FRAME.w - 28) { captionLines.push(line); line = part; } else line = next;
      }
      captionLines.push(line);
    }
    const y0 = captionLines.length > 2 ? 58 : 66;
    captionLines.forEach((l, i) => ctx.fillText(l, FRAME.w / 2, y0 + i * 25));
    ctx.fillStyle = "#e2e2e2"; ctx.fillRect(16, FRAME.cap - 2, FRAME.w - 32, 2);
  }

  // Off-screen pointer to "ME" so the destination is always clear while zoomed in.
  function drawMePointer(ctx, cam, t, top) {
    if (t > t2e) return;
    const sx = (me0.x - cam.x) * cam.z + VIEW.w / 2;
    const sy = (me0.y - 40 - cam.y) * cam.z + top + VIEW.h / 2;
    const m = 30, x0 = m, x1 = VIEW.w - m, y0 = top + m, y1 = top + VIEW.h - m;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return;
    const px = Math.max(x0, Math.min(x1, sx)), py = Math.max(y0, Math.min(y1, sy));
    const ang = Math.atan2(sy - py, sx - px);
    ctx.save(); ctx.translate(px, py);
    ctx.fillStyle = INK;
    ctx.save(); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(16, -9); ctx.lineTo(16, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(-22, -13, 44, 26, 13); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = `bold 15px ${TAG_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ME", 0, 1);
    ctx.restore();
  }

  function renderFrame(ctx, t) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, frame.w, frame.h);
    const r = viewRect, cam = frameCam(t);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    labelK = Math.max(1, Math.min(1.8, 0.9 / cam.z)); // readable labels when zoomed out
    renderWorld(ctx, t, { spotlight: style === "spotlight", treasure: style === "treasure" });
    labelK = 1;
    ctx.restore();
    if (follow) drawMePointer(ctx, cam, t, r.y);
    drawCaption(ctx);
  }

  // ui: { map: true } draws a still map for seat picking (no friend), { noSeat } hides "me",
  // { showSeats, hoverId } adds the seat dots.
  function renderWorld(ctx, t, ui = {}) {
    const fr = friendState(t), ms = meState(t);
    hlTable = ui.noSeat ? null : tbl;
    drawRoom(ctx);
    if (!ui.noSeat) drawRoute(ctx, ui.map ? 0 : fr.S, ui.treasure);
    inRoom(ctx, () => drawDoor(ctx, ui.map ? 0 : fr.S));

    // target ring under me until the friend arrives
    if (!ui.noSeat && t < t2e + 0.4) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 1 - smooth(t2e, t2e + 0.4, t);
      ctx.beginPath(); ctx.ellipse(me0.x, me0.y, 26 + pulse * 5, 10 + pulse * 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // characters, back to front
    const actors = people.map((p) => {
      const q = at(p.seat);
      return {
        y: q.y, draw: () => drawSeated(ctx, p.seat, q, { gender: p.gender, pose: seatedPose(p.seat, t, p.seed), ink: CROWD_INK }, "#cfcfcf"),
      };
    });
    if (!ui.noSeat) actors.push({
      y: me0.y + 0.1, draw: () => {
        const view = sitView(seat), chairInk = ms.seated ? INK : "#bbb";
        if (view !== "back" || ms.view !== "back") C.drawChair(ctx, me0.x, me0.y, meFacing, SIZE, chairInk, view);
        C.drawFigure(ctx, me0.x, me0.y, { size: SIZE, gender: me, view: ms.view, facing: ms.facing ?? meFacing, pose: ms.pose });
        if (view === "back" && ms.view === "back") C.drawChair(ctx, me0.x, me0.y, meFacing, SIZE, chairInk, view);
        if (view === "front") drawTable(ctx, seat.table);
      },
    });
    if (!ui.map && !ui.treasure) actors.push({
      y: fr.y, draw: () => {
        C.drawFigure(ctx, fr.x, fr.y, { size: SIZE, gender: friend, view: fr.view, facing: fr.facing, pose: fr.pose });
        // Turned, she ends up behind my table: it hides her legs as she steps in.
        if (rot) { const b = box(tbl.x0, tbl.y0, tbl.x1, tbl.y1); if (fr.y > b.y0 && fr.y < b.y1 + 6) drawTable(ctx, tbl); }
      },
    });
    actors.sort((a, b) => a.y - b.y).forEach((a) => a.draw());

    // seat picker overlay (live preview only)
    if (ui.showSeats) {
      for (const s of layout.seats) {
        const on = !ui.noSeat && s.id === seat.id, hov = s.id === ui.hoverId;
        const q = at(s);
        ctx.beginPath(); ctx.arc(q.x, q.y - 18, hov ? 9 : 6, 0, Math.PI * 2);
        ctx.fillStyle = on || hov ? INK : PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke();
      }
    }

    if (ui.map) {
      if (!ui.noSeat) pill(ctx, me0.x, me0.y - 0.86 * SIZE - 14, "ME", true);
      return;
    }

    if (ui.spotlight) drawSpotlight(ctx, fr, t);

    // labels and speech
    const meHead = me0.y - (ms.seated ? 0.86 : 1.08) * SIZE;
    const frHead = fr.y - 1.08 * SIZE;
    const meSays = t >= standStart + 0.45 && t < t2e + 0.3;
    const frSays = t >= t2e + 0.3;
    const close = Math.hypot(fr.x - me0.x, fr.y - me0.y) < 90;
    const away = Math.abs(fr.x - me0.x) > 4 ? Math.sign(fr.x - me0.x) : -meFacing;
    if (ui.treasure) {
      if (meSays) bubble(ctx, me0.x, meHead - 4, "Over here!", (t - standStart - 0.45) / 0.25);
      else pill(ctx, me0.x, meHead - 14, "ME", true);
      return;
    }
    if (fr.thinking) bubble(ctx, fr.x, frHead - 4, "?", ((t - t1e) / LOOK - 0.12) / 0.08);
    else if (!frSays && !close) pill(ctx, fr.x, frHead - 14, "YOU", false);
    if (meSays) bubble(ctx, me0.x, meHead - 4, "Over here!", (t - standStart - 0.45) / 0.25);
    else if (!frSays) pill(ctx, me0.x, meHead - 14, "ME", true);
    if (frSays) bubble(ctx, fr.x + away * 10, frHead + 6, "Found you!", (t - t2e - 0.3) / 0.25, away * 62);
  }

  // Part of the world the seat-picker map shows (skips the empty strip above the back wall).
  const mapView = rot ? { x0: 0, y0: 0, w: H - R.y0 + 40, h: W } : { x0: 0, y0: 70, w: W, h: H - 70 };

  return { duration, frame, style, renderWorld, mapView, seatPos: at, renderFrame, isMoving, camAt, shots, layout, seat, directions, meet: { friend: fEnd, me: me0 }, timings: { t1s, t1e, t2s, t2e, standStart } };
}

export { W, H };
