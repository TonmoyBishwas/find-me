// Style #9 "expressive stick" characters: outlined tube limbs, big round head, dot eyes.
// Drawn procedurally from a small skeleton so walking, sitting and waving stay consistent.
//
// Units: a standing figure is ~105 units tall; draw() scales to the requested pixel height.
// Angles: 0 = pointing straight down. Side view: positive = toward the facing direction.
// Front/back view arms: positive = away from the body.

const THIGH = 24, SHIN = 23, FOOT_H = 4, TORSO = 30, HEAD_R = 13, ARM_U = 17, ARM_F = 16;
const LIMB_W = 9.5, TORSO_W = 17, OUTLINE = 2.5;
export const SEAT_H = 30;

// Gait: each foot follows an explicit path relative to the hip — planted (moving back at
// exactly body speed, so it never slides) for DUTY of the cycle, then an eased swing forward.
// Knees are solved with two-bone IK from the hip and ankle positions.
const STRIDE = 74, DUTY = 0.58, SWING_LIFT = 9, HIP_MID = 43.2, HIP_BOB = 2;
const LEG_R = (THIGH + SHIN) * 0.995;

/** Distance (in units) covered by one full gait cycle (two steps). */
export const STRIDE_UNITS = STRIDE;

const lerp = (a, b, k) => a + (b - a) * k;
const P = (o, ang, len, f) => [o[0] + Math.sin(ang) * len * f, o[1] + Math.cos(ang) * len];

function legPhase(phi, i) { const c = phi / (2 * Math.PI) + 0.5 * i; return c - Math.floor(c); }

function footPath(p) {
  const half = DUTY * STRIDE / 2;
  if (p < DUTY) {
    const k = p / DUTY;
    const rot = k < 0.12 ? -0.25 * (1 - k / 0.12) : k > 0.82 ? 0.4 * ((k - 0.82) / 0.18) : 0;
    return { x: half - k * DUTY * STRIDE, lift: 0, rot, q: -1 };
  }
  const q = (p - DUTY) / (1 - DUTY);
  const ease = (1 - Math.cos(Math.PI * q)) / 2;
  return {
    x: -half + STRIDE * ease - (1 - DUTY) * STRIDE * q,
    lift: SWING_LIFT * Math.sin(Math.PI * q) * (1 - 0.35 * q),
    rot: 0.4 * (1 - q) ** 2 - 0.25 * q * q, q,
  };
}

const hipHeight = (phi) => HIP_MID - HIP_BOB * Math.cos(2 * phi);

const autoHip = (p) => p.hipY ?? -Math.max(...[0, 1].map((i) => Math.cos(p.thigh[i]) * THIGH + Math.cos(p.shin[i]) * SHIN)) - FOOT_H;

// ---- side-view poses ----------------------------------------------------------------

export function sideStand() {
  return { lean: 0.02, thigh: [0.05, -0.04], shin: [0.03, -0.03], upper: [0.1, -0.06], fore: [0.28, 0.18], foot: [0, 0], sit: 0, mouth: "smile" };
}

export function sideWalk(phi) {
  const h = hipHeight(phi);
  const p = { lean: 0.07, thigh: [], shin: [], upper: [], fore: [], foot: [], sit: 0, mouth: "smile", hipY: -(h + FOOT_H) };
  for (let i = 0; i < 2; i++) {
    const lp = legPhase(phi, i);
    const fp = footPath(lp);
    let x = fp.x, dy = h - fp.lift;
    const d0 = Math.hypot(x, dy);
    if (d0 > LEG_R) { x *= LEG_R / d0; dy *= LEG_R / d0; }   // toe-off: heel rises a touch
    const d = Math.max(Math.abs(THIGH - SHIN) + 0.5, Math.hypot(x, dy));
    const alpha = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
    const thigh = Math.atan2(x, dy) + alpha;
    const kx = Math.sin(thigh) * THIGH, ky = Math.cos(thigh) * THIGH;
    p.thigh[i] = thigh;
    p.shin[i] = Math.atan2(x - kx, dy - ky);
    p.foot[i] = fp.rot;
    const swingArm = -Math.cos(2 * Math.PI * lp);          // arm opposite to its leg
    p.upper[i] = 0.42 * swingArm;
    p.fore[i] = p.upper[i] + 0.25 + 0.4 * Math.max(0, swingArm);
  }
  return p;
}

