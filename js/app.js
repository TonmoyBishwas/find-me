import { W, H, DEFAULT_ROOMS, loadRooms, saveRooms, sanitizeRoom, parseGroups } from "./rooms.js";
import { createScene, FONT, FRAME } from "./scene.js";
import { exportGif } from "./gif.js";

const $ = (id) => document.getElementById(id);
const map = $("map"), mapCtx = map.getContext("2d");
const phone = $("phone"), phoneCtx = phone.getContext("2d");
const MAP_TOP = 70; // the map crops off the empty strip above the back wall

let rooms = loadRooms();
const state = { room: 0, seat: null, me: "m", friend: "f", crowd: true };
let scene = null, t0 = performance.now(), hoverId = null, gifFile = null, gifUrl = null;

// ---- state <-> URL hash (a link reproduces the same animation) ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has("room")) state.room = Math.max(0, Math.min(rooms.length - 1, +p.get("room") || 0));
  if (p.has("seat")) state.seat = p.get("seat");
  if (["m", "f"].includes(p.get("me"))) state.me = p.get("me");
  if (["m", "f"].includes(p.get("friend"))) state.friend = p.get("friend");
  if (p.has("crowd")) state.crowd = p.get("crowd") !== "0";
}
function writeHash() {
  const p = new URLSearchParams({ room: state.room, me: state.me, friend: state.friend });
  if (state.seat) p.set("seat", state.seat);
  if (!state.crowd) p.set("crowd", "0");
  history.replaceState(null, "", "#" + p);
}

function rebuild() {
  scene = createScene(rooms[state.room], state.seat, { me: state.me, friend: state.friend, crowd: state.crowd ? 0.35 : 0 });
  if (!state.seat || !scene.layout.seatById[state.seat]) state.seat = null;
  $("directions").textContent = state.seat ? scene.directions : "No seat picked yet";
  t0 = performance.now();
  clearGif();
  writeHash();
  renderControls();
}

function renderControls() {
  $("rooms").replaceChildren(...rooms.map((r, i) => {
    const b = document.createElement("button");
    b.textContent = r.name; b.setAttribute("aria-pressed", i === state.room);
    b.onclick = () => { state.room = i; state.seat = null; rebuild(); };
    return b;
  }));
  for (const seg of document.querySelectorAll("[data-who]")) {
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", state[seg.dataset.who] === b.dataset.g);
  }
}

for (const seg of document.querySelectorAll("[data-who]")) {
  seg.addEventListener("click", (e) => {
    const g = e.target.closest("button")?.dataset.g;
    if (g) { state[seg.dataset.who] = g; rebuild(); }
  });
}
$("crowd").addEventListener("change", (e) => { state.crowd = e.target.checked; rebuild(); });
$("replay").onclick = () => { t0 = performance.now(); };

// ---- canvases ----
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  map.width = W * dpr; map.height = (H - MAP_TOP) * dpr;
  phone.width = FRAME.w * dpr; phone.height = FRAME.h * dpr;
}
resize();
window.addEventListener("resize", resize);

