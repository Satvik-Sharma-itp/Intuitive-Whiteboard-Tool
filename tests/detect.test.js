/* Tests for detect.js - plain Node script, no framework.
   Run:  node tests/detect.test.js      (exit code 1 on any failure)

   All images are synthetic: they are rasterised into an RGBA buffer by the tiny
   anti-aliased drawing helpers below (no native deps). */
'use strict';
const path = require('path');
const { detect } = require(path.join(__dirname, '..', 'detect.js'));

/* ------------------------------------------------------------ deterministic RNG */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ canvas + drawing */
function makeCanvas(w, h, bg, ink) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  return { w, h, data, bg, ink };
}
function drawSeg(c, x1, y1, x2, y2, th, col) {
  col = col || c.ink;
  const r = th / 2 + 1;
  const xa = Math.max(0, Math.floor(Math.min(x1, x2) - r)), xb = Math.min(c.w - 1, Math.ceil(Math.max(x1, x2) + r));
  const ya = Math.max(0, Math.floor(Math.min(y1, y2) - r)), yb = Math.min(c.h - 1, Math.ceil(Math.max(y1, y2) + r));
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, py = y + 0.5;
      let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      let cov = th / 2 + 0.5 - d;
      if (cov <= 0) continue;
      if (cov > 1) cov = 1;
      const i = (y * c.w + x) * 4;
      for (let k = 0; k < 3; k++) c.data[i + k] = c.data[i + k] * (1 - cov) + col[k] * cov;
    }
  }
}
function drawPoly(c, pts, th, closed, col) {
  for (let i = 0; i + 1 < pts.length; i++) drawSeg(c, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], th, col);
  if (closed) drawSeg(c, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], th, col);
}
function fillTri(c, p, q, r, col) {      // simple filled triangle with 4x4 supersampling
  col = col || c.ink;
  const xa = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0]))), xb = Math.min(c.w - 1, Math.ceil(Math.max(p[0], q[0], r[0])));
  const ya = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1]))), yb = Math.min(c.h - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
  function side(a, b, x, y) { return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); }
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    let hit = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const X = x + (sx + 0.5) / 4, Y = y + (sy + 0.5) / 4;
      const s1 = side(p, q, X, Y), s2 = side(q, r, X, Y), s3 = side(r, p, X, Y);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) hit++;
    }
    const cov = hit / 16;
    if (!cov) continue;
    const i = (y * c.w + x) * 4;
    for (let k = 0; k < 3; k++) c.data[i + k] = c.data[i + k] * (1 - cov) + col[k] * cov;
  }
}
/* slightly wobbly straight stroke */
function wobbly(c, x1, y1, x2, y2, th, amp, R) {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(1, Math.ceil(L / 5));
  const nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
  const l1 = 70 + R() * 40, l2 = 35 + R() * 15, p1 = R() * 6.28, p2 = R() * 6.28;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n * L;
    const off = amp * (0.6 * Math.sin(6.283 * s / l1 + p1) + 0.4 * Math.sin(6.283 * s / l2 + p2));
    pts.push([x1 + (x2 - x1) * i / n + nx * off, y1 + (y2 - y1) * i / n + ny * off]);
  }
  drawPoly(c, pts, th, false);
}
/* rectangle outline given its OUTER bbox */
function rectOutline(c, x, y, w, h, th, amp, R) {
  const x0 = x + th / 2, y0 = y + th / 2, x1 = x + w - th / 2, y1 = y + h - th / 2;
  wobbly(c, x0 - 0.5, y0, x1 + 0.5, y0, th, amp, R);
  wobbly(c, x1, y0 - 0.5, x1, y1 + 0.5, th, amp, R);
  wobbly(c, x1 + 0.5, y1, x0 - 0.5, y1, th, amp, R);
  wobbly(c, x0, y1 + 0.5, x0, y0 - 0.5, th, amp, R);
}
function ellipsePts(cx, cy, a, b, lobes, lobeAmp, n, phase) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * 6.2832;
    const r = 1 + lobeAmp * Math.sin(lobes * t + phase) + lobeAmp * 0.3 * Math.sin((lobes * 2 - 1) * t);
    pts.push([cx + a * r * Math.cos(t), cy + b * r * Math.sin(t)]);
  }
  return pts;
}
function bboxOf(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1 };
}
/* a row of small thin "glyph" marks standing in for text; returns its bounding rect */
function textRow(c, x, y, nChars, R, size) {
  size = size || 9;
  for (let i = 0; i < nChars; i++) {
    const cx = x + i * (size * 0.8 + 1);
    const kind = R();
    if (kind < 0.25) {          // little loop
      const pts = [];
      for (let k = 0; k < 10; k++) pts.push([cx + size * 0.3 + Math.cos(k / 10 * 6.28) * size * 0.3, y + size * 0.55 + Math.sin(k / 10 * 6.28) * size * 0.3]);
      drawPoly(c, pts, 1.6, true);
    } else {
      const ns = 2 + (R() < 0.5 ? 1 : 0);
      for (let k = 0; k < ns; k++) {
        const ax = cx + R() * size * 0.6, ay = y + R() * size, bx = cx + R() * size * 0.6, by = y + R() * size;
        drawSeg(c, ax, ay, bx, by, 1.7);
      }
    }
  }
  return { x: x - 1, y: y - 1, w: nChars * (size * 0.8 + 1) + 2, h: size + 2 };
}
function dotGrid(c, step, val) {
  for (let y = step / 2; y < c.h; y += step) for (let x = step / 2; x < c.w; x += step) {
    const col = c.bg[0] > 128 ? [val, val, val] : [255 - val, 255 - val, 255 - val];
    drawSeg(c, x, y, x + 0.6, y, 1.6, col);
  }
}
function addNoise(c, amp, R) {
  for (let i = 0; i < c.w * c.h; i++) {
    const n = (R() - 0.5) * 2 * amp;
    for (let k = 0; k < 3; k++) c.data[i * 4 + k] = c.data[i * 4 + k] + n;
  }
}
function blur3(c) {
  const src = new Uint8ClampedArray(c.data);
  for (let y = 1; y < c.h - 1; y++) for (let x = 1; x < c.w - 1; x++) for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * c.w + x + dx) * 4 + k] * ((dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1);
    c.data[(y * c.w + x) * 4 + k] = s / 16;
  }
}
function toImage(c) { return { data: c.data, width: c.w, height: c.h }; }

