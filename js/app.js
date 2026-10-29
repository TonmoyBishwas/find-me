import { W, H, DEFAULT_ROOMS, loadRooms, saveRooms, sanitizeRoom, parseGroups } from "./rooms.js";
import { createScene, FONT, FRAME, STYLES } from "./scene.js";
import { exportGif } from "./gif.js";

const $ = (id) => document.getElementById(id);
const map = $("map"), mapCtx = map.getContext("2d");
const phone = $("phone"), phoneCtx = phone.getContext("2d");

let rooms = loadRooms();

// Who's who, the crowd toggle and the last room are remembered in this browser.
const PREFS_KEY = "find-me.prefs.v1";
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  const { room, me, friend, crowd, style } = state;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ room, me, friend, crowd, style, playing })); } catch {}
}
const prefs = loadPrefs();
const state = {
  room: Math.max(0, Math.min(rooms.length - 1, prefs.room | 0)),
  seat: null,
  me: prefs.me === "f" ? "f" : "m",
  friend: prefs.friend === "m" ? "m" : "f",
  crowd: prefs.crowd !== false,
  style: STYLES.some((s) => s.id === prefs.style) ? prefs.style : STYLES[0].id,
};
let scene = null, t0 = performance.now(), hoverId = null, gifFile = null, gifUrl = null;
// The preview can be paused (it's heavy on slow phones). Paused, it holds a frame: where it
// stopped, or the last frame (null) after a rebuild.
let playing = prefs.playing !== false, pausedT = null;
let mapDirty = true, drawQueued = false;

// ---- room + seat <-> URL hash (a link opens straight to that seat) ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has("room")) state.room = Math.max(0, Math.min(rooms.length - 1, +p.get("room") || 0));
  if (p.has("seat")) state.seat = p.get("seat");
}
function writeHash() {
  const p = new URLSearchParams({ room: state.room });
  if (state.seat) p.set("seat", state.seat);
  history.replaceState(null, "", "#" + p);
}

function rebuild() {
  scene = createScene(rooms[state.room], state.seat, { me: state.me, friend: state.friend, crowd: state.crowd ? 0.35 : 0, style: state.style });
  if (!state.seat || !scene.layout.seatById[state.seat]) state.seat = null;
  $("directions").textContent = state.seat ? scene.directions : "No seat picked yet";
  $("mapHint").textContent = rooms[state.room].door === "left"
    ? "The door is on the left, so the map's top is your left as you walk in."
    : "The door is at the bottom, so the map's left is your left as you walk in.";
  resize();
  t0 = performance.now(); pausedT = null;
  clearGif();
  writeHash();
  savePrefs();
  renderControls();
}

function renderControls() {
  $("rooms").replaceChildren(...rooms.map((r, i) => {
    const b = document.createElement("button");
    b.textContent = r.name; b.setAttribute("aria-pressed", i === state.room);
    b.onclick = () => { state.room = i; state.seat = null; rebuild(); };
    return b;
  }));
  $("styles").replaceChildren(...STYLES.map((s) => {
    const b = document.createElement("button");
    b.textContent = s.name; b.setAttribute("aria-pressed", s.id === state.style);
    b.onclick = () => { state.style = s.id; rebuild(); };
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
function setPlaying(on, remember = true) {
  if (on !== playing) {
    if (on) t0 = performance.now() - (pausedT ?? 0) * 1000;
    else pausedT = previewT(performance.now());
    playing = on;
    if (remember) savePrefs();
  }
  $("playPause").textContent = playing ? "Pause" : "Play";
  requestDraw();
}
$("playPause").onclick = () => setPlaying(!playing);
$("replay").onclick = () => { pausedT = 0; t0 = performance.now(); setPlaying(true); };
$("themeToggle").onclick = () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("find-me.theme", dark ? "dark" : "light"); } catch {}
};

// ---- canvases ----
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const v = scene?.mapView ?? { w: W, h: H };
  map.width = v.w * dpr; map.height = v.h * dpr;
  map.style.maxWidth = v.h > v.w ? "560px" : ""; // a door-on-the-left room is tall
  map.style.margin = "0 auto";
  const f = scene?.frame ?? FRAME;
  phone.width = f.w * dpr; phone.height = f.h * dpr;
  // keep a tall frame on screen
  phone.parentElement.style.maxWidth = `${Math.min(340, Math.max(220, (innerHeight * 0.66 - 20) * f.w / f.h))}px`;
  mapDirty = true; requestDraw(); // resizing a canvas clears it
}
resize();
window.addEventListener("resize", resize);

function toWorld(e) {
  const r = map.getBoundingClientRect();
  const v = scene.mapView;
  return [(e.clientX - r.left) * v.w / r.width + v.x0, (e.clientY - r.top) * v.h / r.height + v.y0];
}
function seatAt([x, y]) {
  let best = null, bd = 30;
  for (const s of scene.layout.seats) {
    const q = scene.seatPos(s), d = Math.hypot(q.x - x, q.y - 18 - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function setHover(id) {
  if (id !== hoverId) { hoverId = id; mapDirty = true; requestDraw(); }
}
map.addEventListener("pointermove", (e) => setHover(seatAt(toWorld(e))?.id ?? null));
map.addEventListener("pointerleave", () => setHover(null));
map.addEventListener("click", (e) => {
  const s = seatAt(toWorld(e));
  if (s) { state.seat = s.id; rebuild(); }
});

function previewT(now) {
  if (!playing) return pausedT ?? scene.duration;
  const t = ((now - t0) / 1000) % (scene.duration + 0.6); // short pause, then loop like the GIF
  return Math.min(t, scene.duration);
}

// Frames are drawn only while the preview plays, or once after something changes. The map is
// still, so it's redrawn only when it changes.
function requestDraw() {
  if (!drawQueued && scene) { drawQueued = true; requestAnimationFrame(frame); }
}
function frame(now) {
  drawQueued = false;
  const v = scene.mapView, dpr = map.width / v.w;
  if (mapDirty) {
    mapCtx.setTransform(dpr, 0, 0, dpr, -v.x0 * dpr, -v.y0 * dpr);
    scene.renderWorld(mapCtx, 0, { map: true, showSeats: true, hoverId, noSeat: !state.seat });
    mapDirty = false;
  }

  phoneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.seat) {
    scene.renderFrame(phoneCtx, previewT(now));
  } else {
    const f = scene.frame;
    phoneCtx.fillStyle = "#fff"; phoneCtx.fillRect(0, 0, f.w, f.h);
    phoneCtx.fillStyle = "#777"; phoneCtx.textAlign = "center"; phoneCtx.font = `28px ${FONT}`;
    phoneCtx.fillText("Tap your seat on the map", f.w / 2, f.h / 2);
  }
  if (playing && state.seat) requestDraw();
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
  setPlaying(false, false); // the live preview and the encoder together make slow phones crawl
  try {
    const blob = await exportGif(scene, { width: +$("gifSize").value, onProgress: (p) => (bar.value = p) });
    clearGif();
    const name = `find-me-${rooms[state.room].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${state.style}.gif`;
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
    // A watch notification shouldn't give away where, just tell them to open the GIF.
    await navigator.share({ files: [gifFile], text: "I'm here, tap the GIF to find me" });
  } catch (e) {
    if (e.name !== "AbortError") $("download").click();
  }
};

// ---- settings panel ----
const settings = $("settings");
$("openSettings").onclick = () => { renderEditors(); settings.showModal(); }; // unsaved room edits are dropped on reopen
settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); }); // tap outside closes

