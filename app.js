(() => {
'use strict';

/* =====================================================================
   Constants
   ===================================================================== */
const $ = (s) => document.querySelector(s);
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const editor = $('#editor');

const FONT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';
const INK = ['#1e1e1e', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#9c36b5', '#868e96', '#ffffff'];
const NOTE_COLORS = ['#fff3a3', '#b8f2c0', '#ffc9de', '#bfe3ff', '#ffd8a8', '#e5dbff'];
const NOTE_FONT = 20, NOTE_PAD = 14, LINE_H = 1.25;
const STORE_KEY = 'whiteboard.v1';
const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];
const LINEY = ['stroke', 'rect', 'ellipse', 'line', 'arrow', 'link'];   // objects that have color + size
const EDITABLE = ['text', 'note', 'device', 'link'];                    // objects whose .text can be edited
const BACKGROUNDS = ['dots', 'grid', 'lines', 'none'];
const DEVICE_SIZE = 64, LINK_FONT = 13;

/* ---- network device library -------------------------------------------------
   Symbols are generic network glyphs on vendor-coloured tiles (not vendor logos).
   Drop official icon files into ./icons and list them in icons/manifest.json to
   add them to the palette as well. */
const VENDORS = {
  generic: { name: 'Generic', color: '#475569' },
  cisco: { name: 'Cisco', color: '#049fd9' },
  palo: { name: 'Palo Alto Networks', color: '#fa582d' },
  fortinet: { name: 'Fortinet', color: '#da291c' },
  user: { name: 'User icons', color: '#7c3aed' },       // icons added through the palette (saved in icons/user/)
  custom: { name: 'Custom icons', color: '#6b7280' },   // extra vendors listed in icons/manifest.json
};

// 64x64 glyphs, stroked white. "h.01" draws a dot (round cap).
const GLYPHS = {
  router: ['M32 14v36M14 32h36', 'M27 19l5-5 5 5M27 45l5 5 5-5M19 27l-5 5 5 5M45 27l5 5-5 5'],
  switch: ['M12 20h40v24H12z', 'M18 28h22M35 24l5 4-5 4', 'M46 36H24M29 32l-5 4 5 4'],
  firewall: ['M12 16h40v32H12z', 'M12 27h40M12 38h40M26 16v11M40 27v11M26 38v10'],
  ap: ['M16 28a22 22 0 0 1 32 0', 'M22 34a14 14 0 0 1 20 0', 'M28 40a6 6 0 0 1 8 0', 'M32 47h.01'],
  wlc: ['M12 38h40v12H12z', 'M18 44h.01M24 44h.01', 'M20 28a17 17 0 0 1 24 0', 'M26 33a9 9 0 0 1 12 0'],
  server: ['M14 14h36v10H14zM14 27h36v10H14zM14 40h36v10H14z', 'M20 19h.01M20 32h.01M20 45h.01'],
  database: ['M16 18a16 6 0 0 0 32 0 16 6 0 0 0-32 0', 'M16 18v28a16 6 0 0 0 32 0V18', 'M16 32a16 6 0 0 0 32 0'],
  pc: ['M14 16h36v24H14z', 'M26 49h12M32 40v9'],
  cloud: ['M22 46a9 9 0 0 1-1-18 13 13 0 0 1 25 3 8 8 0 0 1-2 15z'],
  cloudshield: ['M22 46a9 9 0 0 1-1-18 13 13 0 0 1 25 3 8 8 0 0 1-2 15z', 'M32 30l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9v-5z'],
  vpn: ['M32 12l16 6v12c0 10-7 17-16 22-9-5-16-12-16-22V18z', 'M26 32v-3a6 6 0 0 1 12 0v3M25 32h14v9H25z'],
  nac: ['M32 12l16 6v12c0 10-7 17-16 22-9-5-16-12-16-22V18z', 'M24 32l6 6 11-12'],
  manager: ['M14 14h36v36H14z', 'M22 42v-8M32 42V26M42 42v-12'],
  logging: ['M14 14h36v36H14z', 'M20 40l8-8 6 5 10-14'],
  loadbalancer: ['M12 32h12', 'M24 32l16-14h12M24 32h28M24 32l16 14h12', 'M52 18h.01M52 32h.01M52 46h.01'],
};

const DEVICES = [];
const DEV_BY_KIND = {};
function registerDevice(def) { DEVICES.push(def); DEV_BY_KIND[def.kind] = def; }
[
  ['generic', 'router', 'Router', 'Router', 'router'],
  ['generic', 'switch', 'Switch', 'Switch', 'switch'],
  ['generic', 'l3switch', 'L3 Switch', 'L3 Switch', 'switch', 'L3'],
  ['generic', 'firewall', 'Firewall', 'Firewall', 'firewall'],
  ['generic', 'loadbalancer', 'Load Balancer', 'Load Balancer', 'loadbalancer'],
  ['generic', 'ap', 'Wireless AP', 'Wireless AP', 'ap'],
  ['generic', 'server', 'Server', 'Server', 'server'],
  ['generic', 'database', 'Database', 'Database', 'database'],
  ['generic', 'pc', 'Workstation', 'Workstation', 'pc'],
  ['generic', 'cloud', 'Cloud / Internet', 'Internet', 'cloud'],
  ['generic', 'vpn', 'VPN Gateway', 'VPN', 'vpn'],

  ['cisco', 'cisco-router', 'ISR / ASR Router', 'Cisco Router', 'router'],
  ['cisco', 'cisco-switch', 'Catalyst Switch', 'Cisco Switch', 'switch'],
  ['cisco', 'cisco-l3', 'L3 / Nexus Switch', 'Cisco L3 Switch', 'switch', 'L3'],
  ['cisco', 'cisco-fw', 'Secure Firewall (ASA/FTD)', 'Cisco Firewall', 'firewall'],
  ['cisco', 'cisco-ap', 'Access Point', 'Cisco AP', 'ap'],
  ['cisco', 'cisco-wlc', 'Wireless Controller', 'Cisco WLC', 'wlc'],
  ['cisco', 'cisco-ise', 'ISE', 'Cisco ISE', 'nac'],
  ['cisco', 'cisco-mgr', 'FMC / DNA Center', 'Cisco FMC', 'manager'],

  ['palo', 'pa-fw', 'PA-Series Firewall', 'Palo Alto FW', 'firewall'],
  ['palo', 'pa-vm', 'VM-Series Firewall', 'VM-Series', 'firewall', 'VM'],
  ['palo', 'pa-panorama', 'Panorama', 'Panorama', 'manager'],
  ['palo', 'pa-prisma', 'Prisma Access', 'Prisma Access', 'cloudshield'],
  ['palo', 'pa-gp', 'GlobalProtect', 'GlobalProtect', 'vpn'],
].forEach(([vendor, kind, name, label, glyph, tag]) => registerDevice({ vendor, kind, name, label, glyph, tag }));

const ICONS = {
  select: '<path d="M5 3l14 7-6 2-2 6z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V3.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 14"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  highlighter: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="M7 21h10"/><path d="M5.5 13.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 20H8l-2.5-2.5a2 2 0 0 1 0-2.8z"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  text: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  note: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  device: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const TOOLS = [
  { id: 'select', icon: 'select', title: 'Select (V)', key: 'v' },
  { id: 'pan', icon: 'hand', title: 'Pan (hold Space)', key: 'g' },
  'sep',
  { id: 'pen', icon: 'pen', title: 'Pen (P)', key: 'p' },
  { id: 'highlighter', icon: 'highlighter', title: 'Highlighter (H)', key: 'h' },
  { id: 'eraser', icon: 'eraser', title: 'Eraser (E)', key: 'e' },
  'sep',
  { id: 'rect', icon: 'rect', title: 'Rectangle (R)', key: 'r' },
  { id: 'ellipse', icon: 'ellipse', title: 'Ellipse (O)', key: 'o' },
  { id: 'line', icon: 'line', title: 'Line (L)', key: 'l' },
  { id: 'arrow', icon: 'arrow', title: 'Arrow (A)', key: 'a' },
  'sep',
  { id: 'text', icon: 'text', title: 'Text (T)', key: 't' },
  { id: 'note', icon: 'note', title: 'Sticky note (N)', key: 'n' },
  'sep',
  { id: 'device', icon: 'device', title: 'Network devices (D)', key: 'd', action: true },
  { id: 'link', icon: 'link', title: 'Connect devices (C)', key: 'c' },
  'sep',
  { id: 'image', icon: 'image', title: 'Image (I)', key: 'i', action: true },
  { id: 'ruler', icon: 'ruler', title: 'Ruler (K) - draw along its edge', key: 'k', action: true },
];

/* =====================================================================
   State
   ===================================================================== */
const state = {
  title: 'Untitled board',
  objects: [],
  view: { x: 0, y: 0, scale: 1 },
  bg: 'dots',
  ruler: null,
};
const view = state.view;

const ui = {
  tool: 'pen',
  color: INK[0],
  noteColor: NOTE_COLORS[0],
  size: { pen: 3, highlighter: 18, eraser: 24, shape: 3, text: 28, link: 3 },
  deviceKind: 'cisco-router',
  linkDash: false,
  selection: new Set(),
  editing: null,       // { id, isNew, before }
  spaceDown: false,
  pointer: { x: 0, y: 0, inside: false },
  hoverCursor: '',
};

let dpr = 1;
let raf = 0;
let g = null;          // current gesture
let draft = null;      // object being drawn (not yet in state.objects)
let clip = [];         // internal copy buffer
let pasteCount = 0;
const pointers = new Map();
const imgCache = new Map();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sizeKey = (tool) => (SHAPES.includes(tool) ? 'shape' : tool);

/* =====================================================================
   Coordinates & view
   ===================================================================== */
const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
const toScreen = (wx, wy) => ({ x: wx * view.scale + view.x, y: wy * view.scale + view.y });

function zoomAt(cx, cy, factor) {
  const ns = clamp(view.scale * factor, 0.1, 8);
  const f = ns / view.scale;
  view.x = cx - (cx - view.x) * f;
  view.y = cy - (cy - view.y) * f;
  view.scale = ns;
  viewChanged();
}

function viewChanged() {
  $('#zoomLabel').textContent = Math.round(view.scale * 100) + '%';
  scheduleSave();
  requestDraw();
}

function fitContent() {
  const W = innerWidth, H = innerHeight;
  if (!state.objects.length) {
    view.x = 0; view.y = 0; view.scale = 1;
  } else {
    const b = unionBounds(state.objects);
    const s = clamp(Math.min((W - 220) / Math.max(b.w, 1), (H - 220) / Math.max(b.h, 1)), 0.1, 2);
    view.scale = s;
    view.x = W / 2 - (b.x + b.w / 2) * s;
    view.y = H / 2 - (b.y + b.h / 2) * s;
  }
  viewChanged();
}

/* =====================================================================
   Geometry helpers
   ===================================================================== */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const normRect = (o) => [Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2)];

function wrapLines(c, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (c.measureText(test).width <= maxW) { line = test; continue; }
      if (line) { out.push(line); line = ''; }
      let chunk = '';
      for (const ch of word) {
        if (chunk && c.measureText(chunk + ch).width > maxW) { out.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

function textMetrics(o) {
  ctx.save();
  ctx.font = `${o.fontSize}px ${FONT}`;
  const lines = o.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  ctx.restore();
  return { w: Math.max(w, 4), h: lines.length * o.fontSize * LINE_H, lines };
}

function bounds(o) {
  switch (o.type) {
    case 'stroke': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of o.points) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
      const r = o.size / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + o.size, h: y1 - y0 + o.size };
    }
    case 'rect': case 'ellipse': case 'line': case 'arrow': {
      const [x0, y0, x1, y1] = normRect(o);
      const r = o.size / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + o.size, h: y1 - y0 + o.size };
    }
    case 'text': {
      const m = textMetrics(o);
      return { x: o.x, y: o.y, w: m.w, h: m.h };
    }
    case 'device': return deviceBounds(o);
    case 'link': {
      const p = linkPoints(o);
      if (!p) return null;
      const r = o.size / 2;
      return { x: Math.min(p[0], p[2]) - r, y: Math.min(p[1], p[3]) - r, w: Math.abs(p[2] - p[0]) + o.size, h: Math.abs(p[3] - p[1]) + o.size };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

function unionBounds(objs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of objs) {
    const b = bounds(o);
    if (!b) continue;   // dangling link
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---- devices & links ---- */
const devFont = (o) => Math.max(11, o.w * 0.2);

function measureLines(text, fs) {
  ctx.save();
  ctx.font = `${fs}px ${FONT}`;
  const lines = text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  ctx.restore();
  return { w, n: lines.length };
}

/** Icon box plus the label underneath it. */
function deviceBounds(o) {
  if (!o.text) return { x: o.x, y: o.y, w: o.w, h: o.h };
  const fs = devFont(o), m = measureLines(o.text, fs);
  const w = Math.max(o.w, m.w);
  return { x: o.x + o.w / 2 - w / 2, y: o.y, w, h: o.h + 4 + m.n * fs * LINE_H };
}

const LINKABLE = ['device', 'rect', 'ellipse', 'note', 'image', 'text'];

/** The box a link attaches to. */
function boxOf(o) {
  switch (o.type) {
    case 'rect': case 'ellipse': { const [x0, y0, x1, y1] = normRect(o); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    case 'device': case 'note': case 'image': return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'text': return bounds(o);
    default: return null;
  }
}

let idxFor = null, idxLen = -1, idxMap = null;
function byId(id) {
  if (idxFor !== state.objects || idxLen !== state.objects.length) {
    idxMap = new Map(state.objects.map((o) => [o.id, o]));
    idxFor = state.objects; idxLen = state.objects.length;
  }
  return idxMap.get(id);
}

function edgePoint(b, toward, ellipse) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = toward.x - cx, dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const rx = b.w / 2 + 3, ry = b.h / 2 + 3;
  const t = ellipse
    ? 1 / Math.hypot(dx / rx, dy / ry)
    : Math.min(rx / Math.max(Math.abs(dx), 1e-9), ry / Math.max(Math.abs(dy), 1e-9));
  return { x: cx + dx * t, y: cy + dy * t };
}

/** [x1,y1,x2,y2] of a link, or null when an endpoint no longer exists. */
function linkPoints(o) {
  const a = byId(o.from), ab = a && boxOf(a);
  if (!ab) return null;
  let bb = null;
  if (o.to) { const b = byId(o.to); bb = b && boxOf(b); if (!bb) return null; }
  const ac = { x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 };
  const bc = bb ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : { x: o.tx, y: o.ty };
  const p1 = edgePoint(ab, bc, a.type === 'ellipse');
  const p2 = bb ? edgePoint(bb, ac, byId(o.to).type === 'ellipse') : bc;
  return [p1.x, p1.y, p2.x, p2.y];
}

function linkLabelBox(o) {
  const p = linkPoints(o);
  if (!p || !o.text) return null;
  const m = measureLines(o.text, LINK_FONT);
  const w = m.w + 12, h = m.n * LINK_FONT * LINE_H + 6, mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2;
  return { x: mx - w / 2, y: my - h / 2, w, h, mx, my };
}

/** Smallest linkable object whose box contains p. */
function linkTargetAt(p, tol = 4) {
  let best = null, area = Infinity;
  for (const o of state.objects) {
    if (!LINKABLE.includes(o.type)) continue;
    const b = o.type === 'device' ? deviceBounds(o) : boxOf(o);
    if (p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) continue;
    if (b.w * b.h <= area) { best = o; area = b.w * b.h; }
  }
  return best;
}

/** What a double-click edits: a text-bearing object, or the inside of a shape. */
function editTargetAt(p) {
  const hit = topHit(p, 6 / view.scale);
  if (hit && EDITABLE.includes(hit.type)) return hit;
  let best = null, area = Infinity;
  for (const o of state.objects) {
    if (o.type !== 'rect' && o.type !== 'ellipse') continue;
    const b = boxOf(o);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && b.w * b.h <= area) { best = o; area = b.w * b.h; }
  }
  return best;
}

function hitObj(o, p, tol) {
  switch (o.type) {
    case 'stroke': {
      const r = o.size / 2 + tol, pts = o.points;
      if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= r;
      for (let i = 1; i < pts.length; i++) {
        if (segDist(p.x, p.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r) return true;
      }
      return false;
    }
    case 'line': case 'arrow':
      return segDist(p.x, p.y, o.x1, o.y1, o.x2, o.y2) <= o.size / 2 + tol;
    case 'link': {
      const pts = linkPoints(o);
      if (!pts) return false;
      if (segDist(p.x, p.y, pts[0], pts[1], pts[2], pts[3]) <= o.size / 2 + tol) return true;
      const lb = linkLabelBox(o);
      return !!lb && p.x >= lb.x && p.x <= lb.x + lb.w && p.y >= lb.y && p.y <= lb.y + lb.h;
    }
    case 'rect': {
      const r = o.size / 2 + tol;
      const [x0, y0, x1, y1] = normRect(o);
      if (p.x < x0 - r || p.x > x1 + r || p.y < y0 - r || p.y > y1 + r) return false;
      return !(p.x > x0 + r && p.x < x1 - r && p.y > y0 + r && p.y < y1 - r);
    }
    case 'ellipse': {
      const r = o.size / 2 + tol;
      const [x0, y0, x1, y1] = normRect(o);
      const rx = Math.max((x1 - x0) / 2, 0.5), ry = Math.max((y1 - y0) / 2, 0.5);
      const d = Math.hypot((p.x - (x0 + x1) / 2) / rx, (p.y - (y0 + y1) / 2) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    default: {
      const b = bounds(o);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
  }
}

function topHit(p, tol) {
  // links sit underneath everything else, so try them last
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.type !== 'link' && hitObj(o, p, tol)) return o;
  }
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.type === 'link' && hitObj(o, p, tol)) return o;
  }
  return null;
}

/** Returns a new object with every point mapped through f. sx/sy tell text how much it was scaled. */
function transformObj(o, f, sx, sy) {
  const n = { ...o };
  switch (o.type) {
    case 'stroke':
      n.points = o.points.map((p) => f(p[0], p[1]));
      break;
    case 'rect': case 'ellipse': case 'line': case 'arrow': {
      const a = f(o.x1, o.y1), b = f(o.x2, o.y2);
      n.x1 = a[0]; n.y1 = a[1]; n.x2 = b[0]; n.y2 = b[1];
      break;
    }
    case 'text': {
      const a = f(o.x, o.y);
      n.x = a[0]; n.y = a[1];
      if (sx !== 1 || sy !== 1) n.fontSize = Math.max(6, o.fontSize * Math.sqrt(Math.abs(sx * sy)));
      break;
    }
    case 'note': case 'image': case 'device': {
      const a = f(o.x, o.y), b = f(o.x + o.w, o.y + o.h);
      n.x = Math.min(a[0], b[0]); n.y = Math.min(a[1], b[1]);
      n.w = Math.max(20, Math.abs(b[0] - a[0])); n.h = Math.max(20, Math.abs(b[1] - a[1]));
      if (o.type === 'device') n.h = n.w;   // device tiles stay square
      break;
    }
  }
  return n;
}

const translateObj = (o, dx, dy) => transformObj(o, (x, y) => [x + dx, y + dy], 1, 1);
const selObjs = () => state.objects.filter((o) => ui.selection.has(o.id));
const findObj = (id) => state.objects.find((o) => o.id === id);

function replaceObjs(list) {
  const m = new Map(list.map((o) => [o.id, o]));
  state.objects = state.objects.map((o) => m.get(o.id) || o);
}

/* =====================================================================
   Ruler
   ===================================================================== */
function rulerLocal(p) {
  const r = state.ruler, c = Math.cos(-r.angle), s = Math.sin(-r.angle);
  const dx = p.x - r.x, dy = p.y - r.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function rulerWorld(l) {
  const r = state.ruler, c = Math.cos(r.angle), s = Math.sin(r.angle);
  return { x: r.x + l.x * c - l.y * s, y: r.y + l.x * s + l.y * c };
}
function hitRuler(p) {
  const r = state.ruler;
  if (!r) return null;
  const l = rulerLocal(p), s = view.scale;
  if (Math.hypot(l.x - (r.len / 2 - 26), l.y) < 16 / s) return 'rotate';
  if (Math.hypot(l.x, l.y) < 18 / s) return 'move';
  if ((ui.tool === 'select' || ui.tool === 'pan') && Math.abs(l.x) <= r.len / 2 && Math.abs(l.y) <= r.h / 2) return 'move';
  return null;
}
/** If a pen stroke starts on/near the ruler, constrain it to the nearest edge. */
function rulerSnapStart(p) {
  const r = state.ruler;
  if (!r) return null;
  const l = rulerLocal(p), tol = 24 / view.scale;
  if (Math.abs(l.x) > r.len / 2 + tol || Math.abs(l.y) > r.h / 2 + tol) return null;
  return { sign: l.y < 0 ? -1 : 1 };
}
function rulerProject(p, snap, strokeSize) {
  const r = state.ruler, l = rulerLocal(p);
  return rulerWorld({
    x: clamp(l.x, -r.len / 2, r.len / 2),
    y: snap.sign * (r.h / 2 + strokeSize / 2),
  });
}
function toggleRuler() {
  if (state.ruler) { state.ruler = null; }
  else {
    const c = toWorld(innerWidth / 2, innerHeight / 2);
    state.ruler = { x: c.x, y: c.y, angle: 0, len: Math.min(720, innerWidth * 0.6 / view.scale), h: 70 / view.scale };
  }
  renderTools();
  requestDraw();
}

/* =====================================================================
   Rendering
   ===================================================================== */
function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  requestDraw();
}

function requestDraw() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
}

function drawBackground(W, H) {
  if (state.bg === 'none') return;
  let step = 24 * view.scale;
  while (step < 14) step *= 5;
  const ox = ((view.x % step) + step) % step, oy = ((view.y % step) + step) % step;
  if (state.bg === 'dots') {
    ctx.fillStyle = '#c3c8d2';
    for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
    return;
  }
  ctx.strokeStyle = '#e4e7ee';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (state.bg === 'grid') for (let x = ox; x < W; x += step) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, H); }
  for (let y = oy; y < H; y += step) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(W, Math.round(y) + .5); }
  ctx.stroke();
}

