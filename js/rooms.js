// Room configuration + geometry.
// The map is drawn "as you see it when you walk in": the door is on the bottom wall,
// so map-left is your left and map-right is your right.

export const W = 960, H = 760;
export const ROOM = { x0: 40, x1: 920, y0: 110, y1: 630 };

const TABLE_T = 22;        // table thickness (short side)
const SEAT_OFF = 14;       // seat distance from the table edge
const GROUP_GAP = 26;      // extra walkway between groups of tables
const DOOR_GAP = 150;      // walkway in Row A in front of the door
const SIDE_MARGIN = 52;    // walkway between outer tables and side walls
const BACK_GAP = 40;       // space between back wall and Row B
const MID_AISLE = 90;      // aisle between Row B and Row A
const FRONT_ZONE = 98;     // space between Row A and the door wall
const DOOR_W = 64;

// Row A = the row nearest the door, split by the door into a left part and a right part.
// Row B = the back row. Each part is a list of group sizes (tables per group).
// Real counts, checked in person. Still editable in Settings.
export const DEFAULT_ROOMS = [
  { name: "G Floor Study Room", rowA: { left: [5], right: [3] }, rowB: [7], seatsPerSide: 3 },
  { name: "Second Floor Study Room", rowA: { left: [4], right: [4] }, rowB: [8], seatsPerSide: 3 },
  { name: "Third Floor Study Room", rowA: { left: [3], right: [4] }, rowB: [9], seatsPerSide: 3 },
];

// v2: the v1 setups were guesses made before the real rooms were counted.
const STORE_KEY = "find-me.rooms.v2";

export function loadRooms() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved) && saved.length) return saved.map(sanitizeRoom);
  } catch {}
  return structuredClone(DEFAULT_ROOMS);
}

export function saveRooms(rooms) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rooms)); } catch {}
}

export function sanitizeRoom(r) {
  const groups = (g) => (Array.isArray(g) ? g : []).map((n) => Math.max(1, Math.min(12, n | 0))).filter(Boolean);
  return {
    name: String(r.name || "Study room").slice(0, 40),
    rowA: { left: groups(r.rowA?.left), right: groups(r.rowA?.right) },
    rowB: groups(r.rowB),
    seatsPerSide: Math.max(1, Math.min(4, r.seatsPerSide | 0 || 3)),
  };
}

export function parseGroups(text) {
  return String(text).split(/[\s,+|]+/).map((s) => parseInt(s, 10)).filter((n) => n > 0 && n <= 12);
}

const sum = (a) => a.reduce((x, y) => x + y, 0);

export function buildLayout(room) {
  const R = ROOM;
  const usableH = R.y1 - R.y0 - BACK_GAP - MID_AISLE - FRONT_ZONE;
  const tableLen = Math.min(146, usableH / 2);
  const seatPitch = (tableLen - 14) / room.seatsPerSide;

  const nA = sum(room.rowA.left) + sum(room.rowA.right);
  const gA = Math.max(0, room.rowA.left.length - 1) + Math.max(0, room.rowA.right.length - 1);
  const nB = sum(room.rowB);
  const gB = Math.max(0, room.rowB.length - 1);
  const inner = R.x1 - R.x0 - 2 * SIDE_MARGIN;
  const pitch = Math.min(
    96,
    nB ? (inner - gB * GROUP_GAP) / nB : 96,
    nA ? (inner - gA * GROUP_GAP - DOOR_GAP) / nA : 96,
  );

  const yB = R.y0 + BACK_GAP, yA = yB + tableLen + MID_AISLE;
  const cx = (R.x0 + R.x1) / 2;
  const tables = [];

  const place = (row, groupsList, x, y) => {
    for (let gi = 0; gi < groupsList.length; gi++) {
      if (gi) x += GROUP_GAP;
      for (let k = 0; k < groupsList[gi]; k++) {
        tables.push({ row, x: x + pitch / 2, y0: y, y1: y + tableLen, group: gi });
        x += pitch;
      }
    }
    return x;
  };

  // Row B centred
  const widthB = nB * pitch + gB * GROUP_GAP;
  place("B", room.rowB, cx - widthB / 2, yB);

  // Row A centred, with the door gap between its left and right parts
  const wl = sum(room.rowA.left) * pitch + Math.max(0, room.rowA.left.length - 1) * GROUP_GAP;
  const wr = sum(room.rowA.right) * pitch + Math.max(0, room.rowA.right.length - 1) * GROUP_GAP;
  const startA = cx - (wl + DOOR_GAP + wr) / 2;
  place("A", room.rowA.left, startA, yA);
  const doorX = startA + wl + DOOR_GAP / 2;
  place("A", room.rowA.right, startA + wl + DOOR_GAP, yA);

  const seats = [];
  for (const t of tables) {
    t.x0 = t.x - TABLE_T / 2;
    t.x1 = t.x + TABLE_T / 2;
    t.side = t.x < doorX ? "left" : "right";
  }
  // Number tables per row/side, counting outward from the door.
  for (const row of ["A", "B"]) {
    for (const side of ["left", "right"]) {
      const list = tables.filter((t) => t.row === row && t.side === side)
        .sort((a, b) => Math.abs(a.x - doorX) - Math.abs(b.x - doorX));
      list.forEach((t, i) => { t.fromDoor = i + 1; t.countOnSide = list.length; });
    }
  }
  tables.forEach((t, i) => {
    t.id = `${t.row}${tables.filter((u, j) => u.row === t.row && j < i).length + 1}`;
    for (const s of [-1, 1]) {
      for (let i2 = 0; i2 < room.seatsPerSide; i2++) {
        seats.push({
          id: `${t.id}${s < 0 ? "L" : "R"}${i2 + 1}`,
          table: t, side: s, index: i2, count: room.seatsPerSide,
          x: t.x + s * (TABLE_T / 2 + SEAT_OFF),
          y: t.y0 + 7 + (i2 + 0.5) * seatPitch + 12,
        });
      }
    }
  });

  const layout = {
    room: R, tables, seats, pitch, tableLen,
    seatById: Object.fromEntries(seats.map((s) => [s.id, s])),
    door: { x: doorX, y: R.y1, w: DOOR_W },
  };
  for (const s of seats) s.layout = layout;
  return layout;
}

const LAST = ["", "last", "second last", "third last"];

// The three back-row tables closest to straight across from the door.
function oppositeDoor(L) {
  return L.tables.filter((u) => u.row === "B")
    .sort((a, b) => Math.abs(a.x - L.door.x) - Math.abs(b.x - L.door.x))
    .slice(0, 3);
}

// Kept short on purpose: the animation shows the exact seat, the text only has to orient.
export function describeSeat(seat) {
  const t = seat.table, L = seat.layout;
  const mid = t.row === "B" ? oppositeDoor(L) : [];
  if (mid.includes(t)) return "Opposite the door";
  const side = t.side === "left" ? "Left hand side" : "Right hand side";
  const row = t.row === "A" ? "row by the door" : "row opposite the door";
  // Count from the wall end; only last / second last / third last are named.
  const list = L.tables.filter((u) => u.row === t.row && u.side === t.side && !mid.includes(u))
    .sort((a, b) => Math.abs(b.x - L.door.x) - Math.abs(a.x - L.door.x));
  const n = list.indexOf(t) + 1;
  const bench = list.length > 1 && LAST[n] ? `, ${LAST[n]} bench` : "";
  return `${side}, ${row}${bench}`;
}