function flash(btn, text) {
  const old = btn.dataset.label ??= btn.textContent;
  btn.textContent = text;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => (btn.textContent = old), 1500);
}
function renderEditors() {
  $("roomEditors").replaceChildren(...rooms.map((r) => {
    const d = document.createElement("div");
    d.className = "room-edit";
    d.innerHTML = `
      <label class="full">Name <input type="text" data-k="name"></label>
      <span>Front row, left of door</span><input type="text" data-k="aLeft">
      <span>Front row, right of door</span><input type="text" data-k="aRight">
      <span>Back row</span><input type="text" data-k="b">
      <span>Seats per table side</span><select data-k="seats"><option>1</option><option>2</option><option>3</option><option>4</option></select>
      <span>Door on the map</span><select data-k="door"><option value="bottom">Bottom</option><option value="left">Left</option></select>
      <span>Door opens</span><select data-k="doorSwing"><option value="in">Inward</option><option value="out">Outward</option></select>`;
    d.querySelector('[data-k="name"]').value = r.name;
    d.querySelector('[data-k="aLeft"]').value = r.rowA.left.join(" ");
    d.querySelector('[data-k="aRight"]').value = r.rowA.right.join(" ");
    d.querySelector('[data-k="b"]').value = r.rowB.join(" ");
    d.querySelector('[data-k="seats"]').value = r.seatsPerSide;
    d.querySelector('[data-k="door"]').value = r.door;
    d.querySelector('[data-k="doorSwing"]').value = r.doorSwing;
    return d;
  }));
}
$("saveRooms").onclick = () => {
  rooms = [...document.querySelectorAll(".room-edit")].map((d) => {
    const v = (k) => d.querySelector(`[data-k="${k}"]`).value;
    return sanitizeRoom({ name: v("name"), rowA: { left: parseGroups(v("aLeft")), right: parseGroups(v("aRight")) }, rowB: parseGroups(v("b")), seatsPerSide: +v("seats"), door: v("door"), doorSwing: v("doorSwing") });
  });
  saveRooms(rooms); rebuild(); renderEditors();
  flash($("saveRooms"), "Saved ✓");
};
$("resetRooms").onclick = () => {
  if (!confirm("Reset all rooms to the built-in layout? Your saved setup will be lost.")) return;
  rooms = structuredClone(DEFAULT_ROOMS); saveRooms(rooms); state.seat = null; rebuild(); renderEditors();
};
$("copyRooms").onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(rooms, null, 2)); flash($("copyRooms"), "Copied"); }
  catch { prompt("Copy this:", JSON.stringify(rooms)); }
};

// ---- boot ----
readHash();
$("crowd").checked = state.crowd;
document.fonts.load(`24px ${FONT}`).finally(() => { rebuild(); setPlaying(playing, false); });
window.__app = { get scene() { return scene; }, state, rebuild };