function getImage(o) {
  let img = imgCache.get(o.id);
  if (!img || img._src !== o.src) {
    img = new Image();
    img._src = o.src;
    img.onload = requestDraw;
    img.src = o.src;
    imgCache.set(o.id, img);
  }
  return img;
}

const SHAPE_FONT = 16;
const shapeFont = (o) => o.fontSize || SHAPE_FONT;

function drawShapeText(c, o, x, y, w, h) {
  const fs = shapeFont(o), lines = o.text.split('\n');
  c.font = `${fs}px ${FONT}`;
  c.fillStyle = o.color;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const top = y + h / 2 - (lines.length * fs * LINE_H) / 2;
  lines.forEach((l, i) => c.fillText(l, x + w / 2, top + i * fs * LINE_H));
}

const iconImgs = new Map();
function iconImg(src) {
  let img = iconImgs.get(src);
  if (!img) { img = new Image(); img.onload = requestDraw; img.src = src; iconImgs.set(src, img); }
  return img;
}

const glyphCache = {};
const glyphPaths = (name) => glyphCache[name] || (glyphCache[name] = (GLYPHS[name] || []).map((d) => new Path2D(d)));

/** A device tile: vendor-coloured rounded square with a white glyph (or a custom image). */
function drawBadge(c, def, x, y, size) {
  if (def && def.src) {
    const img = iconImg(def.src);
    if (img.complete && img.naturalWidth) {
      const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      c.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    }
    return;
  }
  c.save();
  c.translate(x, y);
  c.scale(size / 64, size / 64);
  c.fillStyle = def ? VENDORS[def.vendor].color : '#9ca3af';
  c.beginPath(); c.roundRect(0, 0, 64, 64, 12); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
  if (def) {
    for (const p of glyphPaths(def.glyph)) c.stroke(p);
    if (def.tag) {
      c.fillStyle = '#fff';
      c.beginPath(); c.roundRect(36, 44, 26, 16, 8); c.fill();
      c.fillStyle = VENDORS[def.vendor].color;
      c.font = `bold 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(def.tag, 49, 52.5);
    }
  } else {
    c.fillStyle = '#fff'; c.font = `bold 36px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('?', 32, 34);
  }
  c.restore();
}

function drawObj(c, o, hideText) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  switch (o.type) {
    case 'stroke': {
      c.strokeStyle = c.fillStyle = o.color;
      c.lineWidth = o.size;
      if (o.hl) { c.globalAlpha = 0.4; c.globalCompositeOperation = 'multiply'; c.lineCap = 'butt'; }
      const pts = o.points;
      if (pts.length === 1) {
        c.beginPath(); c.arc(pts[0][0], pts[0][1], o.size / 2, 0, Math.PI * 2); c.fill();
        break;
      }
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      c.stroke();
      break;
    }
    case 'rect': {
      const [x0, y0, x1, y1] = normRect(o);
      c.strokeStyle = o.color; c.lineWidth = o.size;
      c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      if (o.text && !hideText) drawShapeText(c, o, x0, y0, x1 - x0, y1 - y0);
      break;
    }
    case 'ellipse': {
      const [x0, y0, x1, y1] = normRect(o);
      c.strokeStyle = o.color; c.lineWidth = o.size;
      c.beginPath();
      c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max((x1 - x0) / 2, 0.1), Math.max((y1 - y0) / 2, 0.1), 0, 0, Math.PI * 2);
      c.stroke();
      if (o.text && !hideText) drawShapeText(c, o, x0, y0, x1 - x0, y1 - y0);
      break;
    }
    case 'device': {
      drawBadge(c, DEV_BY_KIND[o.kind], o.x, o.y, o.w);
      if (!hideText && o.text) {
        const fs = devFont(o);
        c.font = `${fs}px ${FONT}`;
        c.fillStyle = '#1f2937';
        c.textAlign = 'center';
        c.textBaseline = 'top';
        o.text.split('\n').forEach((l, i) => c.fillText(l, o.x + o.w / 2, o.y + o.h + 4 + i * fs * LINE_H));
      }
      break;
    }
    case 'link': {
      const p = linkPoints(o);
      if (!p) break;
      c.strokeStyle = o.color; c.lineWidth = o.size;
      if (o.dash) c.setLineDash([o.size * 3 + 4, o.size * 2 + 4]);
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[2], p[3]); c.stroke();
      c.setLineDash([]);
      if (o.arrow) {
        const a = Math.atan2(p[3] - p[1], p[2] - p[0]), hl = Math.max(10, o.size * 4);
        c.beginPath();
        c.moveTo(p[2], p[3]); c.lineTo(p[2] - hl * Math.cos(a - 0.45), p[3] - hl * Math.sin(a - 0.45));
        c.moveTo(p[2], p[3]); c.lineTo(p[2] - hl * Math.cos(a + 0.45), p[3] - hl * Math.sin(a + 0.45));
        c.stroke();
      }
      const lb = !hideText && linkLabelBox(o);
      if (lb) {
        c.fillStyle = 'rgba(255,255,255,.95)';
        c.strokeStyle = '#cbd5e1'; c.lineWidth = 1;
        c.beginPath(); c.roundRect(lb.x, lb.y, lb.w, lb.h, 5); c.fill(); c.stroke();
        c.font = `${LINK_FONT}px ${FONT}`;
        c.fillStyle = '#1f2937'; c.textAlign = 'center'; c.textBaseline = 'top';
        o.text.split('\n').forEach((l, i) => c.fillText(l, lb.mx, lb.y + 3 + i * LINK_FONT * LINE_H));
      }
      break;
    }
    case 'line': case 'arrow': {
      c.strokeStyle = o.color; c.lineWidth = o.size;
      c.beginPath(); c.moveTo(o.x1, o.y1); c.lineTo(o.x2, o.y2);
      if (o.type === 'arrow') {
        const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), hl = Math.max(12, o.size * 4);
        c.moveTo(o.x2, o.y2); c.lineTo(o.x2 - hl * Math.cos(a - 0.45), o.y2 - hl * Math.sin(a - 0.45));
        c.moveTo(o.x2, o.y2); c.lineTo(o.x2 - hl * Math.cos(a + 0.45), o.y2 - hl * Math.sin(a + 0.45));
      }
      c.stroke();
      break;
    }
    case 'text': {
      if (hideText) break;
      c.font = `${o.fontSize}px ${FONT}`;
      c.fillStyle = o.color;
      c.textBaseline = 'top';
      o.text.split('\n').forEach((l, i) => c.fillText(l, o.x, o.y + i * o.fontSize * LINE_H));
      break;
    }
    case 'note': {
      c.shadowColor = 'rgba(0,0,0,.2)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
      c.fillStyle = o.fill;
      c.beginPath(); c.roundRect(o.x, o.y, o.w, o.h, 6); c.fill();
      c.shadowColor = 'transparent';
      if (!hideText) {
        c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
        c.font = `${NOTE_FONT}px ${FONT}`;
        c.fillStyle = '#2b2b2b';
        c.textBaseline = 'top';
        wrapLines(c, o.text, o.w - NOTE_PAD * 2).forEach((l, i) =>
          c.fillText(l, o.x + NOTE_PAD, o.y + NOTE_PAD + i * NOTE_FONT * LINE_H));
      }
      break;
    }
    case 'image': {
      const img = getImage(o);
      if (img.complete && img.naturalWidth) c.drawImage(img, o.x, o.y, o.w, o.h);
      else { c.fillStyle = '#eef0f4'; c.fillRect(o.x, o.y, o.w, o.h); }
      break;
    }
  }
  c.restore();
}