/* ------------------------------------------------------------ scenes */
const LIGHT = { bg: [255, 255, 255], ink: [25, 25, 30] };
const DARK = { bg: [27, 29, 34], ink: [232, 232, 236] };

/* KEY CASE: cloud -> short wide box -> box -> big box, text everywhere */
function sceneKey(seed, pal) {
  pal = pal || LIGHT;
  const R = rng(seed);
  const c = makeCanvas(920, 640, pal.bg, pal.ink);
  const TH = 4;
  dotGrid(c, 20, 215);
  const cloudPts = ellipsePts(460, 78, 29, 18, 5, 0.13, 90, 0.7);
  const cloudBox = bboxOf(cloudPts);
  drawPoly(c, cloudPts, TH, true);
  const boxes = [
    { x: 420, y: 150, w: 80, h: 25 },     // short wide
    { x: 402, y: 225, w: 115, h: 42 },    // medium
    { x: 340, y: 320, w: 240, h: 115 }    // large
  ];
  for (const b of boxes) rectOutline(c, b.x, b.y, b.w, b.h, TH, 1.2, R);
  const cloudBottom = cloudPts.reduce((m, p) => (Math.abs(p[0] - 460) < 3 && p[1] > m ? p[1] : m), 0);
  wobbly(c, 460, cloudBottom, 460, boxes[0].y + TH / 2, TH, 1.2, R);
  wobbly(c, 460, boxes[0].y + boxes[0].h - TH / 2, 460, boxes[1].y + TH / 2, TH, 1.2, R);
  wobbly(c, 460, boxes[1].y + boxes[1].h - TH / 2, 460, boxes[2].y + TH / 2, TH, 1.2, R);
  // text-like clusters
  const textBoxes = [];
  let marks = 0;
  function row(x, y, n, size) { textBoxes.push(textRow(c, x, y, n, R, size)); marks += n; }
  row(448, 92, 6, 8);                                   // overlaps the cloud outline / connector top
  for (let i = 0; i < 3; i++) row(60, 90 + i * 16, 10, 9);          // left of everything
  for (let i = 0; i < 4; i++) row(620, 80 + i * 16, 12, 9);         // right
  row(430, 158, 7, 8);                                  // inside box 1
  row(415, 238, 9, 8);                                  // inside box 2
  for (let i = 0; i < 3; i++) row(362, 345 + i * 22, 14, 9);   // inside the big box
  for (let i = 0; i < 3; i++) row(640, 330 + i * 18, 10, 9);
  addNoise(c, 5, R);
  return {
    img: toImage(c), canvas: c, textBoxes, marks,
    truth: { boxes, cloud: { x: cloudBox.x0 - TH / 2, y: cloudBox.y0 - TH / 2, w: cloudBox.x1 - cloudBox.x0 + TH, h: cloudBox.y1 - cloudBox.y0 + TH } }
  };
}