export function sideSit(t = 0, seed = 0) {
  const w = Math.sin(t * 3.1 + seed * 7);
  return {
    lean: 0.12 + 0.03 * Math.sin(t * 1.3 + seed),
    thigh: [1.5, 1.45], shin: [0.12, 0.05],
    upper: [0.75 + 0.05 * w, 0.65], fore: [1.4 + 0.08 * w, 1.3], foot: [0, 0],
    sit: 1, mouth: "smile",
  };
}

export function sideSearch(t) {
  const sway = Math.sin(t * 5) * 0.03;
  return { lean: -0.04 + sway, thigh: [0.06, -0.05], shin: [0.04, -0.04], upper: [2.25, -0.04], fore: [3.85, 0.16], foot: [0, 0], sit: 0, mouth: "o" };
}

export function sideWave(t) {
  return { lean: 0.0, thigh: [0.05, -0.04], shin: [0.03, -0.03], upper: [2.2, -0.05], fore: [2.7 + 0.4 * Math.sin(t * 13), 0.18], foot: [0, 0], sit: 0, mouth: "open" };
}

export function lerpPose(a, b, k) {
  const out = {
    lean: lerp(a.lean, b.lean, k), sit: lerp(a.sit, b.sit, k), mouth: k < 0.5 ? a.mouth : b.mouth,
    hipY: lerp(autoHip(a), autoHip(b), k),
  };
  for (const key of ["thigh", "shin", "upper", "fore", "foot"]) out[key] = [0, 1].map((i) => lerp(a[key][i], b[key][i], k));
  return out;
}

// ---- front/back-view poses ----------------------------------------------------------

export function frontStand() {
  return { lift: [0, 0], bob: 0, sway: 0, upper: [0.12, 0.12], fore: [0.06, 0.06], mouth: "smile" };
}

export function frontWalk(phi) {
  const lps = [0, 1].map((i) => legPhase(phi, i));
  const arm = lps.map((lp) => -Math.cos(2 * Math.PI * lp));
  return {
    lift: lps.map((lp) => footPath(lp).lift * 0.8),
    bob: THIGH + SHIN - hipHeight(phi),
    sway: 1.4 * Math.sin(2 * Math.PI * lps[0] - 0.9),
    upper: arm.map((s) => 0.12 + 0.05 * s), fore: arm.map((s) => 0.08 - 0.45 * Math.max(0, s)),
    mouth: "smile",
  };
}

export function frontWave(t, happy = true) {
  return {
    lift: [0, 0], bob: 0.8 * Math.abs(Math.sin(t * 6.5)), sway: 0,
    upper: [0.14, 2.5], fore: [0.08, 2.95 + 0.4 * Math.sin(t * 13)], mouth: happy ? "open" : "smile",
  };
}

// Seated, seen from the front (facing the viewer) or from behind. Hands rest forward on the desk.
export function frontSit(t = 0, seed = 0) {
  const w = Math.sin(t * 3.1 + seed * 7);
  return { lift: [0, 0], bob: 0, sway: 0.6 * Math.sin(t * 1.3 + seed), upper: [0.35, 0.3 + 0.06 * w], fore: [-0.5, -0.45 - 0.1 * w], sit: 1, mouth: "smile" };
}

export function lerpFront(a, b, k) {
  const out = { bob: lerp(a.bob, b.bob, k), sway: lerp(a.sway, b.sway, k), sit: lerp(a.sit ?? 0, b.sit ?? 0, k), mouth: k < 0.5 ? a.mouth : b.mouth };
  for (const key of ["lift", "upper", "fore"]) out[key] = [0, 1].map((i) => lerp(a[key][i], b[key][i], k));
  return out;
}