function drawRuler() {
  const r = state.ruler, s = view.scale;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.angle);
  ctx.fillStyle = 'rgba(120, 144, 190, .22)';
  ctx.strokeStyle = '#6b7fa8';
  ctx.lineWidth = 1.5 / s;
  ctx.beginPath(); ctx.roundRect(-r.len / 2, -r.h / 2, r.len, r.h, 6 / s); ctx.fill(); ctx.stroke();

  // ticks along both edges (10 world units apart, longer every 50, labelled every 100)
  ctx.fillStyle = '#4b5b80';
  ctx.font = `${11 / s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.beginPath();
  const step = s < 0.4 ? 50 : 10;
  for (let x = Math.ceil(-r.len / 2 / step) * step; x <= r.len / 2; x += step) {
    const major = x % 100 === 0, mid = x % 50 === 0;
    const l = (major ? 14 : mid ? 10 : 6) / s;
    ctx.moveTo(x, -r.h / 2); ctx.lineTo(x, -r.h / 2 + l);
    ctx.moveTo(x, r.h / 2); ctx.lineTo(x, r.h / 2 - l);
    if (major) ctx.fillText(String(Math.abs(x) / 100), x, -r.h / 2 + 16 / s);
  }
  ctx.stroke();

  // grips
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#3b5bdb';
  ctx.lineWidth = 2 / s;
  ctx.beginPath(); ctx.arc(0, 0, 11 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(r.len / 2 - 26, 0, 11 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // angle readout (kept upright)
  let deg = ((r.angle * 180 / Math.PI) % 180 + 180) % 180;
  if (deg > 179.5) deg = 0;
  ctx.save();
  if (Math.cos(r.angle) < 0) ctx.rotate(Math.PI);
  ctx.fillStyle = '#3b5bdb';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${13 / s}px ${FONT}`;
  ctx.fillText(Math.round(deg) + '°', Math.cos(r.angle) < 0 ? -(r.len / 4) : r.len / 4, 0);
  ctx.restore();
  ctx.restore();
}

function selBounds() {
  const sel = selObjs();
  return sel.length ? unionBounds(sel) : null;
}

function handleCorners(b) {
  return [
    { k: 'nw', wx: b.x, wy: b.y, ax: b.x + b.w, ay: b.y + b.h },
    { k: 'ne', wx: b.x + b.w, wy: b.y, ax: b.x, ay: b.y + b.h },
    { k: 'se', wx: b.x + b.w, wy: b.y + b.h, ax: b.x, ay: b.y },
    { k: 'sw', wx: b.x, wy: b.y + b.h, ax: b.x + b.w, ay: b.y },
  ];
}