/* container + nested box + diagonal arrow to a third box */
function sceneNested(seed) {
  const R = rng(seed);
  const c = makeCanvas(800, 560, LIGHT.bg, LIGHT.ink);
  const TH = 4;
  dotGrid(c, 20, 215);
  const container = { x: 60, y: 60, w: 300, h: 230 };
  const nested = { x: 110, y: 135, w: 120, h: 70 };
  const third = { x: 520, y: 350, w: 170, h: 80 };
  rectOutline(c, container.x, container.y, container.w, container.h, TH, 1.2, R);
  rectOutline(c, nested.x, nested.y, nested.w, nested.h, TH, 1.2, R);
  rectOutline(c, third.x, third.y, third.w, third.h, TH, 1.2, R);
  // diagonal connector: container right edge -> third box left edge, arrow head at the end
  const sx = container.x + container.w - TH / 2, sy = 190, ex = third.x + TH / 2, ey = 360;
  const L = Math.hypot(ex - sx, ey - sy), ux = (ex - sx) / L, uy = (ey - sy) / L;
  const headLen = 18, hw = 8;
  const bx = ex - ux * headLen, by = ey - uy * headLen;
  wobbly(c, sx, sy, bx, by, TH, 0.9, R);
  fillTri(c, [ex, ey], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]);
  const textBoxes = [];
  function row(x, y, n, size) { textBoxes.push(textRow(c, x, y, n, R, size)); }
  for (let i = 0; i < 3; i++) row(125, 150 + i * 17, 9, 9);
  for (let i = 0; i < 3; i++) row(80, 80 + i * 16, 10, 9);
  for (let i = 0; i < 3; i++) row(540, 370 + i * 16, 10, 9);
  for (let i = 0; i < 4; i++) row(450, 90 + i * 16, 12, 9);
  addNoise(c, 5, R);
  return {
    img: toImage(c), canvas: c, textBoxes,
    truth: { container, nested, third, angle: Math.atan2(ey - sy, ex - sx) * 180 / Math.PI }
  };
}