function toWorld(e) {
  const r = map.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * (H - MAP_TOP) / r.height + MAP_TOP];
}
function seatAt([x, y]) {
  let best = null, bd = 30;
  for (const s of scene.layout.seats) {
    const d = Math.hypot(s.x - x, s.y - 18 - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
map.addEventListener("pointermove", (e) => { hoverId = seatAt(toWorld(e))?.id ?? null; });
map.addEventListener("pointerleave", () => { hoverId = null; });
map.addEventListener("click", (e) => {
  const s = seatAt(toWorld(e));
  if (s) { state.seat = s.id; rebuild(); }
});

function frame(now) {
  const dpr = map.width / W;
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, -MAP_TOP * dpr);
  scene.renderWorld(mapCtx, 0, { map: true, showSeats: true, hoverId, noSeat: !state.seat });

  phoneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.seat) {
    const t = ((now - t0) / 1000) % (scene.duration + 0.6); // short pause, then loop like the GIF
    scene.renderFrame(phoneCtx, Math.min(t, scene.duration));
  } else {
    phoneCtx.fillStyle = "#fff"; phoneCtx.fillRect(0, 0, FRAME.w, FRAME.h);
    phoneCtx.fillStyle = "#777"; phoneCtx.textAlign = "center"; phoneCtx.font = `28px ${FONT}`;
    phoneCtx.fillText("Tap your seat on the map", FRAME.w / 2, FRAME.h / 2);
  }
  requestAnimationFrame(frame);
}

// ---- GIF + sharing ----
function clearGif() {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifFile = gifUrl = null;
  $("ready").hidden = true;
}

$("makeGif").onclick = async () => {
  if (!state.seat) { $("directions").textContent = "Pick your seat on the map first"; return; }
  const btn = $("makeGif"), bar = $("progress");
  btn.disabled = true; bar.hidden = false; bar.value = 0;
  try {
    const blob = await exportGif(scene, { width: +$("gifSize").value, onProgress: (p) => (bar.value = p) });
    clearGif();
    const name = `find-me-${rooms[state.room].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.gif`;
    gifFile = new File([blob], name, { type: "image/gif" });
    gifUrl = URL.createObjectURL(blob);
    $("download").href = gifUrl; $("download").download = name;
    $("gifInfo").textContent = `${(blob.size / 1024 / 1024).toFixed(2)} MB · ${scene.duration.toFixed(0)} s`;
    // Sharing straight into WhatsApp works where the browser can share files (phones).
    $("share").hidden = !(navigator.canShare && navigator.canShare({ files: [gifFile] }));
    $("ready").hidden = false;
  } finally {
    btn.disabled = false; bar.hidden = true;
  }
};

$("share").onclick = async () => {
  if (!gifFile) return;
  try {
    await navigator.share({ files: [gifFile], text: `I'm here: ${scene.directions}` });
  } catch (e) {
    if (e.name !== "AbortError") $("download").click();
  }
};

// ---- room setup ----
function renderEditors() {
  $("roomEditors").replaceChildren(...rooms.map((r) => {
    const d = document.createElement("div");
    d.className = "room-edit";
    d.innerHTML = `
      <label class="full">Name <input type="text" data-k="name"></label>
      <span>Front row, left of door</span><input type="text" data-k="aLeft">
      <span>Front row, right of door</span><input type="text" data-k="aRight">
      <span>Back row</span><input type="text" data-k="b">
      <span>Seats per table side</span><select data-k="seats"><option>1</option><option>2</option><option>3</option><option>4</option></select>`;
    d.querySelector('[data-k="name"]').value = r.name;
    d.querySelector('[data-k="aLeft"]').value = r.rowA.left.join(" ");
    d.querySelector('[data-k="aRight"]').value = r.rowA.right.join(" ");
    d.querySelector('[data-k="b"]').value = r.rowB.join(" ");
    d.querySelector('[data-k="seats"]').value = r.seatsPerSide;
    return d;
  }));
}
$("saveRooms").onclick = () => {
  rooms = [...document.querySelectorAll(".room-edit")].map((d) => {
    const v = (k) => d.querySelector(`[data-k="${k}"]`).value;
    return sanitizeRoom({ name: v("name"), rowA: { left: parseGroups(v("aLeft")), right: parseGroups(v("aRight")) }, rowB: parseGroups(v("b")), seatsPerSide: +v("seats") });
  });
  saveRooms(rooms); rebuild(); renderEditors();
};
$("resetRooms").onclick = () => { rooms = structuredClone(DEFAULT_ROOMS); saveRooms(rooms); state.seat = null; rebuild(); renderEditors(); };
$("copyRooms").onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(rooms, null, 2)); $("copyRooms").textContent = "Copied"; }
  catch { prompt("Copy this:", JSON.stringify(rooms)); }
  setTimeout(() => ($("copyRooms").textContent = "Copy JSON"), 1500);
};

// ---- boot ----
readHash();
$("crowd").checked = state.crowd;
renderEditors();
document.fonts.load(`24px ${FONT}`).finally(() => { rebuild(); requestAnimationFrame(frame); });
window.__app = { get scene() { return scene; }, state, rebuild };