function drawOverlay() {
  if (ui.tool === 'select' && ui.selection.size) {
    ctx.save();
    ctx.strokeStyle = '#4c6ef5';
    ctx.lineWidth = 1;
    const sel = selObjs();
    if (sel.length > 1) {
      ctx.setLineDash([3, 3]);
      for (const o of sel) {
        const b = bounds(o);
        if (!b) continue;
        const a = toScreen(b.x, b.y);
        ctx.strokeRect(a.x, a.y, b.w * view.scale, b.h * view.scale);
      }
    }
    const ub = unionBounds(sel), a = toScreen(ub.x, ub.y);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x - 3, a.y - 3, ub.w * view.scale + 6, ub.h * view.scale + 6);
    if ((!g || g.type !== 'move') && sel.some((o) => o.type !== 'link')) {
      ctx.fillStyle = '#fff';
      for (const h of handleCorners(ub)) {
        const p = toScreen(h.wx, h.wy);
        const dx = h.k.includes('w') ? -3 : 3, dy = h.k.includes('n') ? -3 : 3;
        ctx.fillRect(p.x + dx - 5, p.y + dy - 5, 10, 10);
        ctx.strokeRect(p.x + dx - 5, p.y + dy - 5, 10, 10);
      }
    }
    ctx.restore();
  }
  if (g && g.type === 'marquee') {
    const a = toScreen(g.x0, g.y0), b = toScreen(g.x1, g.y1);
    ctx.save();
    ctx.fillStyle = 'rgba(76,110,245,.08)';
    ctx.strokeStyle = '#4c6ef5';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  }
  if (ui.tool === 'eraser' && ui.pointer.inside) {
    ctx.save();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ui.pointer.x, ui.pointer.y, ui.size.eraser / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function draw() {
  const W = innerWidth, H = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  drawBackground(W, H);

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  const editId = ui.editing && ui.editing.id;
  for (const o of state.objects) if (o.type === 'link') drawObj(ctx, o, editId === o.id);   // links underneath
  for (const o of state.objects) if (o.type !== 'link') drawObj(ctx, o, editId === o.id);
  if (draft) drawObj(ctx, draft);
  if (g && g.type === 'link' && draft && draft.to) {
    const b = boxOf(byId(draft.to));
    ctx.save();
    ctx.strokeStyle = '#4c6ef5'; ctx.lineWidth = 2 / view.scale;
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.restore();
  }
  if (ui.tool === 'device' && ui.pointer.inside && DEV_BY_KIND[ui.deviceKind]) {
    const p = toWorld(ui.pointer.x, ui.pointer.y);
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawBadge(ctx, DEV_BY_KIND[ui.deviceKind], p.x - DEVICE_SIZE / 2, p.y - DEVICE_SIZE / 2, DEVICE_SIZE);
    ctx.restore();
  }
  if (state.ruler) drawRuler();
  ctx.restore();

  drawOverlay();
  if (ui.editing) positionEditor();
}

/* =====================================================================
   History + persistence
   ===================================================================== */
const hist = { stack: [], i: -1 };
const snap = () => state.objects.map((o) => ({ ...o }));

function pruneLinks() {
  // a link survives only while both ends are objects a link can attach to
  const ends = new Set(state.objects.filter((o) => LINKABLE.includes(o.type)).map((o) => o.id));
  const keep = state.objects.filter((o) => o.type !== 'link' || (ends.has(o.from) && ends.has(o.to)));
  if (keep.length !== state.objects.length) {
    state.objects = keep;
    const left = new Set(keep.map((o) => o.id));
    for (const id of [...ui.selection]) if (!left.has(id)) ui.selection.delete(id);
  }
}

function commit() {
  pruneLinks();
  hist.stack.length = hist.i + 1;
  hist.stack.push(snap());
  if (hist.stack.length > 120) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  afterChange();
}

function resetHistory() {
  hist.stack = [snap()];
  hist.i = 0;
  afterChange();
}

function restore() {
  state.objects = hist.stack[hist.i].map((o) => ({ ...o }));
  for (const id of [...ui.selection]) if (!findObj(id)) ui.selection.delete(id);
  afterChange();
}

function undo() { finishEdit(); if (hist.i > 0) { hist.i--; restore(); } }
function redo() { finishEdit(); if (hist.i < hist.stack.length - 1) { hist.i++; restore(); } }

function afterChange() {
  document.querySelector('[data-action=undo]').disabled = hist.i <= 0;
  document.querySelector('[data-action=redo]').disabled = hist.i >= hist.stack.length - 1;
  renderProps();
  scheduleSave();
  requestDraw();
}

let saveTimer = 0, warned = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(serialize()));
  } catch (e) {
    if (!warned) { warned = true; toast('Autosave failed (board too large?) - use Save to keep a copy'); }
  }
}
const serialize = () => ({ version: 1, title: state.title, bg: state.bg, view: state.view, objects: state.objects });

function loadData(d) {
  if (!d || !Array.isArray(d.objects)) throw new Error('Not a whiteboard file');
  state.objects = d.objects;
  state.title = d.title || 'Untitled board';
  state.bg = BACKGROUNDS.includes(d.bg) ? d.bg : 'dots';
  if (d.view) Object.assign(view, { x: +d.view.x || 0, y: +d.view.y || 0, scale: clamp(+d.view.scale || 1, 0.1, 8) });
  $('#title').value = state.title;
  document.title = state.title + ' - Intuitive Whiteboard';
  ui.selection.clear();
  resetHistory();
  viewChanged();
}

/* =====================================================================
   Text / note editing
   ===================================================================== */
function startEdit(o, isNew) {
  if (o.text == null) o.text = '';
  ui.editing = { id: o.id, isNew, before: o.text };
  editor.hidden = false;
  editor.value = o.text;
  positionEditor();
  requestDraw();
  setTimeout(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); }, 0);
}

function positionEditor() {
  const e = ui.editing;
  const o = e && findObj(e.id);
  if (!o) return;
  const s = view.scale;
  editor.style.textAlign = 'left';
  const centered = (cx, top, fs, text, minW, color) => {
    const m = measureLines(text, fs);
    const w = Math.max(m.w + fs * 2, minW) * s;
    editor.className = '';
    editor.style.textAlign = 'center';
    editor.style.width = w + 'px';
    editor.style.height = m.n * fs * LINE_H * s + 'px';
    editor.style.left = view.x + cx * s - w / 2 + 'px';
    editor.style.top = view.y + top * s + 'px';
    editor.style.fontSize = fs * s + 'px';
    editor.style.color = color;
  };
  if (o.type === 'device') {
    centered(o.x + o.w / 2, o.y + o.h + 4, devFont(o), o.text, Math.max(o.w, 100), '#1f2937');
  } else if (o.type === 'link') {
    const lb = linkLabelBox(o);
    const p = linkPoints(o);
    const mx = p ? (p[0] + p[2]) / 2 : 0, my = p ? (p[1] + p[3]) / 2 : 0;
    const n = o.text.split('\n').length;
    centered(mx, my - (n * LINK_FONT * LINE_H) / 2, LINK_FONT, o.text, lb ? 0 : 80, '#1f2937');
  } else if (o.type === 'rect' || o.type === 'ellipse') {
    const b = boxOf(o), fs = shapeFont(o), n = o.text.split('\n').length;
    centered(b.x + b.w / 2, b.y + b.h / 2 - (n * fs * LINE_H) / 2, fs, o.text, Math.min(b.w, 120), o.color);
  } else if (o.type === 'note') {
    editor.className = 'wrap';
    editor.style.left = view.x + (o.x + NOTE_PAD) * s + 'px';
    editor.style.top = view.y + (o.y + NOTE_PAD) * s + 'px';
    editor.style.width = (o.w - NOTE_PAD * 2) * s + 'px';
    editor.style.height = (o.h - NOTE_PAD * 2) * s + 'px';
    editor.style.fontSize = NOTE_FONT * s + 'px';
    editor.style.color = '#2b2b2b';
  } else {
    const m = textMetrics(o);
    editor.className = '';
    editor.style.left = view.x + o.x * s + 'px';
    editor.style.top = view.y + o.y * s + 'px';
    editor.style.width = Math.max(m.w * s + o.fontSize * s * 0.6, 60) + 'px';
    editor.style.height = Math.max(m.h * s, o.fontSize * s * LINE_H) + 'px';
    editor.style.fontSize = o.fontSize * s + 'px';
    editor.style.color = o.color;
  }
}

function finishEdit() {
  const e = ui.editing;
  if (!e) return;
  ui.editing = null;
  editor.hidden = true;
  const o = findObj(e.id);
  if (o) {
    if (o.type === 'text' && !o.text.trim()) {
      state.objects = state.objects.filter((x) => x !== o);
      ui.selection.delete(o.id);
      if (!e.isNew) commit();
      else afterChange();
    } else if (e.isNew || o.text !== e.before) {
      commit();
    }
  }
  requestDraw();
}

editor.addEventListener('input', () => {
  const o = ui.editing && findObj(ui.editing.id);
  if (!o) return;
  o.text = editor.value;
  positionEditor();
  requestDraw();
});
editor.addEventListener('blur', finishEdit);
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); editor.blur(); }
  e.stopPropagation();
});

/* =====================================================================
   Tools + UI chrome
   ===================================================================== */
function setTool(t) {
  finishEdit();
  ui.tool = t;
  if (t !== 'select') ui.selection.clear();
  ui.hoverCursor = '';
  renderTools();
  renderProps();
  setCursor();
  requestDraw();
}

function renderTools() {
  const bar = $('#tools');
  bar.innerHTML = '';
  for (const t of TOOLS) {
    if (t === 'sep') { const d = document.createElement('div'); d.className = 'sep'; bar.appendChild(d); continue; }
    const b = document.createElement('button');
    b.innerHTML = svg(t.icon);
    b.title = t.title;
    b.dataset.tool = t.id;
    const active = t.id === 'ruler' ? !!state.ruler
      : t.id === 'device' ? !$('#library').hidden || ui.tool === 'device'
      : (!t.action && ui.tool === t.id);
    if (active) b.classList.add('active');
    b.addEventListener('click', () => {
      if (t.id === 'image') $('#imgInput').click();
      else if (t.id === 'ruler') toggleRuler();
      else if (t.id === 'device') toggleLibrary();
      else setTool(t.id);
    });
    bar.appendChild(b);
  }
  updateLibraryActive();
}

function renderProps() {
  const bar = $('#props');
  const t = ui.tool, sel = selObjs();
  let ink = false, note = false, width = false, font = false, eraser = false, dash = false, detect = null;
  if (t === 'select') {
    ink = sel.some((o) => LINEY.includes(o.type) || o.type === 'text');
    note = sel.some((o) => o.type === 'note');
    width = sel.some((o) => LINEY.includes(o.type));
    font = sel.some((o) => o.type === 'text');
    dash = sel.some((o) => o.type === 'link');
    if (sel.length === 1 && sel[0].type === 'image') detect = sel[0];
  } else if (t === 'note') note = true;
  else if (t === 'eraser') eraser = true;
  else if (t === 'text') { ink = true; font = true; }
  else if (t === 'link') { ink = true; width = true; dash = true; }
  else if (t === 'pen' || t === 'highlighter' || SHAPES.includes(t)) { ink = true; width = true; }

  bar.innerHTML = '';
  bar.hidden = !(ink || note || width || font || eraser || dash || detect);
  if (bar.hidden) return;

  if (detect) {
    const grp = document.createElement('div');
    grp.className = 'group';
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = ui.busy ? 'Analyzing…' : 'Detect components';
    b.disabled = !!ui.busy;
    b.title = 'Find the shapes, lines and text in this image (runs entirely in your browser) and turn them into editable objects';
    b.addEventListener('click', () => detectComponents(detect));
    grp.appendChild(b);
    bar.appendChild(grp);
  }

  const firstInk = sel.find((o) => o.color);
  const firstNote = sel.find((o) => o.type === 'note');
  const curInk = t === 'select' ? (firstInk && firstInk.color) : ui.color;
  const curNote = t === 'select' ? (firstNote && firstNote.fill) : ui.noteColor;

  const swatches = (colors, cur, square, onPick) => {
    const grp = document.createElement('div');
    grp.className = 'group';
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (square ? ' square' : '') + (c === cur ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => onPick(c));
      grp.appendChild(b);
    }
    bar.appendChild(grp);
  };
  const slider = (label, min, max, value, onInput, onChange) => {
    const grp = document.createElement('div');
    grp.className = 'group';
    grp.innerHTML = `<label>${label}</label>`;
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.value = value;
    r.addEventListener('input', () => onInput(+r.value));
    r.addEventListener('change', () => onChange && onChange());
    grp.appendChild(r);
    bar.appendChild(grp);
  };

  if (ink) swatches(INK, curInk, false, (c) => {
    ui.color = c;
    if (t === 'select') applyToSelection((o) => (o.color !== undefined ? { ...o, color: c } : o), true);
    else renderProps();
  });
  if (note) swatches(NOTE_COLORS, curNote, true, (c) => {
    ui.noteColor = c;
    if (t === 'select') applyToSelection((o) => (o.type === 'note' ? { ...o, fill: c } : o), true);
    else renderProps();
  });
  if (width) {
    const firstLine = sel.find((o) => LINEY.includes(o.type));
    const k = sizeKey(t);
    const val = t === 'select' ? firstLine.size : ui.size[k];
    slider('Width', t === 'highlighter' ? 6 : 1, t === 'highlighter' ? 48 : 40, val, (v) => {
      if (t === 'select') applyToSelection((o) => (LINEY.includes(o.type) ? { ...o, size: v } : o), false);
      else ui.size[k] = v;
    }, () => t === 'select' && commit());
  }
  if (font) {
    const firstText = sel.find((o) => o.type === 'text');
    const val = t === 'select' ? Math.round(firstText.fontSize) : ui.size.text;
    slider('Text size', 10, 120, val, (v) => {
      if (t === 'select') applyToSelection((o) => (o.type === 'text' ? { ...o, fontSize: v } : o), false);
      else ui.size.text = v;
    }, () => t === 'select' && commit());
  }
  if (eraser) slider('Eraser size', 8, 80, ui.size.eraser, (v) => { ui.size.eraser = v; requestDraw(); });
  if (dash) {
    const links = sel.filter((o) => o.type === 'link');
    const isDash = t === 'select' ? links.every((o) => o.dash) : ui.linkDash;
    const grp = document.createElement('div');
    grp.className = 'group';
    const b = document.createElement('button');
    b.className = 'txt' + (isDash ? ' active' : '');
    b.textContent = 'Dashed';
    b.title = 'Dashed line (logical / VPN / backup link)';
    b.addEventListener('click', () => {
      if (t === 'select') applyToSelection((o) => (o.type === 'link' ? { ...o, dash: !isDash } : o), true);
      else { ui.linkDash = !ui.linkDash; renderProps(); }
    });
    grp.appendChild(b);
    bar.appendChild(grp);
  }
}