/* ------------------------------------------------------------ mini assert framework */
let failures = 0, checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log('    FAIL: ' + msg); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function bboxOk(box, t, tol) { return near(box.x, t.x, tol) && near(box.y, t.y, tol) && near(box.w, t.w, tol) && near(box.h, t.h, tol); }
function angleDeg(l) { return Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180 / Math.PI; }
function summary(name, res, ms) {
  console.log('[' + name + '] ' + res.width + 'x' + res.height + ' inverted=' + res.inverted + ' ' + ms.toFixed(0) + 'ms  boxes=' + res.boxes.length + ' lines=' + res.lines.length + ' blobs=' + res.blobs.length);
  for (const b of res.boxes) console.log('    box  ' + b.id + ' ' + b.kind + ' (' + b.x + ',' + b.y + ' ' + b.w + 'x' + b.h + ') th=' + b.thickness + ' ' + b.color);
  for (const l of res.lines) console.log('    line ' + l.id + ' (' + l.x1 + ',' + l.y1 + ')->(' + l.x2 + ',' + l.y2 + ') th=' + l.thickness + ' head=' + l.head + ' from=' + l.from + ' to=' + l.to + ' ' + l.color);
  for (const b of res.blobs) console.log('    blob ' + b.id + ' (' + b.x + ',' + b.y + ' ' + b.w + 'x' + b.h + ') closed=' + b.closed + ' pts=' + b.points.length + ' th=' + b.thickness + ' ' + b.color);
}
function timed(img, opts) {
  const t0 = process.hrtime.bigint();
  const res = detect(img, opts);
  return { res, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

/* ------------------------------------------------------------ the checks for the key layout */
function checkKey(name, res, truth, expectInverted) {
  check(res.inverted === expectInverted, name + ': inverted === ' + expectInverted);
  check(res.boxes.length === 3, name + ': exactly 3 boxes (got ' + res.boxes.length + ')');
  if (res.boxes.length === 3) {
    // largest first: big, medium, short wide
    const order = [truth.boxes[2], truth.boxes[1], truth.boxes[0]];
    for (let i = 0; i < 3; i++) {
      check(res.boxes[i].kind === 'rect', name + ': box ' + i + ' is rect');
      check(bboxOk(res.boxes[i], order[i], 6), name + ': box ' + res.boxes[i].id + ' bbox within 6px of truth ' + JSON.stringify(order[i]) + ' got ' + JSON.stringify([res.boxes[i].x, res.boxes[i].y, res.boxes[i].w, res.boxes[i].h]));
      check(res.boxes[i].thickness >= 3 && res.boxes[i].thickness <= 5.5, name + ': box thickness ~4 (got ' + res.boxes[i].thickness + ')');
    }
  }
  check(res.blobs.length === 1, name + ': exactly 1 blob (got ' + res.blobs.length + ')');
  let cloud = null;
  if (res.blobs.length === 1) {
    cloud = res.blobs[0];
    check(cloud.closed === true, name + ': blob is closed');
    check(bboxOk(cloud, truth.cloud, 7), name + ': blob bbox ~ cloud ' + JSON.stringify(truth.cloud) + ' got ' + JSON.stringify([cloud.x, cloud.y, cloud.w, cloud.h]));
    check(cloud.points.length >= 8 && cloud.points.length <= 60, name + ': blob polyline simplified (' + cloud.points.length + ' pts)');
  }
  check(res.lines.length === 3, name + ': exactly 3 lines (got ' + res.lines.length + ')');
  if (res.lines.length === 3 && res.boxes.length === 3) {
    const big = res.boxes[0].id, mid = res.boxes[1].id, small = res.boxes[2].id;
    const L = res.lines;     // sorted top to bottom
    for (const l of L) {
      const a = Math.abs(angleDeg(l));
      check(near(a, 90, 3), name + ': ' + l.id + ' near-vertical (angle ' + a.toFixed(1) + ')');
      check(l.head === 'none', name + ': ' + l.id + ' has no head (' + l.head + ')');
      check(l.thickness >= 3 && l.thickness <= 5.5, name + ': ' + l.id + ' thickness ~4 (got ' + l.thickness + ')');
    }
    check(cloud && L[0].from === cloud.id && L[0].to === small, name + ': top line connects cloud -> short box (from=' + L[0].from + ', to=' + L[0].to + ')');
    check(L[1].from === small && L[1].to === mid, name + ': line 2 short box -> medium box (' + L[1].from + ',' + L[1].to + ')');
    check(L[2].from === mid && L[2].to === big, name + ': line 3 medium box -> big box (' + L[2].from + ',' + L[2].to + ')');
  }
}

/* ------------------------------------------------------------ cases */
function main() {
  // (1) KEY CASE
  {
    const sc = sceneKey(1);
    console.log('case 1: key layout, glyph marks drawn: ' + sc.marks);
    const { res, ms } = timed(sc.img);
    summary('1 key', res, ms);
    checkKey('1', res, sc.truth, false);
    check(ms < 2000, '1: runtime < 2s (' + ms.toFixed(0) + ' ms)');
    // same, with the OCR text rects as hint (a box outline passing through a text rect must survive)
    const t2 = timed(sc.img, { textBoxes: sc.textBoxes });
    summary('1b key+textBoxes', t2.res, t2.ms);
    checkKey('1b', t2.res, sc.truth, false);
    // different jitter seeds
    for (const seed of [2, 3, 4]) {
      const s2 = sceneKey(seed);
      const t3 = timed(s2.img);
      console.log('[1 seed ' + seed + '] boxes=' + t3.res.boxes.length + ' lines=' + t3.res.lines.length + ' blobs=' + t3.res.blobs.length);
      checkKey('1/seed' + seed, t3.res, s2.truth, false);
    }
    // jpeg-ish: blur + stronger noise
    const sj = sceneKey(7);
    blur3(sj.canvas);
    addNoise(sj.canvas, 10, rng(99));
    const tj = timed(sj.img);
    summary('1c blurred+noisy', tj.res, tj.ms);
    checkKey('1c', tj.res, sj.truth, false);
  }

  // (2) nested box + diagonal arrow
  {
    const sc = sceneNested(5);
    const { res, ms } = timed(sc.img);
    summary('2 nested+diag', res, ms);
    const t = sc.truth;
    check(res.boxes.length === 3, '2: exactly 3 boxes (got ' + res.boxes.length + ')');
    if (res.boxes.length === 3) {
      const [b1, b2, b3] = res.boxes;
      check(bboxOk(b1, t.container, 6), '2: b1 = container');
      check(bboxOk(b2, t.third, 6), '2: b2 = third box');
      check(bboxOk(b3, t.nested, 6), '2: b3 = nested box');
      check(b3.x > b1.x && b3.y > b1.y && b3.x + b3.w < b1.x + b1.w && b3.y + b3.h < b1.y + b1.h, '2: nested box lies inside container');
    }
    check(res.lines.length === 1, '2: exactly 1 line (got ' + res.lines.length + ')');
    check(res.blobs.length === 0, '2: no blobs (got ' + res.blobs.length + ')');
    if (res.lines.length === 1 && res.boxes.length === 3) {
      const l = res.lines[0];
      check(Math.abs(angleDeg(l) - t.angle) <= 3, '2: diagonal angle ' + angleDeg(l).toFixed(1) + ' vs ' + t.angle.toFixed(1));
      check(l.head === 'end', '2: head === end (got ' + l.head + ')');
      check(l.from === res.boxes[0].id && l.to === res.boxes[1].id, '2: from container to third box (' + l.from + ' -> ' + l.to + ')');
    }
    const t2 = timed(sc.img, { textBoxes: sc.textBoxes });
    check(t2.res.boxes.length === 3 && t2.res.lines.length === 1 && t2.res.lines[0].head === 'end', '2b: same result with textBoxes hint');
  }

  // (3) dark mode
  {
    const sc = sceneKey(1, DARK);
    const { res, ms } = timed(sc.img);
    summary('3 dark', res, ms);
    checkKey('3', res, sc.truth, true);
    if (res.boxes.length) {
      const m = res.boxes[0].color.match(/#(..)(..)(..)/);
      check(parseInt(m[1], 16) < 110, '3: colour reported as seen on a light background (dark ink), got ' + res.boxes[0].color);
    }
  }

  // (4) degenerate inputs
  {
    const empty = makeCanvas(500, 400, [255, 255, 255], [0, 0, 0]);
    let r;
    try { r = detect(toImage(empty)); } catch (e) { r = null; console.log(e.stack); }
    check(r && r.boxes.length === 0 && r.lines.length === 0 && r.blobs.length === 0 && r.inverted === false, '4: empty white image -> empty arrays');
    const grid = makeCanvas(500, 400, [255, 255, 255], [0, 0, 0]);
    dotGrid(grid, 20, 200);
    addNoise(grid, 6, rng(3));
    try { r = detect(toImage(grid)); } catch (e) { r = null; console.log(e.stack); }
    check(r && r.boxes.length + r.lines.length + r.blobs.length === 0, '4: dotted grid only -> nothing');
    // noisy images must not throw
    const R = rng(11);
    const noisy = makeCanvas(640, 480, [240, 240, 240], [0, 0, 0]);
    for (let i = 0; i < 640 * 480; i++) {
      let v = 235 + (R() - 0.5) * 80;
      if (R() < 0.02) v = R() * 60;
      noisy.data[i * 4] = noisy.data[i * 4 + 1] = noisy.data[i * 4 + 2] = v;
    }
    let ok = true, t0 = Date.now();
    try { r = detect(toImage(noisy)); } catch (e) { ok = false; console.log(e.stack); }
    check(ok, '4: speckle noise does not throw (' + (Date.now() - t0) + ' ms)');
    check(ok && r.boxes.length === 0 && r.lines.length === 0, '4: speckle noise yields no boxes/lines');
    const white = makeCanvas(300, 200, [0, 0, 0], [255, 255, 255]);
    for (let i = 0; i < 300 * 200; i++) { const v = R() * 255; white.data[i * 4] = white.data[i * 4 + 1] = white.data[i * 4 + 2] = v; }
    ok = true; t0 = Date.now();
    try { detect(toImage(white), { minBoxSize: 20 }); } catch (e) { ok = false; console.log(e.stack); }
    check(ok, '4: full-range random noise does not throw (' + (Date.now() - t0) + ' ms)');
    let ok2 = true;
    try { detect({ data: new Uint8ClampedArray(0), width: 0, height: 0 }); detect(null); detect({ data: new Uint8ClampedArray(16), width: 2, height: 2 }); } catch (e) { ok2 = false; }
    check(ok2, '4: degenerate sizes do not throw');
    console.log('[4 degenerate] done');
  }

  // (5) extras: ellipse, bus line with two heads, elbow connector, line crossing a container outline, large image
  extras();

  console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('ALL OK');
}

function extras() {
  const R = rng(21);
  const TH = 4;
  const c = makeCanvas(900, 600, LIGHT.bg, LIGHT.ink);
  dotGrid(c, 20, 215);
  // ellipse (wobble-free) with a connector down to a box
  const ell = ellipsePts(200, 110, 70, 40, 3, 0.0, 120, 0);
  drawPoly(c, ell, TH, true);
  const boxA = { x: 150, y: 260, w: 100, h: 50 };
  rectOutline(c, boxA.x, boxA.y, boxA.w, boxA.h, TH, 1, R);
  wobbly(c, 200, 150, 200, boxA.y + TH / 2, TH, 1, R);
  // two boxes joined by a horizontal double-headed arrow
  const boxB = { x: 400, y: 80, w: 90, h: 60 }, boxC = { x: 640, y: 80, w: 90, h: 60 };
  rectOutline(c, boxB.x, boxB.y, boxB.w, boxB.h, TH, 1, R);
  rectOutline(c, boxC.x, boxC.y, boxC.w, boxC.h, TH, 1, R);
  const y0 = 110, xs = boxB.x + boxB.w - TH / 2, xe = boxC.x + TH / 2;
  fillTri(c, [xs, y0], [xs + 16, y0 - 7], [xs + 16, y0 + 7]);
  fillTri(c, [xe, y0], [xe - 16, y0 - 7], [xe - 16, y0 + 7]);
  wobbly(c, xs + 14, y0, xe - 14, y0, TH, 1, R);
  // elbow connector from boxA's right edge to a box below-right (horizontal then vertical)
  const boxD = { x: 500, y: 420, w: 120, h: 60 };
  rectOutline(c, boxD.x, boxD.y, boxD.w, boxD.h, TH, 1, R);
  const ey = boxA.y + 25;
  wobbly(c, boxA.x + boxA.w - TH / 2, ey, 560, ey, TH, 1, R);
  wobbly(c, 560, ey - TH / 2, 560, boxD.y + TH / 2, TH, 1, R);
  // connector crossing a container outline: container with inner box, connector from inner box to outside box
  const cont = { x: 60, y: 380, w: 260, h: 170 }, inner = { x: 90, y: 440, w: 80, h: 50 }, outside = { x: 380, y: 440, w: 70, h: 50 };
  rectOutline(c, cont.x, cont.y, cont.w, cont.h, TH, 1, R);
  rectOutline(c, inner.x, inner.y, inner.w, inner.h, TH, 1, R);
  rectOutline(c, outside.x, outside.y, outside.w, outside.h, TH, 1, R);
  wobbly(c, inner.x + inner.w - TH / 2, 465, outside.x + TH / 2, 465, TH, 0.8, R);
  for (let i = 0; i < 6; i++) textRow(c, 600, 250 + i * 16, 12, R, 9);
  addNoise(c, 5, R);
  const { res, ms } = timed(toImage(c));
  summary('5 extras', res, ms);
  const ells = res.boxes.filter(b => b.kind === 'ellipse');
  check(ells.length === 1 && near(ells[0].x, 200 - 70 - 2, 6) && near(ells[0].w, 144, 8) && near(ells[0].h, 84, 8), '5: ellipse detected as ellipse box');
  check(res.boxes.filter(b => b.kind === 'rect').length === 7, '5: 7 rect boxes (got ' + res.boxes.filter(b => b.kind === 'rect').length + ')');
  check(res.blobs.length === 0, '5: no blobs');
  const both = res.lines.filter(l => l.head === 'both');
  check(both.length === 1 && Math.abs(angleDeg(both[0])) < 2, '5: one horizontal double-headed arrow');
  const idOf = (r) => { const b = res.boxes.filter(q => q.kind === 'rect').find(q => near(q.x, r.x, 6) && near(q.y, r.y, 6) && near(q.w, r.w, 6) && near(q.h, r.h, 6)); return b && b.id; };
  const ellId = ells[0] && ells[0].id;
  if (both.length === 1) check(both[0].from === idOf(boxB) && both[0].to === idOf(boxC), '5: double arrow joins B and C');
  const conn = res.lines.find(l => ellId && (l.from === ellId || l.to === ellId));
  check(conn && (conn.from === ellId && conn.to === idOf(boxA)), '5: ellipse -> box A connector');
  const cross = res.lines.find(l => l.from === idOf(inner) && l.to === idOf(outside));
  check(!!cross && Math.abs(cross.x2 - cross.x1) > 250 || (cross && cross.x2 - cross.x1 > 200), '5: connector crossing the container outline is re-joined into one line from inner box to outside box');
  const elbow = res.lines.filter(l => l.from === idOf(boxA) || l.to === idOf(boxD));
  check(elbow.length === 2, '5: elbow connector gives two orthogonal lines (got ' + elbow.length + ')');

  // big image timing
  const big = makeCanvas(1600, 1200, LIGHT.bg, LIGHT.ink);
  dotGrid(big, 20, 215);
  const R2 = rng(5);
  const cloud = ellipsePts(800, 120, 60, 38, 5, 0.13, 120, 0.3);
  drawPoly(big, cloud, 5, true);
  let prevY = 160, boxN = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const b = { x: 120 + j * 350, y: 250 + i * 220, w: 220, h: 120 };
      rectOutline(big, b.x, b.y, b.w, b.h, 5, 1.5, R2); boxN++;
      rectOutline(big, b.x + 20, b.y + 30, 80, 50, 5, 1.2, R2); boxN++;
      if (j < 3) wobbly(big, b.x + b.w - 2.5, b.y + 60, b.x + 350 + 2.5, b.y + 60, 5, 1.2, R2);
      for (let k = 0; k < 3; k++) textRow(big, b.x + 110, b.y + 20 + k * 22, 9, R2, 10);
    }
  }
  wobbly(big, 800, 158, 800, 252, 5, 1.2, R2);
  addNoise(big, 6, R2);
  const tb = timed(toImage(big));
  summary('6 big 1600x1200', { width: tb.res.width, height: tb.res.height, inverted: tb.res.inverted, boxes: [], lines: tb.res.lines.slice(0, 0), blobs: [] }, tb.ms);
  console.log('    big: boxes=' + tb.res.boxes.length + ' (expected ' + boxN + ') lines=' + tb.res.lines.length + ' blobs=' + tb.res.blobs.length);
  check(tb.ms < 2000, '6: 1600x1200 runtime < 2s (' + tb.ms.toFixed(0) + ' ms)');
  check(tb.res.boxes.length === boxN, '6: all ' + boxN + ' boxes found in the big image (got ' + tb.res.boxes.length + ')');
  check(tb.res.blobs.length === 1, '6: one cloud blob in the big image (got ' + tb.res.blobs.length + ')');
}

module.exports = { sceneKey, sceneNested, toImage, makeCanvas, drawSeg, drawPoly, wobbly, rectOutline, ellipsePts, fillTri, textRow, dotGrid, addNoise, blur3, rng, LIGHT, DARK };
if (require.main === module) main();