// ---- drawing ------------------------------------------------------------------------

function tube(ctx, pts, w, ink, paper) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = w; ctx.strokeStyle = ink; ctx.stroke();
  ctx.lineWidth = w - 2 * OUTLINE; ctx.strokeStyle = paper; ctx.stroke();
}

function blob(ctx, x, y, rx, ry, rot, ink, paper) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = paper; ctx.fill();
  ctx.lineWidth = OUTLINE; ctx.strokeStyle = ink; ctx.stroke();
}

function drawHead(ctx, c, view, f, gender, mouth, ink, paper) {
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.scale(view === "side" ? f : 1, 1);
  ctx.lineWidth = OUTLINE; ctx.strokeStyle = ink; ctx.fillStyle = paper;
  ctx.beginPath(); ctx.arc(0, 0, HEAD_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // hair
  ctx.beginPath();
  if (gender === "f") {
    if (view === "side") {
      ctx.moveTo(10.5, -4);
      ctx.quadraticCurveTo(13, -13, 2, -15.5);
      ctx.bezierCurveTo(-12, -17.5, -17.5, -6, -15.5, 6);
      ctx.lineTo(-14.5, 13.5);
      ctx.quadraticCurveTo(-9.5, 15.5, -5, 12.5);
      ctx.quadraticCurveTo(-7.5, 2, -2, -6.5);
      ctx.quadraticCurveTo(4.5, -9.5, 10.5, -4);
    } else if (view === "front") {
      ctx.moveTo(-14.5, 13);
      ctx.lineTo(-15.5, 0);
      ctx.bezierCurveTo(-16, -19, 16, -19, 15.5, 0);
      ctx.lineTo(14.5, 13);
      ctx.quadraticCurveTo(12, 15, 9.5, 12);
      ctx.lineTo(10, -3);
      ctx.quadraticCurveTo(0, -10, -10, -3);
      ctx.lineTo(-9.5, 12);
      ctx.quadraticCurveTo(-12, 15, -14.5, 13);
    } else {
      ctx.moveTo(-14.5, 13);
      ctx.lineTo(-15.5, 0);
      ctx.bezierCurveTo(-16, -19, 16, -19, 15.5, 0);
      ctx.lineTo(14.5, 13);
      ctx.quadraticCurveTo(0, 16.5, -14.5, 13);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.lineCap = "round";
    const tufts = view === "side" ? [[-4, -12.5, -7.5, -17], [0, -13, -1, -18.5], [4, -12, 6.5, -16.5]]
      : [[-4, -12.5, -6, -17.5], [0, -13, 0.5, -18.5], [4, -12.5, 6.5, -17]];
    for (const [x0, y0, x1, y1] of tufts) { ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 - 1.5, (y0 + y1) / 2, x1, y1); }
    ctx.stroke();
  }

  // face
  if (view !== "back") {
    ctx.fillStyle = ink;
    const eyes = view === "side" ? [[5.5, -1.5]] : [[-4.5, -1.5], [4.5, -1.5]];
    for (const [x, y] of eyes) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = 1.8; ctx.beginPath();
    const mx = view === "side" ? 6.5 : 0, my = 4.5;
    if (mouth === "o") { ctx.arc(mx, my + 0.5, 1.8, 0, Math.PI * 2); ctx.stroke(); }
    else if (mouth === "open") {
      ctx.moveTo(mx - 4, my - 0.5); ctx.quadraticCurveTo(mx, my + 7, mx + 4, my - 0.5); ctx.closePath();
      ctx.fill();
    } else { ctx.arc(mx, my - 2.5, 4, 0.35 * Math.PI, 0.75 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
}

function drawSide(ctx, p, gender, f, ink, paper) {
  const hipY = lerp(autoHip(p), -SEAT_H, p.sit);
  const hip = [0, hipY];
  const up = Math.PI - p.lean;
  const neck = P(hip, up, TORSO, f);
  const shoulder = P(hip, up, TORSO - 3, f);
  const head = P(neck, Math.PI - p.lean * 0.6, HEAD_R + 3, f);

  const legs = [0, 1].map((i) => {
    const knee = P(hip, p.thigh[i], THIGH, f), ankle = P(knee, p.shin[i], SHIN, f);
    return { knee, ankle, rot: (p.foot?.[i] ?? 0) * f };
  });
  const arms = [0, 1].map((i) => {
    const elbow = P(shoulder, p.upper[i], ARM_U, f);
    return { elbow, hand: P(elbow, p.fore[i], ARM_F, f) };
  });

  const drawLeg = (L) => {
    tube(ctx, [hip, L.knee, L.ankle], LIMB_W, ink, paper);
    const c = Math.cos(L.rot), s = Math.sin(L.rot), ox = 3.5 * f, oy = 0.4;
    blob(ctx, L.ankle[0] + ox * c - oy * s, L.ankle[1] + ox * s + oy * c, 7, 3.8, L.rot, ink, paper);
  };
  const drawArm = (A) => {
    tube(ctx, [shoulder, A.elbow, A.hand], LIMB_W - 0.5, ink, paper);
    blob(ctx, A.hand[0], A.hand[1], 4.6, 4.6, 0, ink, paper);
  };

  drawArm(arms[1]);
  drawLeg(legs[1]);
  drawLeg(legs[0]);
  tube(ctx, [[hip[0], hip[1] + 2], neck], TORSO_W, ink, paper);
  if (gender === "f") {
    const top = [lerp(neck[0], hip[0], 0.45), lerp(neck[1], hip[1], 0.45)];
    const fwd = Math.max(p.thigh[0], p.thigh[1], 0), back = Math.max(-p.thigh[0], -p.thigh[1], 0);
    const bottomY = hipY + lerp(15, 6, p.sit);
    const front = lerp(12 + 12 * fwd, 24, p.sit), rear = lerp(11 + 12 * back, 9, p.sit);
    ctx.beginPath();
    ctx.moveTo(top[0] - 7.5 * f, top[1]);
    ctx.lineTo(top[0] + 7.5 * f, top[1]);
    ctx.quadraticCurveTo(hip[0] + front * 0.7 * f, hipY, hip[0] + front * f, bottomY);
    ctx.quadraticCurveTo(hip[0], bottomY + 2.5, hip[0] - rear * f, bottomY);
    ctx.quadraticCurveTo(hip[0] - rear * 0.7 * f, hipY, top[0] - 7.5 * f, top[1]);
    ctx.fillStyle = paper; ctx.fill(); ctx.lineWidth = OUTLINE; ctx.strokeStyle = ink; ctx.stroke();
  }
  drawHead(ctx, head, "side", f, gender, p.mouth, ink, paper);
  drawArm(arms[0]);
}

function drawFront(ctx, p, gender, view, ink, paper) {
  const sit = p.sit ?? 0;
  const hipY = lerp(-(THIGH + SHIN + FOOT_H) + p.bob, -SEAT_H, sit);
  const sway = p.sway;
  const neck = [sway * 0.6, hipY - TORSO];
  const head = [sway * 0.5, neck[1] - HEAD_R - 3];

  for (let i = 0; i < 2; i++) {
    const sx = i ? 1 : -1, L = p.lift[i];
    const hip = [sway + sx * 5.5, hipY];
    const ankle = [sway * 0.3 + sx * 6.5, -FOOT_H - L];
    // Sitting, the thighs point at (or away from) the viewer, so the knee shows just below the hip.
    const knee = [
      (hip[0] + ankle[0]) / 2 + sx * (1.2 + 0.35 * L + 1.5 * sit),
      lerp((hip[1] + ankle[1]) / 2 - L * 0.3, hipY + 5, sit),
    ];
    tube(ctx, [hip, knee, ankle], LIMB_W, ink, paper);
    blob(ctx, ankle[0] + sx * 0.8, ankle[1] + 0.6, 5, 3.6, 0, ink, paper);
  }
  tube(ctx, [[sway, hipY + 3], neck], TORSO_W + 2, ink, paper);
  if (gender === "f") {
    const top = hipY - 14, bot = hipY + 14, spread = 16 + Math.abs(p.lift[0] - p.lift[1]) * 0.5;
    ctx.beginPath();
    ctx.moveTo(sway - 9, top); ctx.lineTo(sway + 9, top);
    ctx.quadraticCurveTo(sway + 12, hipY, sway + spread, bot);
    ctx.quadraticCurveTo(sway, bot + 3, sway - spread, bot);
    ctx.quadraticCurveTo(sway - 12, hipY, sway - 9, top);
    ctx.fillStyle = paper; ctx.fill(); ctx.lineWidth = OUTLINE; ctx.strokeStyle = ink; ctx.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const sx = i ? 1 : -1;
    const sh = [neck[0] + sx * 10, neck[1] + 4.5];
    const elbow = [sh[0] + sx * Math.sin(p.upper[i]) * ARM_U, sh[1] + Math.cos(p.upper[i]) * ARM_U];
    const hand = [elbow[0] + sx * Math.sin(p.fore[i]) * ARM_F, elbow[1] + Math.cos(p.fore[i]) * ARM_F];
    tube(ctx, [sh, elbow, hand], LIMB_W - 0.5, ink, paper);
    blob(ctx, hand[0], hand[1], 4.6, 4.6, 0, ink, paper);
  }
  drawHead(ctx, head, view, 1, gender, p.mouth, ink, paper);
}

/**
 * Draw a figure with its feet at (x, y).
 * opts: { size (px tall), gender: "m"|"f", view: "side"|"front"|"back", facing: 1|-1, pose, ink, paper }
 */
export function drawFigure(ctx, x, y, opts) {
  const { size = 64, gender = "m", view = "side", facing = 1, pose, ink = "#111", paper = "#fff" } = opts;
  ctx.save();
  ctx.translate(x, y);
  const u = size / 105;
  ctx.scale(u, u);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (view === "side") drawSide(ctx, pose, gender, facing, ink, paper);
  else drawFront(ctx, pose, gender, view, ink, paper);
  ctx.restore();
}

/**
 * Chair for a seated figure. Side and front view: draw before the figure (the backrest is behind
 * them). Back view: draw after, so the backrest covers their back.
 */
export function drawChair(ctx, x, y, facing, size, ink, view = "side") {
  const u = size / 105;
  ctx.save();
  if (view !== "side") {
    ctx.translate(x, y); ctx.scale(u, u);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ink; ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-13, -SEAT_H + 5); ctx.lineTo(13, -SEAT_H + 5);
    ctx.moveTo(-11, -SEAT_H + 5); ctx.lineTo(-11, 0);
    ctx.moveTo(11, -SEAT_H + 5); ctx.lineTo(11, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-14, -SEAT_H - 26, 28, 24, 3);
    if (view === "back") { ctx.fillStyle = "#fff"; ctx.fill(); }
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.translate(x, y); ctx.scale(u * facing, u);
  ctx.lineCap = "round"; ctx.strokeStyle = ink; ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-9, -SEAT_H + 5); ctx.lineTo(14, -SEAT_H + 5);    // seat
  ctx.moveTo(-7, -SEAT_H + 5); ctx.lineTo(-7, 0);               // back leg
  ctx.moveTo(12, -SEAT_H + 5); ctx.lineTo(12, 0);               // front leg
  ctx.moveTo(-9, -SEAT_H + 5); ctx.lineTo(-13, -SEAT_H - 24);  // backrest
  ctx.stroke();
  ctx.restore();
}