function applyToSelection(fn, doCommit) {
  replaceObjs(selObjs().map(fn));
  if (doCommit) commit(); else requestDraw();
}

function setCursor() {
  let c = 'default';
  if (g && g.type === 'pan') c = 'grabbing';
  else if (ui.spaceDown || ui.tool === 'pan') c = 'grab';
  else if (ui.tool === 'select') c = ui.hoverCursor || 'default';
  else if (ui.tool === 'text') c = 'text';
  else if (ui.tool === 'eraser') c = 'none';
  else c = 'crosshair';
  canvas.style.cursor = c;
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* =====================================================================
   Pointer interaction
   ===================================================================== */
function hitHandle(sx, sy) {
  if (ui.tool !== 'select' || !selObjs().some((o) => o.type !== 'link')) return null;
  const ub = selBounds();
  for (const h of handleCorners(ub)) {
    const p = toScreen(h.wx, h.wy);
    const dx = h.k.includes('w') ? -3 : 3, dy = h.k.includes('n') ? -3 : 3;
    if (Math.abs(sx - (p.x + dx)) <= 9 && Math.abs(sy - (p.y + dy)) <= 9) return h;
  }
  return null;
}

function eraseAt(wp) {
  const tol = ui.size.eraser / 2 / view.scale;
  const before = state.objects.length;
  state.objects = state.objects.filter((o) => !hitObj(o, wp, tol));
  if (state.objects.length !== before) { g.erased = true; requestDraw(); }
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  g = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function abortGesture() {
  if (g && g.orig) replaceObjs(g.orig);
  draft = null;
  g = null;
  requestDraw();
}

function onDown(e) {
  if (ui.editing) finishEdit();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { abortGesture(); startPinch(); return; }
  if (pointers.size > 2) return;

  const sx = e.clientX, sy = e.clientY, wp = toWorld(sx, sy);
  if (e.button === 1 || ui.tool === 'pan' || ui.spaceDown) {
    g = { type: 'pan', sx, sy, vx: view.x, vy: view.y };
    setCursor();
    return;
  }
  if (e.button !== 0) return;

  const rh = hitRuler(wp);
  if (rh) {
    const l = rulerLocal(wp);
    g = { type: 'ruler-' + rh, ox: state.ruler.x - wp.x, oy: state.ruler.y - wp.y, l };
    return;
  }

  const t = ui.tool;
  if (t === 'select') {
    const h = hitHandle(sx, sy);
    if (h) {
      g = { type: 'resize', h, orig: selObjs().map((o) => ({ ...o })) };
      return;
    }
    const hit = topHit(wp, 6 / view.scale);
    if (hit) {
      if (e.shiftKey) {
        if (ui.selection.has(hit.id)) { ui.selection.delete(hit.id); renderProps(); requestDraw(); return; }
        ui.selection.add(hit.id);
      } else if (!ui.selection.has(hit.id)) {
        ui.selection = new Set([hit.id]);
      }
      renderProps();
      g = { type: 'move', sx, sy, wp, moved: false, orig: selObjs().map((o) => ({ ...o })) };
    } else {
      if (!e.shiftKey) ui.selection.clear();
      renderProps();
      g = { type: 'marquee', x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y, shift: e.shiftKey, base: new Set(ui.selection) };
    }
    requestDraw();
    return;
  }

  if (t === 'pen' || t === 'highlighter') {
    const hl = t === 'highlighter';
    const size = ui.size[t];
    const snapInfo = rulerSnapStart(wp);
    const p0 = snapInfo ? rulerProject(wp, snapInfo, size) : wp;
    draft = { id: uid(), type: 'stroke', hl, color: ui.color, size, points: [[p0.x, p0.y]] };
    g = { type: 'stroke', snap: snapInfo };
    requestDraw();
    return;
  }
  if (t === 'eraser') { g = { type: 'erase', erased: false }; eraseAt(wp); return; }
  if (SHAPES.includes(t)) {
    draft = { id: uid(), type: t, x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y, color: ui.color, size: ui.size.shape };
    g = { type: 'shape' };
    return;
  }
  if (t === 'link') {
    const from = linkTargetAt(wp);
    if (!from) { toast('Start the link on a device or shape'); return; }
    draft = { id: uid(), type: 'link', from: from.id, to: null, tx: wp.x, ty: wp.y, color: ui.color, size: ui.size.link, dash: ui.linkDash, text: '' };
    g = { type: 'link' };
    requestDraw();
    return;
  }
  if (t === 'text' || t === 'note' || t === 'device') {
    g = { type: 'place', sx, sy, wp };
  }
}

function onMove(e) {
  ui.pointer = { x: e.clientX, y: e.clientY, inside: true };
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const sx = e.clientX, sy = e.clientY, wp = toWorld(sx, sy);

  if (!g) {
    if (ui.tool === 'select') {
      const h = hitHandle(sx, sy);
      const hit = !h && topHit(wp, 6 / view.scale);
      ui.hoverCursor = h ? (h.k === 'nw' || h.k === 'se' ? 'nwse-resize' : 'nesw-resize') : hit ? 'move' : 'default';
      setCursor();
    }
    if (ui.tool === 'eraser' || ui.tool === 'device') requestDraw();
    return;
  }

  switch (g.type) {
    case 'link': {
      draft.tx = wp.x; draft.ty = wp.y;
      const target = linkTargetAt(wp);
      draft.to = target && target.id !== draft.from ? target.id : null;
      requestDraw();
      break;
    }
    case 'pinch': {
      const [a, b] = [...pointers.values()];
      if (!b) break;
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      zoomAt(cx, cy, d / g.d);
      view.x += cx - g.cx; view.y += cy - g.cy;
      g.d = d; g.cx = cx; g.cy = cy;
      viewChanged();
      break;
    }
    case 'pan':
      view.x = g.vx + (sx - g.sx);
      view.y = g.vy + (sy - g.sy);
      viewChanged();
      break;
    case 'ruler-move':
      state.ruler.x = wp.x + g.ox; state.ruler.y = wp.y + g.oy;
      requestDraw();
      break;
    case 'ruler-rotate': {
      const r = state.ruler;
      let a = Math.atan2(wp.y - r.y, wp.x - r.x);
      const step = Math.PI / 12, near = Math.round(a / step) * step;
      if (Math.abs(a - near) < 0.035) a = near;
      r.angle = a;
      requestDraw();
      break;
    }
    case 'stroke': {
      const pts = draft.points, last = pts[pts.length - 1];
      const p = g.snap ? rulerProject(wp, g.snap, draft.size) : wp;
      if (Math.hypot(p.x - last[0], p.y - last[1]) * view.scale >= 1.5) {
        if (g.snap) draft.points = [pts[0], [p.x, p.y]];   // straight edge: only start + end
        else pts.push([p.x, p.y]);
        requestDraw();
      }
      break;
    }
    case 'erase': eraseAt(wp); break;
    case 'shape': {
      let x2 = wp.x, y2 = wp.y;
      if (e.shiftKey) {
        const dx = x2 - draft.x1, dy = y2 - draft.y1;
        if (draft.type === 'rect' || draft.type === 'ellipse') {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          x2 = draft.x1 + Math.sign(dx || 1) * m; y2 = draft.y1 + Math.sign(dy || 1) * m;
        } else {
          const len = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
          x2 = draft.x1 + len * Math.cos(a); y2 = draft.y1 + len * Math.sin(a);
        }
      }
      draft.x2 = x2; draft.y2 = y2;
      requestDraw();
      break;
    }
    case 'move': {
      if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) < 3) break;
      g.moved = g.orig.some((o) => o.type !== 'link');   // links follow their ends; moving only links changes nothing
      const dx = wp.x - g.wp.x, dy = wp.y - g.wp.y;
      replaceObjs(g.orig.map((o) => translateObj(o, dx, dy)));
      requestDraw();
      break;
    }
    case 'resize': {
      const { h } = g;
      let rx = h.wx - h.ax, ry = h.wy - h.ay;
      let sxr = Math.abs(rx) < 1e-6 ? 1 : (wp.x - h.ax) / rx;
      let syr = Math.abs(ry) < 1e-6 ? 1 : (wp.y - h.ay) / ry;
      sxr = Math.max(sxr, 0.02); syr = Math.max(syr, 0.02);
      if (e.shiftKey || g.orig.some((o) => o.type === 'text' || o.type === 'image' || o.type === 'device')) {
        const u = Math.max(sxr, syr); sxr = syr = u;
      }
      replaceObjs(g.orig.map((o) => transformObj(o, (x, y) => [h.ax + (x - h.ax) * sxr, h.ay + (y - h.ay) * syr], sxr, syr)));
      requestDraw();
      break;
    }
    case 'marquee': {
      g.x1 = wp.x; g.y1 = wp.y;
      const x0 = Math.min(g.x0, g.x1), x1 = Math.max(g.x0, g.x1);
      const y0 = Math.min(g.y0, g.y1), y1 = Math.max(g.y0, g.y1);
      const next = new Set(g.base);
      for (const o of state.objects) {
        const b = bounds(o);
        if (b && b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) next.add(o.id);
      }
      ui.selection = next;
      requestDraw();
      break;
    }
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (!g) return;
  if (g.type === 'pinch') { if (pointers.size < 2) g = null; return; }
  const gg = g;
  g = null;
  setCursor();

  switch (gg.type) {
    case 'stroke':
      if (draft) { state.objects.push(draft); draft = null; commit(); }
      break;
    case 'shape':
      if (draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) * view.scale > 3) {
        state.objects.push(draft);
        draft = null;
        commit();
      }
      draft = null;
      requestDraw();
      break;
    case 'link':
      if (draft && draft.to) { state.objects.push(draft); draft = null; commit(); }
      draft = null;
      requestDraw();
      break;
    case 'erase': if (gg.erased) commit(); break;
    case 'move': if (gg.moved) commit(); break;
    case 'resize': commit(); break;
    case 'marquee': renderProps(); requestDraw(); break;
    case 'place': {
      if (Math.hypot(e.clientX - gg.sx, e.clientY - gg.sy) > 6) break;
      if (ui.tool === 'device') { placeDevice(ui.deviceKind, gg.wp.x, gg.wp.y); break; }
      const hit = topHit(gg.wp, 6 / view.scale);
      if (hit && EDITABLE.includes(hit.type)) { startEdit(hit, false); break; }
      let o;
      if (ui.tool === 'note') {
        o = { id: uid(), type: 'note', x: gg.wp.x - 100, y: gg.wp.y - 100, w: 200, h: 200, text: '', fill: ui.noteColor };
      } else {
        o = { id: uid(), type: 'text', x: gg.wp.x, y: gg.wp.y - ui.size.text / 2, text: '', color: ui.color, fontSize: ui.size.text };
      }
      state.objects.push(o);
      ui.tool = 'select';
      ui.selection = new Set([o.id]);
      renderTools();
      renderProps();
      startEdit(o, true);
      break;
    }
  }
}

canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); abortGesture(); });
canvas.addEventListener('pointerleave', () => { ui.pointer.inside = false; if (ui.tool === 'eraser' || ui.tool === 'device') requestDraw(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('dblclick', (e) => {
  if (ui.tool !== 'select') return;
  const hit = editTargetAt(toWorld(e.clientX, e.clientY));
  if (hit) {
    ui.selection = new Set([hit.id]);
    startEdit(hit, false);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else {
    view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    viewChanged();
  }
}, { passive: false });

/* =====================================================================
   Images, clipboard, drag & drop
   ===================================================================== */
function addImageFile(file, at) {
  if (!file || !file.type.startsWith('image/')) return;
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight, src = fr.result;
      const MAX = 1600;
      if (Math.max(w, h) > MAX) {
        const k = MAX / Math.max(w, h), c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        src = c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.88);
        w = c.width; h = c.height;
      }
      const dw = Math.min(w, innerWidth * 0.5 / view.scale), dh = dw * h / w;
      const c0 = at || toWorld(innerWidth / 2, innerHeight / 2);
      const o = { id: uid(), type: 'image', x: c0.x - dw / 2, y: c0.y - dh / 2, w: dw, h: dh, src };
      state.objects.push(o);
      ui.tool = 'select';
      ui.selection = new Set([o.id]);
      renderTools();
      commit();
      toast('Image added - use “Detect components” to turn it into editable objects', 4500);
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

function copySelection() {
  // links between two selected objects travel with them
  const links = state.objects.filter((o) => o.type === 'link' && !ui.selection.has(o.id) && ui.selection.has(o.from) && ui.selection.has(o.to));
  clip = [...selObjs(), ...links].map((o) => ({ ...o }));
  pasteCount = 0;
  return clip.length > 0;
}

function pasteClip() {
  if (!clip.length) return false;
  pasteCount++;
  const off = 24 * pasteCount;
  const idMap = new Map(clip.map((o) => [o.id, uid()]));
  const copies = [];
  for (const o of clip) {
    if (o.type === 'link') {
      if (idMap.has(o.from) && idMap.has(o.to)) copies.push({ ...o, id: idMap.get(o.id), from: idMap.get(o.from), to: idMap.get(o.to) });
    } else {
      copies.push({ ...translateObj(o, off, off), id: idMap.get(o.id) });
    }
  }
  if (!copies.length) return false;
  state.objects.push(...copies);
  ui.selection = new Set(copies.map((o) => o.id));
  if (ui.tool !== 'select') { ui.tool = 'select'; renderTools(); }
  commit();
  return true;
}

function deleteSelection() {
  if (!ui.selection.size) return;
  state.objects = state.objects.filter((o) => !ui.selection.has(o.id));
  ui.selection.clear();
  commit();
}

window.addEventListener('paste', (e) => {
  if (e.target === editor || e.target.tagName === 'INPUT') return;
  const items = [...(e.clipboardData ? e.clipboardData.items : [])];
  const imgItem = items.find((i) => i.type.startsWith('image/'));
  if (imgItem) { e.preventDefault(); addImageFile(imgItem.getAsFile()); return; }
  if (pasteClip()) { e.preventDefault(); return; }
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (text && text.trim()) {
    e.preventDefault();
    const c = toWorld(innerWidth / 2, innerHeight / 2);
    const o = { id: uid(), type: 'text', x: c.x, y: c.y, text: text.trim(), color: ui.color, fontSize: ui.size.text };
    state.objects.push(o);
    ui.selection = new Set([o.id]);
    ui.tool = 'select';
    renderTools();
    commit();
  }
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const at = toWorld(e.clientX, e.clientY);
  const dev = (e.dataTransfer.getData('text/plain') || '').match(/^wb-device:(.+)$/);
  if (dev && DEV_BY_KIND[dev[1]]) { placeDevice(dev[1], at.x, at.y); return; }
  for (const f of e.dataTransfer.files) addImageFile(f, at);
});

$('#imgInput').addEventListener('change', (e) => {
  for (const f of e.target.files) addImageFile(f);
  e.target.value = '';
});

/* =====================================================================
   Export / import / actions
   ===================================================================== */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileBase = () => (state.title.trim() || 'whiteboard').replace(/[\\/:*?"<>|]+/g, '_');

function exportPng() {
  if (!state.objects.length) return toast('Nothing to export yet');
  const b = unionBounds(state.objects), pad = 40;
  const sc = Math.min(2, 8000 / Math.max(b.w + pad * 2, b.h + pad * 2));
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.w + pad * 2) * sc);
  c.height = Math.ceil((b.h + pad * 2) * sc);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.scale(sc, sc);
  x.translate(pad - b.x, pad - b.y);
  for (const o of state.objects) if (o.type === 'link') drawObj(x, o);   // same order as the screen: links underneath
  for (const o of state.objects) if (o.type !== 'link') drawObj(x, o);
  c.toBlob((blob) => blob && download(blob, fileBase() + '.png'), 'image/png');
}

function saveJson() {
  download(new Blob([JSON.stringify(serialize())], { type: 'application/json' }), fileBase() + '.whiteboard.json');
}

$('#jsonInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { loadData(JSON.parse(fr.result)); toast('Board opened'); }
    catch (err) { toast('Could not open file: ' + err.message); }
  };
  fr.readAsText(f);
});

const ACTIONS = {
  undo, redo,
  zoomIn: () => zoomAt(innerWidth / 2, innerHeight / 2, 1.25),
  zoomOut: () => zoomAt(innerWidth / 2, innerHeight / 2, 0.8),
  zoomReset: () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / view.scale),
  fit: fitContent,
  bg: () => { state.bg = BACKGROUNDS[(BACKGROUNDS.indexOf(state.bg) + 1) % BACKGROUNDS.length]; toast('Background: ' + state.bg); scheduleSave(); requestDraw(); },
  exportPng,
  saveJson,
  openJson: () => $('#jsonInput').click(),
  clear: () => {
    if (!state.objects.length) return;
    if (!confirm('Clear the whole board? (You can undo this.)')) return;
    state.objects = [];
    ui.selection.clear();
    commit();
  },
};

document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.action]()));
document.querySelectorAll('[data-icon]').forEach((b) => { b.innerHTML = svg(b.dataset.icon); });

$('#title').addEventListener('input', (e) => {
  state.title = e.target.value;
  document.title = (state.title || 'Whiteboard') + ' - Intuitive Whiteboard';
  scheduleSave();
});

/* =====================================================================
   Keyboard
   ===================================================================== */
window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

  if (e.key === ' ' && !ui.spaceDown) { ui.spaceDown = true; setCursor(); e.preventDefault(); return; }
  if (mod) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'a') { e.preventDefault(); setTool('select'); ui.selection = new Set(state.objects.map((o) => o.id)); renderProps(); requestDraw(); }
    else if (k === 'c') { if (copySelection()) e.preventDefault(); }
    else if (k === 'x') { if (copySelection()) { e.preventDefault(); deleteSelection(); } }
    else if (k === 'd') { e.preventDefault(); if (copySelection()) pasteClip(); }
    else if (k === '0') { e.preventDefault(); ACTIONS.zoomReset(); }
    else if (k === '=' || k === '+') { e.preventDefault(); ACTIONS.zoomIn(); }
    else if (k === '-') { e.preventDefault(); ACTIONS.zoomOut(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') { ui.selection.clear(); setTool('select'); return; }
  if (e.key.startsWith('Arrow') && selObjs().some((o) => o.type !== 'link')) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
    const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    replaceObjs(selObjs().map((o) => translateObj(o, dx, dy)));
    commit();
    return;
  }
  const tool = TOOLS.find((t) => t !== 'sep' && t.key === k);
  if (tool) {
    if (tool.id === 'image') $('#imgInput').click();
    else if (tool.id === 'ruler') toggleRuler();
    else if (tool.id === 'device') toggleLibrary();
    else setTool(tool.id);
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { ui.spaceDown = false; setCursor(); } });
window.addEventListener('blur', () => { ui.spaceDown = false; setCursor(); });
window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', saveNow);

/* =====================================================================
   Device library (palette)
   ===================================================================== */
const library = $('#library');

function placeDevice(kind, cx, cy) {
  const def = DEV_BY_KIND[kind];
  if (!def) return null;
  const snap8 = (v) => Math.round(v / 8) * 8;
  const o = {
    id: uid(), type: 'device', kind,
    x: snap8(cx - DEVICE_SIZE / 2), y: snap8(cy - DEVICE_SIZE / 2),
    w: DEVICE_SIZE, h: DEVICE_SIZE, text: def.label,
  };
  state.objects.push(o);
  commit();
  return o;
}

function toggleLibrary() {
  library.hidden = !library.hidden;
  if (library.hidden && ui.tool === 'device') setTool('select');
  else renderTools();
}

function updateLibraryActive() {
  document.querySelectorAll('#libBody .tile').forEach((t) =>
    t.classList.toggle('active', ui.tool === 'device' && t.dataset.kind === ui.deviceKind));
}

function buildLibrary() {
  const body = $('#libBody');
  const q = $('#libSearch').value.trim().toLowerCase();
  body.innerHTML = '';
  for (const vk of Object.keys(VENDORS)) {
    const defs = DEVICES.filter((d) => d.vendor === vk && (!q || `${d.name} ${d.label} ${VENDORS[vk].name}`.toLowerCase().includes(q)));
    const isUser = vk === 'user';
    if (!defs.length && !(isUser && !q)) continue;   // the User icons section is always there so people can add to it
    const sec = document.createElement('section');
    const h = document.createElement('h4');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = VENDORS[vk].color;
    h.append(dot, VENDORS[vk].name);
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const def of defs) {
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.kind = def.kind;
      b.title = def.name + ' - click, then click the board (or drag onto it)';
      b.draggable = true;
      if (def.src) {
        const im = document.createElement('img');
        im.src = def.src; im.alt = ''; im.draggable = false;
        b.appendChild(im);
      } else {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 88;
        cv.style.width = cv.style.height = '44px';
        const c2 = cv.getContext('2d');
        c2.scale(2, 2);
        drawBadge(c2, def, 0, 0, 44);
        b.appendChild(cv);
      }
      const span = document.createElement('span');
      span.textContent = def.name;
      b.appendChild(span);
      if (isUser) {
        const del = document.createElement('span');
        del.className = 'tile-del';
        del.textContent = '×';
        del.title = 'Remove this icon';
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteUserIcon(def); });
        b.appendChild(del);
      }
      b.addEventListener('click', () => { ui.deviceKind = def.kind; setTool('device'); });
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'wb-device:' + def.kind);
        e.dataTransfer.effectAllowed = 'copy';
      });
      grid.appendChild(b);
    }
    if (isUser && !q) {
      const add = document.createElement('button');
      add.className = 'tile add';
      add.title = 'Add your own icon (PNG, SVG, JPG, GIF or WebP, up to 2 MB). It is saved in the icons/user folder.';
      add.innerHTML = '<div class="plus">+</div>';
      const label = document.createElement('span');
      label.textContent = 'Add icon';
      add.appendChild(label);
      add.addEventListener('click', () => $('#iconInput').click());
      grid.appendChild(add);
    }
    sec.append(h, grid);
    body.appendChild(sec);
  }
  if (!body.children.length) body.textContent = 'No devices match.';
  updateLibraryActive();
}
$('#libSearch').addEventListener('input', buildLibrary);
$('#libClose').addEventListener('click', toggleLibrary);
$('#libAdd').addEventListener('click', () => $('#iconInput').click());

/** Register the icons listed in a manifest.json (an array of { name, file, vendor?, label? }). */
function loadIconManifest(url, folder, kindPrefix, fixedVendor) {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      if (!Array.isArray(list)) return;
      for (const it of list) {
        if (!it || typeof it.file !== 'string' || !it.file) continue;
        const kind = kindPrefix + it.file;
        if (DEV_BY_KIND[kind]) continue;
        registerDevice({
          vendor: fixedVendor || (VENDORS[it.vendor] ? it.vendor : 'custom'), kind, file: it.file,
          name: it.name || it.file, label: it.label || it.name || '', src: folder + encodeURI(it.file),
        });
      }
    })
    .catch(() => { /* opened without the local server: built-in symbols only */ });
}

function unregisterDevices(prefix) {
  for (let i = DEVICES.length - 1; i >= 0; i--) {
    if (DEVICES[i].kind.startsWith(prefix)) { delete DEV_BY_KIND[DEVICES[i].kind]; DEVICES.splice(i, 1); }
  }
}

async function loadUserIcons() {
  unregisterDevices('user:');
  await loadIconManifest('icons/user/manifest.json', 'icons/user/', 'user:', 'user');
  buildLibrary();
  requestDraw();
}

// Official icons dropped into ./icons (listed in icons/manifest.json), then the user's own icons.
loadIconManifest('icons/manifest.json', 'icons/', 'custom:', null).then(loadUserIcons);

/* ---- user icons: upload / delete (needs the local server, run.py) ---- */
const ICON_MAX_BYTES = 2 * 1024 * 1024;
const ICON_NAME_RE = /\.(png|svg|jpe?g|gif|webp)$/i;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('could not read the file'));
    fr.readAsDataURL(file);
  });
}

async function addUserIcons(files) {
  let added = 0;
  const problems = [];
  for (const file of files) {
    try {
      if (!ICON_NAME_RE.test(file.name)) throw new Error('use PNG, SVG, JPG, GIF or WebP');
      if (file.size > ICON_MAX_BYTES) throw new Error('larger than 2 MB');
      const stem = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Icon';
      let name = stem;
      if (files.length === 1) {   // one file: let the user name it
        const answer = prompt('Name for this icon:', stem);
        if (answer === null) continue;
        name = answer.trim() || stem;
      }
      let res;
      try {
        res = await fetch('/api/icons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, filename: file.name, image: await readAsDataURL(file) }),
        });
      } catch (_) {
        throw new Error('the local server is not reachable - start the board with run.py');
      }
      let data = {};
      try { data = await res.json(); } catch (_) { /* non-JSON error page */ }
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      added++;
    } catch (err) {
      problems.push(`${file.name}: ${err.message}`);
    }
  }
  if (added) await loadUserIcons();
  if (problems.length) toast('Could not add ' + problems.join(' · '), 7000);
  else if (added) toast(`Added ${added} icon${added > 1 ? 's' : ''} to User icons`);
}

async function deleteUserIcon(def) {
  if (!confirm(`Remove “${def.name}” from your icons?\nDevices on the board that use it will show a “?” instead.`)) return;
  try {
    const res = await fetch('/api/icons/' + encodeURIComponent(def.file), { method: 'DELETE' });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }
      throw new Error(data.error || 'HTTP ' + res.status);
    }
    if (ui.deviceKind === def.kind && ui.tool === 'device') setTool('select');
    await loadUserIcons();
    toast('Icon removed');
  } catch (err) {
    toast('Could not remove the icon: ' + (err instanceof TypeError ? 'the local server is not reachable' : err.message), 6000);
  }
}

$('#iconInput').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) addUserIcons(files);
});

/* =====================================================================
   Image → editable components, entirely in the browser:
   detect.js finds boxes / lines / curves, Tesseract (bundled in ./vendor) reads the text,
   keyword rules map labels like "firewall" or "Internet" to device symbols.
   ===================================================================== */
const DETECT_MAX_PX = 1600;

const loadedScripts = new Map();
function loadScriptOnce(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loadedScripts.delete(src); reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

/** Label keywords → device kinds. Only used for small shapes and curvy blobs, never for containers. */
const LABEL_KINDS = [
  [/load\s*-?balanc|\blb\b|\bf5\b|\belb\b|\bilb\b|\balb\b/i, 'loadbalancer'],
  [/fire\s*-?wall|\bfw\b|\bwaf\b|\bnva\b|\bngfw\b/i, 'firewall'],
  [/\brouter\b/i, 'router'],
  [/\bswitch\b/i, 'switch'],
  [/\bdatabase\b|\bdb\b|\bsql\b/i, 'database'],
  [/\binternet\b|\bcloud\b/i, 'cloud'],
  [/\bvpn\b/i, 'vpn'],
  [/\baccess point\b|\bwi-?fi\b|\bwlan\b/i, 'ap'],
  [/\bserver\b/i, 'server'],
  [/\bworkstation\b|\blaptop\b|\bpc\b/i, 'pc'],
];
const kindForLabel = (text) => {
  const hit = LABEL_KINDS.find(([re]) => re.test(text || ''));
  return hit ? hit[1] : null;
};

function imageToCanvas(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, DETECT_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);   // flatten transparency onto white
      x.drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error('could not read the image'));
    img.src = src;
  });
}

let ocrWorker = null;
async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      await loadScriptOnce('vendor/tesseract/tesseract.min.js');
      const base = new URL('vendor/tesseract/', location.href).href;   // the worker needs absolute URLs
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core/',
        langPath: base + 'lang/',
        gzip: false,
        cacheMethod: 'none',
      });
      return w;
    })();
    ocrWorker.catch(() => { ocrWorker = null; });
  }
  return ocrWorker;
}

/**
 * Copy of the image with long, thick strokes (box outlines, connectors) painted white, so the OCR
 * sees only text. Dark-background images are inverted to dark-on-light first.
 */
function eraseThickStrokes(src) {
  const W = src.width, H = src.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, W, H), px = d.data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 28) { sum += (px[i] + px[i + 1] + px[i + 2]) / 3; n++; }
  if (sum / n < 110) for (let i = 0; i < px.length; i += 4) { px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2]; }
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3 < 140 ? 1 : 0;

  const MIN_RUN = 28, MIN_THICK = 3, MAX_T = 12;
  const kill = new Uint8Array(W * H);
  const covRow = (y, a, b) => { let s = 0; for (let i = a; i < b; i++) s += ink[y * W + i]; return s / (b - a); };
  const covCol = (xx, a, b) => { let s = 0; for (let i = a; i < b; i++) s += ink[i * W + xx]; return s / (b - a); };
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let xx = 0; xx <= W; xx++) {
      const on = xx < W && ink[y * W + xx];
      if (on) { if (start < 0) start = xx; continue; }
      if (start >= 0 && xx - start >= MIN_RUN) {
        let t = 1;
        for (let yy = y - 1; yy >= 0 && t < MAX_T && covRow(yy, start, xx) >= 0.8; yy--) t++;
        for (let yy = y + 1; yy < H && t < MAX_T && covRow(yy, start, xx) >= 0.8; yy++) t++;
        if (t >= MIN_THICK) for (let i = start; i < xx; i++) kill[y * W + i] = 1;
      }
      start = -1;
    }
  }
  for (let xx = 0; xx < W; xx++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && ink[y * W + xx];
      if (on) { if (start < 0) start = y; continue; }
      if (start >= 0 && y - start >= MIN_RUN) {
        let t = 1;
        for (let x2 = xx - 1; x2 >= 0 && t < MAX_T && covCol(x2, start, y) >= 0.8; x2--) t++;
        for (let x2 = xx + 1; x2 < W && t < MAX_T && covCol(x2, start, y) >= 0.8; x2++) t++;
        if (t >= MIN_THICK) for (let i = start; i < y; i++) kill[i * W + xx] = 1;
      }
      start = -1;
    }
  }
  const wipe = new Uint8Array(W * H);   // grow the killed area by 1 px to take the anti-aliased edge too
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    if (!kill[y * W + xx]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, x2 = xx + dx;
      if (yy >= 0 && yy < H && x2 >= 0 && x2 < W) wipe[yy * W + x2] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) if (wipe[i]) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; }
  x.putImageData(d, 0, 0);
  return c;
}

/** OCR step. Returns paragraphs: [{ text, x, y, w, h, fontPx }] in the pixels of `canvas`. */
async function readText(canvas) {
  const worker = await getOcrWorker();
  const clean = eraseThickStrokes(canvas);
  // Tesseract likes text ~20-40 px tall; diagram labels are usually much smaller, so upscale first
  const k = clamp(2400 / Math.max(canvas.width, canvas.height), 1, 3);
  let input = clean;
  if (k > 1.05) {
    input = document.createElement('canvas');
    input.width = Math.round(clean.width * k);
    input.height = Math.round(clean.height * k);
    const x = input.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(clean, 0, 0, input.width, input.height);
  }
  const collect = async (mode) => {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const { data } = await worker.recognize(input, {}, { blocks: true });
    const found = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      const text = (l.text || '').replace(/\s+/g, ' ').trim();
      // drop junk read from stray marks: too short, low confidence, or no letters/digits
      if (text.length < 2 || l.confidence < 45 || (l.confidence < 70 && text.length < 4) || !/[a-z0-9]/i.test(text)) continue;
      // The OCR line/word boxes can swallow nearby marks (e.g. a dash under a word makes that word twice as
      // tall), so take the vertical extent from words of typical height only.
      const ws = (l.words || []).filter((w) => w.text && w.text.trim() && w.bbox);
      let bb = l.bbox;
      if (ws.length) {
        const hs = ws.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b), med = hs[Math.floor(hs.length / 2)];
        const typical = ws.filter((w) => w.bbox.y1 - w.bbox.y0 <= 1.6 * med);
        bb = {
          x0: Math.min(...ws.map((w) => w.bbox.x0)), x1: Math.max(...ws.map((w) => w.bbox.x1)),
          y0: Math.min(...typical.map((w) => w.bbox.y0)), y1: Math.max(...typical.map((w) => w.bbox.y1)),
        };
      }
      found.push({ text, x: bb.x0 / k, y: bb.y0 / k, w: (bb.x1 - bb.x0) / k, h: (bb.y1 - bb.y0) / k });
    }
    return found;
  };
  // Sparse mode finds scattered labels; automatic layout mode also catches text beside curves (e.g. on a cloud).
  const lines = await collect(Tesseract.PSM.SPARSE_TEXT);
  const overlap = (a, b) => {
    const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return iw > 0 && ih > 0 ? (iw * ih) / (a.w * a.h) : 0;
  };
  for (const a of await collect(Tesseract.PSM.AUTO)) {
    if (!lines.some((s) => overlap(a, s) > 0.3)) lines.push(a);
  }
  return groupTextLines(lines);
}

/** Stack OCR lines that are left-aligned, similar in height and close together into one paragraph. */
function groupTextLines(lines) {
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = [];
  for (const l of lines) {
    const g = groups.find((gr) => {
      const last = gr[gr.length - 1];
      return Math.abs(l.x - last.x) <= 0.8 * l.h
        && l.y - (last.y + last.h) <= 0.9 * l.h && l.y > last.y
        && Math.abs(l.h - last.h) / Math.max(l.h, last.h) < 0.4;
    });
    if (g) g.push(l); else groups.push([l]);
  }
  return groups.map((gr) => {
    const x0 = Math.min(...gr.map((l) => l.x)), y0 = Math.min(...gr.map((l) => l.y));
    const x1 = Math.max(...gr.map((l) => l.x + l.w)), y1 = Math.max(...gr.map((l) => l.y + l.h));
    let fontPx;
    if (gr.length > 1) {
      const pitch = gr.slice(1).map((l, i) => l.y - gr[i].y).sort((a, b) => a - b);
      fontPx = pitch[Math.floor(pitch.length / 2)] / 1.2;
    } else {
      // A line's ink height depends on its letters: capitals/ascenders and descenders together span about
      // one em, but "DMZ VNet" (no descenders) only spans ~0.8 em, and "ace" (neither) only ~0.5 em.
      const t = gr[0].text;
      const asc = /[A-Z0-9bdfhklt]/.test(t), desc = /[gjpqy,;()]/.test(t);
      fontPx = gr[0].h / (asc && desc ? 1.03 : asc ? 0.8 : desc ? 0.72 : 0.52);
    }
    return { text: gr.map((l) => l.text).join('\n'), x: x0, y: y0, w: x1 - x0, h: y1 - y0, fontPx };
  });
}

function buildFromDetection(imgObj, det, paras, W, H) {
  const sx = imgObj.w / W, sy = imgObj.h / H;
  const X = (v) => imgObj.x + v * sx, Y = (v) => imgObj.y + v * sy;
  const colour = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1e1e1e');
  const strokeSize = (t) => clamp(Math.round((t || 3) * sx * 2) / 2, 1, 12);
  const fontOf = (px) => clamp(Math.round((px || 14) * sy), 8, 120);
  const cx = (p) => p.x + p.w / 2, cy = (p) => p.y + p.h / 2;
  const within = (p, b, pad = 3) => p.x >= b.x - pad && p.y >= b.y - pad && p.x + p.w <= b.x + b.w + pad && p.y + p.h <= b.y + b.h + pad;
  const centreIn = (p, b) => cx(p) >= b.x && cx(p) <= b.x + b.w && cy(p) >= b.y && cy(p) <= b.y + b.h;
  const unionOf = (list) => {
    const x0 = Math.min(...list.map((p) => p.x)), y0 = Math.min(...list.map((p) => p.y));
    const x1 = Math.max(...list.map((p) => p.x + p.w)), y1 = Math.max(...list.map((p) => p.y + p.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const used = new Set();
  const labelOf = (list) => [...list].sort((a, b) => a.y - b.y).map((p) => p.text).join('\n');

  // 1. text that sits (roughly) centred in a box with no box inside it becomes that box's label
  const boxes = det.boxes.map((b) => ({ ...b }));
  const isContainer = (b) => boxes.some((o) => o !== b && o.x >= b.x - 2 && o.y >= b.y - 2 && o.x + o.w <= b.x + b.w + 2 && o.y + o.h <= b.y + b.h + 2);
  for (const b of [...boxes].sort((a, c) => a.w * a.h - c.w * c.h)) {
    if (isContainer(b)) continue;
    const cand = paras.filter((p) => !used.has(p) && within(p, b));
    if (!cand.length) continue;
    const u = unionOf(cand);
    // several separate pieces of text only count as one label if they are stacked on the same centre line
    const midX = cand.reduce((s, p) => s + cx(p), 0) / cand.length;
    const stacked = cand.every((p) => Math.abs(cx(p) - midX) / b.w < 0.1);
    if (stacked && Math.abs(u.x + u.w / 2 - (b.x + b.w / 2)) / b.w < 0.15 && Math.abs(u.y + u.h / 2 - (b.y + b.h / 2)) / b.h < 0.2) {
      b.text = labelOf(cand);
      b.fontPx = Math.max(...cand.map((p) => p.fontPx));
      b.small = b.w <= 220 && b.h <= 220;
      cand.forEach((p) => used.add(p));
    }
  }
  // text overlapping a curvy closed blob (e.g. a hand-drawn cloud) belongs to it
  const blobs = det.blobs.map((b) => ({ ...b }));
  for (const b of blobs) {
    const cand = paras.filter((p) => !used.has(p) && centreIn(p, b));
    if (!b.closed || !cand.length) continue;
    // keep only the lines that name a device, minus stray one-character reads from the outline
    const named = cand.flatMap((p) => p.text.split('\n'))
      .filter((l) => kindForLabel(l))
      .map((l) => l.split(' ').filter((w) => w.length > 1).join(' '))
      .filter(Boolean);
    if (named.length) {
      b.text = named.join('\n');
      cand.forEach((p) => used.add(p));   // junk read from the outline goes with it
    }
  }

  // 2. create objects
  const out = [], idFor = new Map();
  const deviceAt = (b, kind, text) => {
    const size = clamp(Math.round(Math.min(b.w, b.h) * sx), 48, 96);
    return { id: uid(), type: 'device', kind, x: X(b.x + b.w / 2) - size / 2, y: Y(b.y + b.h / 2) - size / 2, w: size, h: size, text };
  };
  for (const b of boxes) {
    const kind = b.text && b.small ? kindForLabel(b.text) : null;
    let o;
    if (kind && DEV_BY_KIND[kind]) {
      o = deviceAt(b, kind, b.text);
    } else {
      o = { id: uid(), type: b.kind === 'ellipse' ? 'ellipse' : 'rect', x1: X(b.x), y1: Y(b.y), x2: X(b.x + b.w), y2: Y(b.y + b.h), color: colour(b.color), size: strokeSize(b.thickness) };
      if (b.text) { o.text = b.text; o.fontSize = fontOf(b.fontPx); }
    }
    idFor.set(b.id, o.id);
    out.push(o);
  }
  for (const b of blobs) {
    const kind = b.text ? kindForLabel(b.text) : null;
    if (kind && DEV_BY_KIND[kind]) {
      const o = deviceAt(b, kind, b.text);
      idFor.set(b.id, o.id);
      out.push(o);
    } else if (b.points && b.points.length > 1) {
      const pts = b.points.map(([px, py]) => [X(px), Y(py)]);
      if (b.closed) pts.push(pts[0]);
      out.push({ id: uid(), type: 'stroke', points: pts, color: colour(b.color), size: strokeSize(b.thickness) });
    }
  }
  for (const l of det.lines) {
    const a = idFor.get(l.from), z = idFor.get(l.to);
    if (a && z && a !== z) {
      out.push({ id: uid(), type: 'link', from: a, to: z, color: colour(l.color), size: strokeSize(l.thickness), dash: false, arrow: l.head === 'end' || l.head === 'both', text: '' });
    } else {
      const flip = l.head === 'start';
      const p = flip ? [l.x2, l.y2, l.x1, l.y1] : [l.x1, l.y1, l.x2, l.y2];
      out.push({ id: uid(), type: l.head && l.head !== 'none' ? 'arrow' : 'line', x1: X(p[0]), y1: Y(p[1]), x2: X(p[2]), y2: Y(p[3]), color: colour(l.color), size: strokeSize(l.thickness) });
    }
  }
  // 3. all remaining text stays free-standing text
  for (const p of paras) {
    if (used.has(p) || !p.text.trim()) continue;
    const fs = fontOf(p.fontPx);
    out.push({ id: uid(), type: 'text', x: X(p.x), y: Y(p.y) - fs * 0.1, text: p.text, color: '#1e1e1e', fontSize: fs });
  }
  return out;
}

async function detectComponents(imgObj) {
  if (ui.busy) return;
  ui.busy = true;
  renderProps();
  try {
    toast('Preparing image…', 120000);
    imgObj = findObj(imgObj.id) || imgObj;
    const canvas = await imageToCanvas(imgObj.src);
    await loadScriptOnce('detect.js');
    if (!window.DiagramDetect) throw new Error('detect.js did not load - start the board with run.py');

    let paras = [], ocrNote = '';
    try {
      toast('Reading text (the first run takes a few seconds)…', 120000);
      paras = await readText(canvas);
    } catch (err) {
      ocrNote = ' (text recognition was unavailable: ' + err.message + ')';
    }

    toast('Finding shapes and lines…', 120000);
    await new Promise((r) => setTimeout(r, 30));   // let the toast paint before the heavy loop
    const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const det = window.DiagramDetect.detect(img, {
      textBoxes: paras.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    });

    imgObj = findObj(imgObj.id);   // use the image's current position if it was moved meanwhile
    if (!imgObj) throw new Error('the image was removed while it was being analyzed');
    const out = buildFromDetection(imgObj, det, paras, canvas.width, canvas.height);
    if (!out.length) throw new Error('nothing recognisable was found in the image');

    state.objects = state.objects.filter((x) => x.id !== imgObj.id).concat(out);
    ui.selection = new Set(out.map((o) => o.id));
    ui.tool = 'select';
    renderTools();
    commit();
    toast(`Found ${out.length} objects - Ctrl+Z brings the original image back${ocrNote}`, 7000);
  } catch (err) {
    toast('Detection failed: ' + err.message, 7000);
  } finally {
    ui.busy = false;
    renderProps();
  }
}


/* =====================================================================
   Boot
   ===================================================================== */
resizeCanvas();
buildLibrary();
renderTools();
let loaded = false;
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) { loadData(JSON.parse(raw)); loaded = true; }
} catch (_) { /* corrupt or unavailable storage: start fresh */ }
if (!loaded) { resetHistory(); viewChanged(); }
renderProps();
setCursor();
})();
