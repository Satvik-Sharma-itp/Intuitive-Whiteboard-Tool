/* =====================================================================
   detect.js - classic computer-vision decomposition of a diagram bitmap.

   DiagramDetect.detect(img, opts) -> { width, height, inverted, boxes, lines, blobs }

   Pure JavaScript, no dependencies, no network, no ML.  Works in the browser
   (window.DiagramDetect) and in Node (module.exports).

   Pipeline (all on typed arrays):
     1. luminance, dark-mode detection (median luminance) + inversion,
        local background normalisation (block percentile), Otsu threshold -> ink
     2. per-pixel stroke thickness = min(horizontal run, vertical run); the global
        pen width T is the median over the big components; thinner pixels (text
        glyphs, dots, grid, JPEG speckle) are dropped -> "core" mask
     3. boxes: long horizontal / vertical run bars (merged), assembled into
        closed rectangles (4 bars forming L-corners, ink coverage along every
        side, ink at every corner); their outline pixels are subtracted
     4. leftover ink: re-thinned, Zhang-Suen skeleton, skeleton graph (nodes =
        junctions / end points, branches), spur pruning, branches paired through
        junctions by tangent continuity -> chains
     5. chains: straight -> line (any angle, near-axis snapped), elbow polyline
        (all legs long, sharp turns) -> several lines, closed + elliptical ->
        'ellipse' box, everything else -> blob (Douglas-Peucker polyline)
     6. arrow heads from the ink area / width excess near each line end,
        collinear lines broken by a box outline are re-joined, endpoints are
        associated with (and snapped to) the nearest box outline / blob.
   ===================================================================== */
(function (global) {
'use strict';

/* ------------------------------------------------------------------ helpers */

function hex2(v) { v = Math.round(v); if (v < 0) v = 0; if (v > 255) v = 255; return (v < 16 ? '0' : '') + v.toString(16); }
function toHex(r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); }
function r1(v) { return Math.round(v * 10) / 10; }

/* 8-connected component labelling. Returns label image + per-label stats. */
function labelCC(mask, W, H) {
  const N = W * H;
  const lab = new Int32Array(N);
  const parent = new Int32Array((N >> 1) + 4);
  let next = 1;
  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (!mask[i]) continue;
      const a = x > 0 ? lab[i - 1] : 0;
      const b = (y > 0 && x > 0) ? lab[i - W - 1] : 0;
      const c = y > 0 ? lab[i - W] : 0;
      const d = (y > 0 && x < W - 1) ? lab[i - W + 1] : 0;
      let m = 0;
      if (a) m = a;
      if (b && (!m || b < m)) m = b;
      if (c && (!m || c < m)) m = c;
      if (d && (!m || d < m)) m = d;
      if (!m) { parent[next] = next; lab[i] = next++; continue; }
      lab[i] = m;
      if (a && a !== m) { const ra = find(a), rm = find(m); if (ra !== rm) { if (ra < rm) parent[rm] = ra; else parent[ra] = rm; } }
      if (b && b !== m) { const ra = find(b), rm = find(m); if (ra !== rm) { if (ra < rm) parent[rm] = ra; else parent[ra] = rm; } }
      if (c && c !== m) { const ra = find(c), rm = find(m); if (ra !== rm) { if (ra < rm) parent[rm] = ra; else parent[ra] = rm; } }
      if (d && d !== m) { const ra = find(d), rm = find(m); if (ra !== rm) { if (ra < rm) parent[rm] = ra; else parent[ra] = rm; } }
    }
  }
  const remap = new Int32Array(next);
  let n = 0;
  for (let k = 1; k < next; k++) { if (find(k) === k) remap[k] = ++n; }
  for (let k = 1; k < next; k++) remap[k] = remap[find(k)];
  const x0 = new Int32Array(n + 1).fill(1 << 30), y0 = new Int32Array(n + 1).fill(1 << 30);
  const x1 = new Int32Array(n + 1).fill(-1), y1 = new Int32Array(n + 1).fill(-1);
  const area = new Int32Array(n + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      const l = lab[i];
      if (!l) continue;
      const r = remap[l];
      lab[i] = r;
      area[r]++;
      if (x < x0[r]) x0[r] = x;
      if (x > x1[r]) x1[r] = x;
      if (y < y0[r]) y0[r] = y;
      if (y > y1[r]) y1[r] = y;
    }
  }
  return { lab, n, x0, y0, x1, y1, area };
}

/* horizontal / vertical run length through every set pixel */
function runLengths(mask, W, H) {
  const N = W * H;
  const hr = new Uint16Array(N), vr = new Uint16Array(N), up = new Uint16Array(N);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!mask[row + x]) { x++; continue; }
      const s = x;
      while (x < W && mask[row + x]) x++;
      const len = x - s;
      for (let k = s; k < x; k++) hr[row + k] = len;
    }
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (mask[i]) up[i] = (y > 0 ? up[i - W] : 0) + 1;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (mask[i]) vr[i] = (y < H - 1 && mask[i + W]) ? vr[i + W] : up[i];
    }
  }
  return { hr, vr };
}

function thickMap(mask, W, H) {
  const rl = runLengths(mask, W, H);
  const N = W * H;
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const a = rl.hr[i], b = rl.vr[i];
    const m = a < b ? a : b;
    t[i] = m > 255 ? 255 : m;
  }
  return { t, hr: rl.hr, vr: rl.vr };
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = -1, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = i; }
  }
  return thr;
}

/* Douglas-Peucker on xs/ys between i0..i1 inclusive; returns kept indices (sorted) */
function dpIdx(xs, ys, i0, i1, eps) {
  const keep = [i0];
  const stack = [[i0, i1]];
  const flags = new Map();
  flags.set(i0, true); flags.set(i1, true);
  while (stack.length) {
    const seg = stack.pop();
    const a = seg[0], b = seg[1];
    if (b <= a + 1) continue;
    const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    let md = -1, mi = -1;
    for (let k = a + 1; k < b; k++) {
      let d;
      if (len < 1e-9) d = Math.hypot(xs[k] - ax, ys[k] - ay);
      else d = Math.abs((xs[k] - ax) * dy - (ys[k] - ay) * dx) / len;
      if (d > md) { md = d; mi = k; }
    }
    if (md > eps) { flags.set(mi, true); stack.push([a, mi]); stack.push([mi, b]); }
  }
  const out = Array.from(flags.keys());
  out.sort((p, q) => p - q);
  void keep;
  return out;
}

function pathLength(xs, ys) {
  let L = 0;
  for (let i = 1; i < xs.length; i++) L += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return L;
}

/* total least squares line through points i..j; returns {mx,my,ang} */
function fitLine(xs, ys, i, j) {
  let mx = 0, my = 0;
  const n = j - i + 1;
  for (let k = i; k <= j; k++) { mx += xs[k]; my += ys[k]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = i; k <= j; k++) {
    const dx = xs[k] - mx, dy = ys[k] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { mx, my, ang };
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polyDist(px, py, pts, closed) {
  let best = 1e18;
  const n = pts.length;
  for (let i = 0; i + 1 < n; i++) {
    const d = segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  if (closed && n > 2) {
    const d = segDist(px, py, pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1]);
    if (d < best) best = d;
  }
  if (n === 1) best = Math.hypot(px - pts[0][0], py - pts[0][1]);
  return best;
}


/* binary window filter with a (2r+1)^2 square using an integral image.
   mode 0: erosion (all set), mode 1: dilation (any set) */
function windowFilter(mask, W, H, r, mode) {
  const W1 = W + 1;
  const ii = new Int32Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += mask[y * W + x];
      ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + rowSum;
    }
  }
  const out = new Uint8Array(W * H);
  const full = (2 * r + 1) * (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const ya = y - r, yb = y + r + 1;
    for (let x = 0; x < W; x++) {
      const xa = x - r, xb = x + r + 1;
      if (mode === 0) {
        if (xa < 0 || ya < 0 || xb > W || yb > H) continue;
        if (ii[yb * W1 + xb] - ii[ya * W1 + xb] - ii[yb * W1 + xa] + ii[ya * W1 + xa] === full) out[y * W + x] = 1;
      } else {
        const x0 = xa < 0 ? 0 : xa, y0 = ya < 0 ? 0 : ya, x1 = xb > W ? W : xb, y1 = yb > H ? H : yb;
        if (ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0] > 0) out[y * W + x] = 1;
      }
    }
  }
  return out;
}

/* 3-4 chamfer distance transform (units of 1/3 pixel) of a binary mask (image border = background) */
function chamferDT(mask, W, H) {
  const N = W * H;
  const d = new Uint16Array(N);
  for (let i = 0; i < N; i++) d[i] = mask[i] ? 60000 : 0;
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      if (!d[i]) continue;
      let v = d[i];
      let t = d[i - 1] + 3; if (t < v) v = t;
      t = d[i - W - 1] + 4; if (t < v) v = t;
      t = d[i - W] + 3; if (t < v) v = t;
      t = d[i - W + 1] + 4; if (t < v) v = t;
      d[i] = v;
    }
  }
  for (let y = H - 2; y >= 1; y--) {
    const row = y * W;
    for (let x = W - 2; x >= 1; x--) {
      const i = row + x;
      if (!d[i]) continue;
      let v = d[i];
      let t = d[i + 1] + 3; if (t < v) v = t;
      t = d[i + W + 1] + 4; if (t < v) v = t;
      t = d[i + W] + 3; if (t < v) v = t;
      t = d[i + W - 1] + 4; if (t < v) v = t;
      d[i] = v;
    }
  }
  return d;
}

/* luminance, dark-mode inversion, local background normalisation, Otsu threshold */
function prepare(data, W, H) {
  const N = W * H;
  const lum = new Uint8Array(N);
  const lhist = new Uint32Array(256);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    let r = data[p], g = data[p + 1], b = data[p + 2];
    const a = data[p + 3];
    if (a < 255) { const k = a / 255, q = 255 * (1 - k); r = r * k + q; g = g * k + q; b = b * k + q; }
    const l = (r * 299 + g * 587 + b * 114) / 1000 | 0;
    lum[i] = l; lhist[l]++;
  }
  let acc = 0, med = 255;
  for (let v = 0; v < 256; v++) { acc += lhist[v]; if (acc * 2 >= N) { med = v; break; } }
  const inverted = med < 128;
  if (inverted) {
    for (let i = 0; i < N; i++) lum[i] = 255 - lum[i];
    med = 255 - med;
  }
  // local background (90th percentile per 32px block, bilinear), so photos with shading work
  const B = 32, nbx = Math.ceil(W / B), nby = Math.ceil(H / B);
  const bgGrid = new Float32Array(nbx * nby);
  const bh = new Uint32Array(256);
  const bgFloor = Math.max(120, med * 0.7);
  let gMin = 1e9, gMax = -1;
  for (let by = 0; by < nby; by++) {
    for (let bx = 0; bx < nbx; bx++) {
      bh.fill(0);
      const xa = bx * B, xb = Math.min(W, xa + B), ya = by * B, yb = Math.min(H, ya + B);
      let cnt = 0;
      for (let y = ya; y < yb; y++) { const row = y * W; for (let x = xa; x < xb; x++) { bh[lum[row + x]]++; cnt++; } }
      let s = 0, v = 255;
      const target = cnt * 0.9;
      for (let k = 0; k < 256; k++) { s += bh[k]; if (s >= target) { v = k; break; } }
      v = Math.max(v, bgFloor);
      bgGrid[by * nbx + bx] = v;
      if (v < gMin) gMin = v;
      if (v > gMax) gMax = v;
    }
  }
  const cN = new Uint8Array(N);          // normalised luminance (background -> 255)
  const chist = new Uint32Array(256);
  if (gMax - gMin <= 10) {               // uniform background: a lookup table is enough
    const bg = (gMin + gMax) / 2;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.min(255, (v * 255 / bg) | 0);
    for (let i = 0; i < N; i++) { const c = lut[lum[i]]; cN[i] = c; chist[c]++; }
  } else {
    const ixa = new Int32Array(W), ixb = new Int32Array(W), fxs = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const g = (x + 0.5) / B - 0.5;
      let i0 = Math.floor(g); const f = g - i0;
      let i1 = i0 + 1;
      if (i0 < 0) i0 = 0; if (i1 < 0) i1 = 0;
      if (i0 > nbx - 1) i0 = nbx - 1; if (i1 > nbx - 1) i1 = nbx - 1;
      ixa[x] = i0; ixb[x] = i1; fxs[x] = f;
    }
    for (let y = 0; y < H; y++) {
      const g = (y + 0.5) / B - 0.5;
      let j0 = Math.floor(g); const fy = g - j0;
      let j1 = j0 + 1;
      if (j0 < 0) j0 = 0; if (j1 < 0) j1 = 0;
      if (j0 > nby - 1) j0 = nby - 1; if (j1 > nby - 1) j1 = nby - 1;
      const r0 = j0 * nbx, r1_ = j1 * nbx, row = y * W;
      for (let x = 0; x < W; x++) {
        const f = fxs[x];
        const top = bgGrid[r0 + ixa[x]] * (1 - f) + bgGrid[r0 + ixb[x]] * f;
        const bot = bgGrid[r1_ + ixa[x]] * (1 - f) + bgGrid[r1_ + ixb[x]] * f;
        const bg = top * (1 - fy) + bot * fy;
        let c = lum[row + x] * 255 / bg;
        if (c > 255) c = 255;
        c = c | 0;
        cN[row + x] = c; chist[c]++;
      }
    }
  }
  const ot = otsu(chist, N);
  return { cN, inverted, med, thr: Math.max(105, Math.min(180, ot)) };
}

/* ------------------------------------------------------------------ detect */

function detect(img, opts) {
  opts = opts || {};
  const W = (img && img.width) | 0, H = (img && img.height) | 0;
  const res = { width: W, height: H, inverted: false, boxes: [], lines: [], blobs: [] };
  if (!img || !img.data || W < 16 || H < 16 || img.data.length < W * H * 4) return res;
  const N = W * H;
  const data = img.data;
  let _t0 = Date.now();
  function mark(n) { if (opts._debug) { const t = Date.now(); (opts._debug.t = opts._debug.t || []).push(n + ':' + (t - _t0)); _t0 = t; } }
  const minBox = opts.minBoxSize > 0 ? opts.minBoxSize : 14;

  /* ---------- 1. luminance, inversion, normalisation, threshold ---------- */
  const prep = prepare(data, W, H);
  const inverted = prep.inverted, cN = prep.cN, med = prep.med;
  res.inverted = inverted;
  const thr = prep.thr;
  mark('norm');
  const ink = new Uint8Array(N);
  let inkCount = 0;
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) if (cN[row + x] < thr) { ink[row + x] = 1; inkCount++; }
  }
  if (inkCount < 20 || inkCount > N * 0.4) return res;

  // original colour of a pixel (flipped if the image was dark-mode)
  function rgbAt(i, out) {
    const p = i * 4;
    let r = data[p], g = data[p + 1], b = data[p + 2];
    const a = data[p + 3];
    if (a < 255) { const k = a / 255, q = 255 * (1 - k); r = r * k + q; g = g * k + q; b = b * k + q; }
    if (inverted) { r = 255 - r; g = 255 - g; b = 255 - b; }
    out[0] = r; out[1] = g; out[2] = b;
  }
  const darkCut = thr * 0.6;

  /* ---------- 2. stroke thickness, pen width T, core mask ---------- */
  const tm = thickMap(ink, W, H);
  const ccInk = labelCC(ink, W, H);
  const bigComp = new Uint8Array(ccInk.n + 1);
  const meanThickNum = new Float64Array(ccInk.n + 1);
  for (let i = 0; i < N; i++) { const l = ccInk.lab[i]; if (l) meanThickNum[l] += tm.t[i]; }
  for (let k = 1; k <= ccInk.n; k++) {
    const md = Math.max(ccInk.x1[k] - ccInk.x0[k], ccInk.y1[k] - ccInk.y0[k]) + 1;
    if (md >= 40 && ccInk.area[k] >= 120) bigComp[k] = 1;
  }
  const th_hist = new Uint32Array(64), th_all = new Uint32Array(64);
  let nBig = 0, nAll = 0;
  for (let i = 0; i < N; i++) {
    const l = ccInk.lab[i];
    if (!l) continue;
    const t = tm.t[i] > 63 ? 63 : tm.t[i];
    th_all[t]++; nAll++;
    if (bigComp[l]) { th_hist[t]++; nBig++; }
  }
  function histMedian(h, n) {
    let s = 0;
    for (let k = 0; k < 64; k++) { s += h[k]; if (s * 2 >= n) return k; }
    return 1;
  }
  let T = nBig > 50 ? histMedian(th_hist, nBig) : histMedian(th_all, nAll);
  if (T < 1) T = 1;
  const thrThick = T < 2.5 ? 1 : Math.max(2, Math.round(0.7 * T));

  mark('thick/T');
  // OCR text hint: kill small / thin components lying inside text rects
  const killComp = new Uint8Array(ccInk.n + 1);
  if (opts.textBoxes && opts.textBoxes.length) {
    const tbs = opts.textBoxes;
    for (let k = 1; k <= ccInk.n; k++) {
      const cw = ccInk.x1[k] - ccInk.x0[k] + 1, ch = ccInk.y1[k] - ccInk.y0[k] + 1;
      const md = Math.max(cw, ch);
      const meanT = meanThickNum[k] / ccInk.area[k];
      if (!(md <= 48 || meanT < thrThick)) continue;
      for (let q = 0; q < tbs.length; q++) {
        const tb = tbs[q];
        if (ccInk.x0[k] >= tb.x - 3 && ccInk.x1[k] <= tb.x + tb.w + 3 && ccInk.y0[k] >= tb.y - 3 && ccInk.y1[k] <= tb.y + tb.h + 3) { killComp[k] = 1; break; }
      }
    }
  }
  let core = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!ink[i]) continue;
    const l = ccInk.lab[i];
    if (killComp[l]) continue;
    if (tm.t[i] >= thrThick) core[i] = 1;
  }
  {
    const cc = labelCC(core, W, H);
    const minDim = Math.max(8, Math.round(2.2 * T));
    const keep = new Uint8Array(cc.n + 1);
    for (let k = 1; k <= cc.n; k++) {
      const md = Math.max(cc.x1[k] - cc.x0[k], cc.y1[k] - cc.y0[k]) + 1;
      if (md >= minDim) keep[k] = 1;
    }
    for (let i = 0; i < N; i++) if (core[i] && !keep[cc.lab[i]]) core[i] = 0;
  }

  mark('core');
  /* ---------- 3. boxes: bars -> closed rectangles ---------- */
  mark('core2');
  const rl = runLengths(core, W, H);
  mark('rl');
  const Lrun = Math.max(8, Math.round(2 * T));
  const mH = new Uint8Array(N), mV = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!core[i]) continue;
    if (rl.hr[i] >= Lrun) mH[i] = 1;
    if (rl.vr[i] >= Lrun) mV[i] = 1;
  }
  mark('masks');
  const cH = labelCC(mH, W, H), cV = labelCC(mV, W, H);
  mark('cc');
  const maxPerp = 2.2 * T + 6;

  function collectBars(cc, horiz, mask) {
    // per component: perpendicular-coordinate histogram -> dominant band (so attached arrow heads,
    // connectors and blobs do not disturb the bar); bar statistics from the band pixels only
    const n = cc.n;
    let nIdx = 0;
    for (let i = 0; i < N; i++) if (mask[i]) nIdx++;
    const idxList = new Int32Array(nIdx);
    nIdx = 0;
    for (let i = 0; i < N; i++) if (mask[i]) idxList[nIdx++] = i;
    const p0s = horiz ? cc.y0 : cc.x0, p1s = horiz ? cc.y1 : cc.x1;
    const off = new Int32Array(n + 2);
    let total = 0;
    for (let l = 1; l <= n; l++) {
      off[l] = total;
      const ext = p1s[l] - p0s[l] + 1;
      const a0 = horiz ? cc.x0[l] : cc.y0[l], a1 = horiz ? cc.x1[l] : cc.y1[l];
      if (a1 - a0 + 1 >= Lrun && ext <= 160) total += ext;
    }
    off[n + 1] = total;
    const hist = new Int32Array(total + 1);
    for (let q = 0; q < nIdx; q++) {
      const i = idxList[q];
      const l = cc.lab[i];
      const ext = p1s[l] - p0s[l] + 1;
      if (off[l + 1] - off[l] !== ext) continue;      // component skipped
      hist[off[l] + (horiz ? ((i / W) | 0) : (i % W)) - p0s[l]]++;
    }
    const hb1 = Math.floor(T / 2 + 2), hb2 = Math.ceil(T / 2 + 2.5);
    const bandLo = new Int32Array(n + 1), bandHi = new Int32Array(n + 1).fill(-1);
    for (let l = 1; l <= n; l++) {
      const ext = p1s[l] - p0s[l] + 1;
      if (off[l + 1] - off[l] !== ext || ext <= 0) continue;
      let best = -1, bi = 0;
      for (let c0 = 0; c0 < ext; c0++) {
        let sum = 0;
        for (let q = Math.max(0, c0 - hb1); q <= Math.min(ext - 1, c0 + hb1); q++) sum += hist[off[l] + q];
        if (sum > best) { best = sum; bi = c0; }
      }
      bandLo[l] = p0s[l] + bi - hb2; bandHi[l] = p0s[l] + bi + hb2;
    }
    const st = new Float64Array((n + 1) * 7);       // n, sumP, sumA, sumAA, sumAP, minP, maxP
    const aMin = new Int32Array(n + 1).fill(1 << 30), aMax = new Int32Array(n + 1).fill(-1);
    for (let l = 1; l <= n; l++) { st[l * 7 + 5] = 1e9; st[l * 7 + 6] = -1e9; }
    for (let q = 0; q < nIdx; q++) {
      const i = idxList[q];
      const l = cc.lab[i];
      if (bandHi[l] < 0) continue;
      const y = (i / W) | 0, x = i - y * W;
      const pv = horiz ? y : x, av = horiz ? x : y;
      if (pv < bandLo[l] || pv > bandHi[l]) continue;
      const k = l * 7;
      st[k]++; st[k + 1] += pv; st[k + 2] += av; st[k + 3] += av * av; st[k + 4] += av * pv;
      if (pv < st[k + 5]) st[k + 5] = pv;
      if (pv > st[k + 6]) st[k + 6] = pv;
      if (av < aMin[l]) aMin[l] = av;
      if (av > aMax[l]) aMax[l] = av;
    }
    let bars = [];
    for (let l = 1; l <= n; l++) {
      const k = l * 7, cnt = st[k];
      if (cnt < 8) continue;
      const a0 = aMin[l], a1 = aMax[l], len = a1 - a0 + 1;
      if (len < Lrun) continue;
      if (cnt < 0.5 * T * len) continue;
      const den = cnt * st[k + 3] - st[k + 2] * st[k + 2];
      const slope = den > 1e-9 ? (cnt * st[k + 4] - st[k + 2] * st[k + 1]) / den : 0;
      if (Math.abs(slope) > 0.2) continue;
      bars.push({ a0, a1, p0: st[k + 5], p1: st[k + 6], n: cnt, sp: st[k + 1], c: st[k + 1] / cnt, labs: [l] });
    }
    // merge collinear pieces
    const gapMax = Math.max(6, 2 * T), cTol = 0.8 * T + 1.5;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < bars.length && !changed; i++) {
        for (let j = i + 1; j < bars.length; j++) {
          const A = bars[i], Bq = bars[j];
          if (Math.abs(A.c - Bq.c) > cTol) continue;
          if (A.a0 > Bq.a1 + gapMax || Bq.a0 > A.a1 + gapMax) continue;
          A.a0 = Math.min(A.a0, Bq.a0); A.a1 = Math.max(A.a1, Bq.a1);
          A.p0 = Math.min(A.p0, Bq.p0); A.p1 = Math.max(A.p1, Bq.p1);
          A.n += Bq.n; A.sp += Bq.sp; A.c = A.sp / A.n;
          A.labs = A.labs.concat(Bq.labs);
          bars.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
    bars = bars.filter(b => (b.a1 - b.a0 + 1) >= minBox && (b.p1 - b.p0 + 1) <= maxPerp + 2);
    bars.sort((p, q) => (q.a1 - q.a0) - (p.a1 - p.a0));
    if (bars.length > 100) bars.length = 100;
    return bars;
  }
  const hBars = collectBars(cH, true, mH);
  const vBars = collectBars(cV, false, mV);

  mark('bars');
  const bandHalf = Math.ceil(T / 2 + 3.5);
  function coverH(y, xa, xb) {      // fraction of columns with core ink within the band around row y
    const yi = Math.round(y), x0 = Math.round(xa), x1 = Math.round(xb);
    let hit = 0, tot = 0;
    for (let x = x0; x <= x1; x++) {
      tot++;
      if (x < 0 || x >= W) continue;
      let ok = false;
      for (let dy = -bandHalf; dy <= bandHalf; dy++) {
        const yy = yi + dy;
        if (yy >= 0 && yy < H && core[yy * W + x]) { ok = true; break; }
      }
      if (ok) hit++;
    }
    return tot ? hit / tot : 0;
  }
  function coverV(x, ya, yb) {
    const xi = Math.round(x), y0 = Math.round(ya), y1 = Math.round(yb);
    let hit = 0, tot = 0;
    for (let y = y0; y <= y1; y++) {
      tot++;
      if (y < 0 || y >= H) continue;
      let ok = false;
      for (let dx = -bandHalf; dx <= bandHalf; dx++) {
        const xx = xi + dx;
        if (xx >= 0 && xx < W && core[y * W + xx]) { ok = true; break; }
      }
      if (ok) hit++;
    }
    return tot ? hit / tot : 0;
  }
  const cornerR = Math.ceil(T / 2) + 3;
  function inkNearCore(x, y, rad) {
    const xi = Math.round(x), yi = Math.round(y);
    for (let dy = -rad; dy <= rad; dy++) {
      const yy = yi + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -rad; dx <= rad; dx++) {
        const xx = xi + dx;
        if (xx >= 0 && xx < W && core[yy * W + xx]) return true;
      }
    }
    return false;
  }

  let rects = [];
  {
    const tolIn = Math.max(4, T + 3), tolOut = Math.max(8, 2 * T + 4), half = T / 2;
    const minSpan = Math.max(4, minBox - T);
    for (let li = 0; li < vBars.length; li++) {
      const l = vBars[li];
      for (let ri = 0; ri < vBars.length; ri++) {
        if (ri === li) continue;
        const r = vBars[ri];
        if (r.c - l.c < minSpan) continue;
        const ya = Math.max(l.a0, r.a0), yb = Math.min(l.a1, r.a1);
        if (yb - ya + 1 < minSpan) continue;
        const cand = [];
        for (let k = 0; k < hBars.length; k++) {
          const h = hBars[k];
          if (h.a0 <= l.c + tolIn && h.a1 >= r.c - tolIn && h.c >= ya - tolOut && h.c <= yb + tolOut) cand.push(h);
        }
        if (cand.length < 2) continue;
        for (let ti = 0; ti < cand.length; ti++) {
          const t = cand[ti];
          for (let bi = 0; bi < cand.length; bi++) {
            const b = cand[bi];
            if (b.c - t.c < minSpan) continue;
            if (l.a0 > t.c + tolIn || r.a0 > t.c + tolIn || l.a1 < b.c - tolIn || r.a1 < b.c - tolIn) continue;
            let lc = 0;
            if (t.a0 >= l.c - half - tolOut && l.a0 >= t.c - half - tolOut) lc++;
            if (t.a1 <= r.c + half + tolOut && r.a0 >= t.c - half - tolOut) lc++;
            if (b.a0 >= l.c - half - tolOut && l.a1 <= b.c + half + tolOut) lc++;
            if (b.a1 <= r.c + half + tolOut && r.a1 <= b.c + half + tolOut) lc++;
            if (lc < 2) continue;
            const xl = l.c, xr = r.c, yt = t.c, yb2 = b.c;
            if (!inkNearCore(xl, yt, cornerR) || !inkNearCore(xr, yt, cornerR) ||
                !inkNearCore(xl, yb2, cornerR) || !inkNearCore(xr, yb2, cornerR)) continue;
            const c1 = coverH(yt, xl, xr), c2 = coverH(yb2, xl, xr), c3 = coverV(xl, yt, yb2), c4 = coverV(xr, yt, yb2);
            if (c1 < 0.9 || c2 < 0.9 || c3 < 0.9 || c4 < 0.9) continue;
            const ths = [t.n / (t.a1 - t.a0 + 1), b.n / (b.a1 - b.a0 + 1), l.n / (l.a1 - l.a0 + 1), r.n / (r.a1 - r.a0 + 1)].sort((p, q) => p - q);
            rects.push({ xl, xr, yt, yb: yb2, th: (ths[1] + ths[2]) / 2, labsH: t.labs.concat(b.labs), labsV: l.labs.concat(r.labs), cov: c1 + c2 + c3 + c4 });
            if (rects.length > 400) break;
          }
        }
      }
    }
    // de-duplicate (double stroked outlines etc.)
    rects.sort((p, q) => q.cov - p.cov);
    const dtol = T + 3;
    const uniq = [];
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      let dup = null;
      for (let j = 0; j < uniq.length; j++) {
        const u = uniq[j];
        if (Math.abs(a.xl - u.xl) <= dtol && Math.abs(a.xr - u.xr) <= dtol && Math.abs(a.yt - u.yt) <= dtol && Math.abs(a.yb - u.yb) <= dtol) { dup = u; break; }
      }
      if (dup) { dup.labsH = dup.labsH.concat(a.labsH); dup.labsV = dup.labsV.concat(a.labsV); }
      else uniq.push(a);
    }
    rects = uniq;
  }

  mark('rects');
  // subtract box outlines
  const rm = new Uint8Array(N);
  {
    const fH = new Uint8Array(cH.n + 1), fV = new Uint8Array(cV.n + 1);
    for (const r of rects) { for (const l of r.labsH) fH[l] = 1; for (const l of r.labsV) fV[l] = 1; }
    for (const r of rects) {
      const hw = r.th / 2 + 2, hwb = r.th / 2 + 4;
      const xa = Math.max(0, Math.floor(r.xl - hwb)), xb = Math.min(W - 1, Math.ceil(r.xr + hwb));
      const ya = Math.max(0, Math.floor(r.yt - hwb)), yb = Math.min(H - 1, Math.ceil(r.yb + hwb));
      for (let y = ya; y <= yb; y++) {
        const dTop = Math.abs(y - r.yt), dBot = Math.abs(y - r.yb);
        for (let x = xa; x <= xb; x++) {
          const dL = Math.abs(x - r.xl), dR = Math.abs(x - r.xr);
          const dmin = Math.min(
            (x >= r.xl - hwb && x <= r.xr + hwb) ? Math.min(dTop, dBot) : 1e9,
            (y >= r.yt - hwb && y <= r.yb + hwb) ? Math.min(dL, dR) : 1e9);
          if (dmin > hwb) continue;
          const i = y * W + x;
          if (dmin <= hw || (mH[i] && fH[cH.lab[i]]) || (mV[i] && fV[cV.lab[i]])) rm[i] = 1;
        }
      }
    }
  }
  let M = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (core[i] && !rm[i]) M[i] = 1;
  const tm2 = thickMap(M, W, H);
  for (let i = 0; i < N; i++) if (M[i] && tm2.t[i] < thrThick) M[i] = 0;
  {
    const cc = labelCC(M, W, H);
    const keep = new Uint8Array(cc.n + 1);
    // text-like clusters: several small components close together (words that survived the thickness filter)
    const glyphMax = 4 * T + 12, cell = 40;
    const grid = new Map();
    const smallIds = [];
    for (let k = 1; k <= cc.n; k++) {
      const md = Math.max(cc.x1[k] - cc.x0[k], cc.y1[k] - cc.y0[k]) + 1;
      if (md >= 6) keep[k] = 1;
      if (md <= glyphMax) {
        smallIds.push(k);
        const key = (((cc.x0[k] + cc.x1[k]) >> 1) / cell | 0) + ',' + ((((cc.y0[k] + cc.y1[k]) >> 1) / cell) | 0);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(k);
      }
    }
    if (smallIds.length >= 3) {
      for (const k of smallIds) {
        if (!keep[k]) continue;
        const cx = (cc.x0[k] + cc.x1[k]) / 2, cy = (cc.y0[k] + cc.y1[k]) / 2;
        const gx = (cx / cell) | 0, gy = (cy / cell) | 0;
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const lst = grid.get((gx + dx) + ',' + (gy + dy));
          if (!lst) continue;
          for (const o of lst) {
            if (o === k) continue;
            if (Math.hypot((cc.x0[o] + cc.x1[o]) / 2 - cx, (cc.y0[o] + cc.y1[o]) / 2 - cy) <= 30) near++;
          }
        }
        if (near >= 2) keep[k] = 2;       // mark; applied after the scan so neighbours still count each other
      }
      for (let k = 1; k <= cc.n; k++) if (keep[k] === 2) keep[k] = 0;
    }
    for (let i = 0; i < N; i++) if (M[i] && !keep[cc.lab[i]]) M[i] = 0;
  }

  const outLines = [];     // internal line records
  const outBlobs = [];
  const outEllipses = [];

  mark('leftover');
  /* ---------- 4. skeleton graph of the leftover ---------- */
  const OFF = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];   // N NE E SE S SW W NW
  // filled arrow heads: blobs that are fatter than the pen (a square of ~T+1 fits in them but not in a stroke,
  // a crossing or a corner).  They are cut out before skeletonising (they would bend the skeleton)
  // and remembered; a head must hang on exactly one stroke.
  const heads = [];
  {
    const r = Math.max(1, Math.ceil(T / 2));
    const dt = chamferDT(M, W, H);
    const seedThr = Math.round((0.75 * T + 0.3) * 3);
    const er = new Uint8Array(N);
    let nGood = 0;
    for (let i = 0; i < N; i++) if (dt[i] >= seedThr) { er[i] = 1; nGood++; }
    if (nGood >= 2) {
      const D = windowFilter(er, W, H, r + 3, 1);
      const cc = labelCC(D, W, H);
      const maxHead = 6 * T + 14;
      const cand = new Int32Array(cc.n + 1).fill(-1);
      const list = [];
      for (let k = 1; k <= cc.n && list.length < 300; k++) {
        const bw = cc.x1[k] - cc.x0[k] + 1, bh2 = cc.y1[k] - cc.y0[k] + 1;
        if (Math.max(bw, bh2) <= maxHead) { cand[k] = list.length; list.push({ xs: [], ys: [], ring: [], x0: cc.x0[k], y0: cc.y0[k], x1: cc.x1[k], y1: cc.y1[k] }); }
      }
      for (let i = 0; i < N; i++) {
        const l = cc.lab[i];
        if (!l) {
          if (!M[i]) continue;
          // M pixel outside D: ring pixel of an adjacent head?
          for (let k8 = 0; k8 < 8; k8++) {
            const l2 = cc.lab[i + OFF[k8]];
            if (l2 && cand[l2] >= 0) { list[cand[l2]].ring.push(i); break; }
          }
          continue;
        }
        const k = cand[l];
        if (k < 0 || !M[i]) continue;
        list[k].xs.push(i % W); list[k].ys.push((i / W) | 0);
      }
      for (const h of list) {
        // count contact patches: 8-connected groups of ring pixels that lead into a substantial stroke
        const seen = new Set(), ringSet = new Set(h.ring);
        const inHead = new Set();
        for (let k = 0; k < h.xs.length; k++) inHead.add(h.ys[k] * W + h.xs[k]);
        let patches = 0;
        for (const p0 of h.ring) {
          if (seen.has(p0)) continue;
          const st = [p0], grown = new Set([p0]);
          seen.add(p0);
          while (st.length) {
            const q = st.pop();
            for (let k8 = 0; k8 < 8; k8++) { const q2 = q + OFF[k8]; if (ringSet.has(q2) && !seen.has(q2)) { seen.add(q2); st.push(q2); } }
          }
          // size of the stroke piece behind this patch (outside the head), capped
          const q2s = [p0];
          let sz = 0;
          const vis2 = new Set([p0]);
          while (q2s.length && sz < 40) {
            const q = q2s.pop(); sz++;
            for (let k8 = 0; k8 < 8; k8++) { const n2 = q + OFF[k8]; if (M[n2] && !inHead.has(n2) && !vis2.has(n2)) { vis2.add(n2); q2s.push(n2); } }
          }
          void grown;
          if (sz >= 40) patches++;
        }
        if (patches > 1 || h.xs.length < 12) continue;
        for (let k = 0; k < h.xs.length; k++) M[h.ys[k] * W + h.xs[k]] = 0;
        h.ring = null;
        heads.push(h);
      }
      if (heads.length) {            // drop the little fragments the head cut left behind
        const cc2 = labelCC(M, W, H);
        const keep2 = new Uint8Array(cc2.n + 1);
        const pad = 2 * T + 4;
        for (let k = 1; k <= cc2.n; k++) {
          const md = Math.max(cc2.x1[k] - cc2.x0[k], cc2.y1[k] - cc2.y0[k]) + 1;
          if (md < 6) continue;
          let inside = false;
          if (md <= 3 * T + 8) {
            for (const h of heads) {
              if (cc2.x0[k] >= h.x0 - pad && cc2.x1[k] <= h.x1 + pad && cc2.y0[k] >= h.y0 - pad && cc2.y1[k] <= h.y1 + pad) { inside = true; break; }
            }
          }
          if (!inside) keep2[k] = 1;
        }
        for (let i = 0; i < N; i++) if (M[i] && !keep2[cc2.lab[i]]) M[i] = 0;
      }
    }
  }
  const skel = skeletonize(M, W, H);
  mark('skel');
  const typ = new Uint8Array(N);
  const nodeOf = new Int32Array(N).fill(-1);
  const nodes = [];     // {x,y,type: 0 end | 1 junction, pix}
  const skPix = [];
  for (let i = 0; i < N; i++) if (skel[i]) skPix.push(i);
  if (skPix.length > 400000) return finish();   // pathological (noise) input
  function nbCross(p) {
    const n0 = skel[p - W], n1 = skel[p - W + 1], n2 = skel[p + 1], n3 = skel[p + W + 1], n4 = skel[p + W], n5 = skel[p + W - 1], n6 = skel[p - 1], n7 = skel[p - W - 1];
    const cnt = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7;
    const a = ((!n0 && n1) ? 1 : 0) + ((!n1 && n2) ? 1 : 0) + ((!n2 && n3) ? 1 : 0) + ((!n3 && n4) ? 1 : 0) +
              ((!n4 && n5) ? 1 : 0) + ((!n5 && n6) ? 1 : 0) + ((!n6 && n7) ? 1 : 0) + ((!n7 && n0) ? 1 : 0);
    return cnt === 0 ? -1 : a;
  }
  for (const p of skPix) {
    const a = nbCross(p);
    if (a < 0) continue;
    typ[p] = a === 1 ? 1 : (a === 2 ? 2 : (a >= 3 ? 3 : 2));
  }
  // junction clusters
  for (const p of skPix) {
    if (typ[p] !== 3 || nodeOf[p] >= 0) continue;
    const id = nodes.length;
    const pix = [p];
    nodeOf[p] = id;
    let sx = 0, sy = 0;
    for (let h = 0; h < pix.length; h++) {
      const q = pix[h];
      sx += q % W; sy += (q / W) | 0;
      for (let k = 0; k < 8; k++) {
        const q2 = q + OFF[k];
        if (skel[q2] && typ[q2] === 3 && nodeOf[q2] < 0) { nodeOf[q2] = id; pix.push(q2); }
      }
    }
    nodes.push({ x: sx / pix.length, y: sy / pix.length, type: 1, pix });
  }
  for (const p of skPix) {
    if (typ[p] === 1) { nodeOf[p] = nodes.length; nodes.push({ x: p % W, y: (p / W) | 0, type: 0, pix: [p] }); }
  }
  const vis = new Uint8Array(N);
  const branches = [];
  function walk(start, startNode, prefixNode) {
    const px = [], xs = [], ys = [];
    if (prefixNode >= 0) { xs.push(nodes[prefixNode].x); ys.push(nodes[prefixNode].y); }
    let cur = start, endNode = -1, steps = 0;
    for (;;) {
      vis[cur] = 1; px.push(cur); xs.push(cur % W); ys.push((cur / W) | 0); steps++;
      let jn = -1, cand = -1, candDiag = true;
      for (let k = 0; k < 8; k++) {
        const q = cur + OFF[k];
        if (!skel[q]) continue;
        if (typ[q] === 3) {
          const nid = nodeOf[q];
          if (nid === startNode && steps < 3) continue;
          if (jn < 0) jn = nid;
          continue;
        }
        if (vis[q]) continue;
        const diag = (k & 1) === 1;
        if (cand < 0 || (!diag && candDiag)) { cand = q; candDiag = diag; }
      }
      if (jn >= 0) { endNode = jn; xs.push(nodes[jn].x); ys.push(nodes[jn].y); break; }
      if (cand < 0) {
        if (typ[cur] === 1 && nodeOf[cur] !== startNode) endNode = nodeOf[cur];
        else if (typ[cur] === 1 && px.length > 1) endNode = nodeOf[cur];
        else { endNode = nodes.length; nodes.push({ x: cur % W, y: (cur / W) | 0, type: 0, pix: [cur] }); }
        break;
      }
      cur = cand;
    }
    return { px, xs, ys, endNode };
  }
  function addBranch(a, b, w, closed) {
    let L = 0;
    for (let i = 1; i < w.xs.length; i++) L += Math.hypot(w.xs[i] - w.xs[i - 1], w.ys[i] - w.ys[i - 1]);
    branches.push({ a, b, px: w.px, xs: w.xs, ys: w.ys, len: L, alive: true, closed: !!closed });
  }
  const nJ = nodes.length;
  for (let n = 0; n < nodes.length; n++) {
    const nd = nodes[n];
    if (nd.type !== 1) continue;
    for (const q of nd.pix) {
      for (let k = 0; k < 8; k++) {
        const r = q + OFF[k];
        if (!skel[r] || typ[r] === 3 || vis[r]) continue;
        const w = walk(r, n, n);
        addBranch(n, w.endNode, w, false);
      }
    }
  }
  void nJ;
  for (let n = 0; n < nodes.length; n++) {
    const nd = nodes[n];
    if (nd.type !== 0) continue;
    const p = nd.pix[0];
    if (vis[p]) continue;
    const w = walk(p, n, -1);
    addBranch(n, w.endNode, w, false);
  }
  for (const p of skPix) {
    if (typ[p] !== 2 || vis[p]) continue;
    const w = walk(p, -1, -1);
    if (w.px.length < 8) continue;
    const last = w.px[w.px.length - 1];
    let adj = false;
    for (let k = 0; k < 8; k++) if (last + OFF[k] === p) adj = true;
    if (adj && w.px.length >= 8) {
      // pure loop
      branches.push({ a: -1, b: -1, px: w.px, xs: w.xs, ys: w.ys, len: pathLength(w.xs, w.ys), alive: true, closed: true });
    } else {
      // open piece without nodes (should be rare); give it end nodes
      const na = nodes.length; nodes.push({ x: w.xs[0], y: w.ys[0], type: 0, pix: [] });
      const nb = nodes.length; nodes.push({ x: w.xs[w.xs.length - 1], y: w.ys[w.ys.length - 1], type: 0, pix: [] });
      branches.push({ a: na, b: nb, px: w.px, xs: w.xs, ys: w.ys, len: pathLength(w.xs, w.ys), alive: true, closed: false });
    }
  }
  if (branches.length > 60000) return finish();

  mark('graph');
  const dd = Math.max(6, 1.5 * T + 2);
  function endDir(b, end) {
    const n = b.xs.length;
    let i = end === 0 ? 0 : n - 1;
    const step = end === 0 ? 1 : -1;
    const x0 = b.xs[i], y0 = b.ys[i];
    let acc2 = 0, px = x0, py = y0;
    let j = i;
    while (j + step >= 0 && j + step < n) {
      j += step;
      acc2 += Math.hypot(b.xs[j] - px, b.ys[j] - py);
      px = b.xs[j]; py = b.ys[j];
      if (acc2 >= dd) break;
    }
    const dx = px - x0, dy = py - y0, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  // contract short links between two junction clusters (a crossing of two strokes yields two nearby junctions)
  {
    const rep = nodes.map((_, i) => i);
    const find = (a) => { while (rep[a] !== a) { rep[a] = rep[rep[a]]; a = rep[a]; } return a; };
    const linkMax = 0;
    for (const b of branches) {
      if (!b.alive || b.closed || b.a < 0 || b.b < 0 || b.a === b.b) continue;
      if (nodes[b.a].type !== 1 || nodes[b.b].type !== 1 || b.len > linkMax) continue;
      const ra = find(b.a), rb = find(b.b);
      if (ra !== rb) { rep[rb] = ra; }
      b.alive = false;
    }
    const cnt = new Map();
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].type !== 1) continue;
      const r = find(i);
      if (!cnt.has(r)) cnt.set(r, [0, 0, 0]);
      const c = cnt.get(r); c[0] += nodes[i].x; c[1] += nodes[i].y; c[2]++;
    }
    for (const b of branches) {
      if (!b.alive) continue;
      if (b.a >= 0 && nodes[b.a].type === 1) { const r = find(b.a); if (r !== b.a) { b.a = r; } const c = cnt.get(r); b.xs[0] = c[0] / c[2]; b.ys[0] = c[1] / c[2]; }
      if (b.b >= 0 && nodes[b.b].type === 1) { const r = find(b.b); if (r !== b.b) { b.b = r; } const c = cnt.get(r); b.xs[b.xs.length - 1] = c[0] / c[2]; b.ys[b.ys.length - 1] = c[1] / c[2]; }
    }
    cnt.forEach((c, r) => { nodes[r].x = c[0] / c[2]; nodes[r].y = c[1] / c[2]; });
  }

  // spur pruning
  const spurLen = Math.max(12, 4.2 * T + 2);
  for (let iter = 0; iter < 4; iter++) {
    const deg = new Int32Array(nodes.length);
    for (const b of branches) { if (!b.alive) continue; if (b.a >= 0) deg[b.a]++; if (b.b >= 0) deg[b.b]++; }
    let changed = false;
    // open arrow heads ("V"): a junction with two similar short leaf branches (the barbs) whose bisector
    // runs along a third branch (the shaft)
    {
      const leaves = new Map(), allAt = new Map();
      for (let bi = 0; bi < branches.length; bi++) {
        const b = branches[bi];
        if (!b.alive || b.closed || b.a < 0 || b.b < 0 || b.a === b.b) continue;
        for (let e = 0; e < 2; e++) {
          const j = e === 0 ? b.a : b.b, o = e === 0 ? b.b : b.a;
          if (nodes[j].type !== 1) continue;
          if (!allAt.has(j)) allAt.set(j, []);
          allAt.get(j).push([bi, e]);
          if (nodes[o].type === 0 && deg[o] === 1 && b.len <= 8 * T) {
            if (!leaves.has(j)) leaves.set(j, []);
            leaves.get(j).push([bi, e]);
          }
        }
      }
      leaves.forEach((lv, j) => {
        if (lv.length < 2 || deg[j] < 3 || nodes[j].vhead) return;
        let bestPair = null, bestScore = 1e9;
        for (let x = 0; x < lv.length; x++) for (let y = x + 1; y < lv.length; y++) {
          const A = branches[lv[x][0]], Bq = branches[lv[y][0]];
          const ratio = Math.min(A.len, Bq.len) / Math.max(A.len, Bq.len);
          if (ratio < 0.5) continue;
          const da = endDir(A, lv[x][1]), db = endDir(Bq, lv[y][1]);
          const dotab = da[0] * db[0] + da[1] * db[1];
          const spread = Math.acos(Math.max(-1, Math.min(1, dotab))) * 180 / Math.PI;
          if (spread < 10 || spread > 100) continue;
          let bx = da[0] + db[0], by = da[1] + db[1];
          const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
          // some other branch must run along the bisector
          let ok = false;
          for (const [bj, e2] of allAt.get(j)) {
            if (bj === lv[x][0] || bj === lv[y][0]) continue;
            const o2 = endDir(branches[bj], e2);
            if (o2[0] * bx + o2[1] * by >= 0.75) { ok = true; break; }
          }
          if (!ok) continue;
          if (Math.abs(spread - 50) < bestScore) { bestScore = Math.abs(spread - 50); bestPair = [lv[x][0], lv[y][0]]; }
        }
        if (bestPair) {
          branches[bestPair[0]].alive = false; branches[bestPair[1]].alive = false;
          deg[j] -= 2; nodes[j].vhead = true; changed = true;
        }
      });
    }
    const byNode = new Map();
    for (let bi = 0; bi < branches.length; bi++) {
      const b = branches[bi];
      if (!b.alive || b.closed || b.a < 0 || b.b < 0 || b.a === b.b) continue;
      if (b.len >= spurLen) continue;
      let j = -1;
      if (nodes[b.a].type === 0 && deg[b.a] === 1 && nodes[b.b].type === 1) j = b.b;
      else if (nodes[b.b].type === 0 && deg[b.b] === 1 && nodes[b.a].type === 1) j = b.a;
      if (j < 0) continue;
      if (!byNode.has(j)) byNode.set(j, []);
      byNode.get(j).push(bi);
    }
    byNode.forEach((list, j) => {
      list.sort((p, q) => branches[p].len - branches[q].len);
      const keepLong = deg[j] - list.length >= 1;     // some non-spur branch remains: drop all spurs
      for (const bi of list) {
        if (!keepLong && deg[j] <= 2) break;
        branches[bi].alive = false; deg[j]--; changed = true;
      }
    });
    if (!changed) break;
  }
  {
    const deg = new Int32Array(nodes.length);
    for (const b of branches) { if (!b.alive) continue; if (b.a >= 0) deg[b.a]++; if (b.b >= 0) deg[b.b]++; }
    for (let n = 0; n < nodes.length; n++) if (nodes[n].type === 1 && deg[n] <= 1) nodes[n].type = 0;
  }

  // pair branches at junctions by tangent continuity
  const nB = branches.length;
  const links = new Int32Array(nB * 2).fill(-1);
  {
    const inc = new Map();
    for (let bi = 0; bi < nB; bi++) {
      const b = branches[bi];
      if (!b.alive || b.closed) continue;
      if (b.a >= 0 && nodes[b.a].type === 1) { if (!inc.has(b.a)) inc.set(b.a, []); inc.get(b.a).push(bi * 2); }
      if (b.b >= 0 && nodes[b.b].type === 1) { if (!inc.has(b.b)) inc.set(b.b, []); inc.get(b.b).push(bi * 2 + 1); }
    }
    inc.forEach((ends) => {
      if (ends.length < 2) return;
      const dirs = ends.map(k => endDir(branches[k >> 1], k & 1));
      const pairs = [];
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        pairs.push({ i, j, dot: dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] });
      }
      pairs.sort((p, q) => p.dot - q.dot);
      const used = new Uint8Array(ends.length);
      const always = ends.length === 2;
      for (const p of pairs) {
        if (used[p.i] || used[p.j]) continue;
        if (!always && p.dot > -0.34) continue;      // need >= ~110 degrees between tangents
        used[p.i] = used[p.j] = 1;
        links[ends[p.i]] = ends[p.j];
        links[ends[p.j]] = ends[p.i];
      }
    });
  }

  // assemble chains
  const chains = [];
  {
    const seen = new Uint8Array(nB);
    for (let bi = 0; bi < nB; bi++) {
      const b0 = branches[bi];
      if (!b0.alive || seen[bi]) continue;
      seen[bi] = 1;
      if (b0.closed) { chains.push({ items: [{ b: bi, rev: false }], closed: true }); continue; }
      let items = [{ b: bi, rev: false }];
      let key = bi * 2 + 1, closed = false;
      for (;;) {
        const nk = links[key];
        if (nk < 0) break;
        const nb2 = nk >> 1;
        if (nb2 === bi && (nk & 1) === 0) { closed = true; break; }
        if (seen[nb2]) break;
        seen[nb2] = 1;
        const entry = nk & 1, rev = entry === 1;
        items.push({ b: nb2, rev });
        key = nb2 * 2 + (rev ? 0 : 1);
      }
      if (!closed) {
        key = bi * 2;
        const back = [];
        for (;;) {
          const nk = links[key];
          if (nk < 0) break;
          const nb2 = nk >> 1;
          if (seen[nb2]) break;
          seen[nb2] = 1;
          const exitEnd = nk & 1;
          back.push({ b: nb2, rev: exitEnd === 0 });
          key = nb2 * 2 + (exitEnd === 0 ? 1 : 0);
        }
        back.reverse();
        items = back.concat(items);
      }
      chains.push({ items, closed });
    }
  }
  for (const ch of chains) {
    const xs = [], ys = [];
    for (const it of ch.items) {
      const b = branches[it.b];
      const n = b.xs.length;
      for (let k = 0; k < n; k++) {
        const idx = it.rev ? n - 1 - k : k;
        const x = b.xs[idx], y = b.ys[idx];
        if (xs.length && Math.abs(xs[xs.length - 1] - x) < 0.5 && Math.abs(ys[ys.length - 1] - y) < 0.5) continue;
        xs.push(x); ys.push(y);
      }
    }
    ch.xs = xs; ch.ys = ys;
    const f = ch.items[0], l = ch.items[ch.items.length - 1];
    const fb = branches[f.b], lb = branches[l.b];
    ch.nodeA = f.rev ? fb.b : fb.a;
    ch.nodeB = l.rev ? lb.a : lb.b;
    if (!ch.closed && ch.nodeA >= 0 && ch.nodeA === ch.nodeB && nodes[ch.nodeA].type === 1 && xs.length > 8) ch.closed = true;
    ch.vA = ch.nodeA >= 0 && !!nodes[ch.nodeA].vhead; ch.vB = ch.nodeB >= 0 && !!nodes[ch.nodeB].vhead;
    ch.typeA = ch.nodeA >= 0 ? nodes[ch.nodeA].type : 2;    // 0 free end, 1 junction, 2 none
    ch.typeB = ch.nodeB >= 0 ? nodes[ch.nodeB].type : 2;
    ch.len = pathLength(xs, ys);
  }

  mark('chains');
  // ownership of leftover pixels: nearest chain skeleton (geodesic chessboard BFS)
  const own = new Int32Array(N);
  {
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let ci = 0; ci < chains.length; ci++) {
      for (const it of chains[ci].items) for (const p of branches[it.b].px) { own[p] = ci + 1; queue[qt++] = p; }
    }
    while (qh < qt) {
      const p = queue[qh++], o = own[p];
      for (let k = 0; k < 8; k++) { const q = p + OFF[k]; if (M[q] && !own[q]) { own[q] = o; queue[qt++] = q; } }
    }
  }
  // per-chain stats: colour (dark pixels), thickness histogram, area
  const nCh = chains.length;
  const cAcc = new Float64Array((nCh + 1) * 8);
  const cThH = new Uint32Array((nCh + 1) * 16);
  const cArea = new Int32Array(nCh + 1);
  {
    const rgb = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const o = own[i];
      if (!o) continue;
      cArea[o]++;
      const t = tm2.t[i]; cThH[o * 16 + (t > 15 ? 15 : t)]++;
      rgbAt(i, rgb);
      const k = o * 8;
      cAcc[k] += rgb[0]; cAcc[k + 1] += rgb[1]; cAcc[k + 2] += rgb[2]; cAcc[k + 3]++;
      if (cN[i] <= darkCut) { cAcc[k + 4] += rgb[0]; cAcc[k + 5] += rgb[1]; cAcc[k + 6] += rgb[2]; cAcc[k + 7]++; }
    }
  }
  function chainColor(o) {
    const k = o * 8;
    if (cAcc[k + 7] >= 5) return toHex(cAcc[k + 4] / cAcc[k + 7], cAcc[k + 5] / cAcc[k + 7], cAcc[k + 6] / cAcc[k + 7]);
    if (cAcc[k + 3] > 0) return toHex(cAcc[k] / cAcc[k + 3], cAcc[k + 1] / cAcc[k + 3], cAcc[k + 2] / cAcc[k + 3]);
    return '#000000';
  }
  function chainThickMedian(o) {
    let n = 0;
    for (let k = 0; k < 16; k++) n += cThH[o * 16 + k];
    let s = 0;
    for (let k = 0; k < 16; k++) { s += cThH[o * 16 + k]; if (s * 2 >= n) return k; }
    return T;
  }

  mark('own');
  /* ---------- 5. classify chains ---------- */
  const eps = Math.max(4, T);
  const epsBlob = Math.max(1.6, 0.4 * T);
  const segMin = Math.max(10, 2.5 * T);

  function inkNearM(x, y, ux, uy) {
    const nx = -uy, ny = ux;
    for (let o = -1; o <= 1; o++) {
      const xx = Math.round(x + nx * o), yy = Math.round(y + ny * o);
      if (xx > 0 && xx < W - 1 && yy > 0 && yy < H - 1 && M[yy * W + xx]) return true;
    }
    return false;
  }

  function nearRing(x, y) {
    for (const r of rects) {
      const m = r.th / 2 + 5;
      if (x < r.xl - m || x > r.xr + m || y < r.yt - m || y > r.yb + m) continue;
      const dx = Math.min(Math.abs(x - r.xl), Math.abs(x - r.xr)), dy = Math.min(Math.abs(y - r.yt), Math.abs(y - r.yb));
      if ((dx <= m && y >= r.yt - m && y <= r.yb + m) || (dy <= m && x >= r.xl - m && x <= r.xr + m)) return true;
    }
    return false;
  }
  function headAt(ex, ey, ux, uy, segLen, id) {
    const Lw = Math.min(Math.max(5 * T, 16), 0.8 * segLen);
    if (Lw < 6) return false;
    const nx = -uy, ny = ux, sMin = -3, tMax = 4 * T;
    const R = Math.ceil(Lw + tMax + 4);
    const xa = Math.max(1, Math.floor(ex - R)), xb = Math.min(W - 2, Math.ceil(ex + R));
    const ya = Math.max(1, Math.floor(ey - R)), yb = Math.min(H - 2, Math.ceil(ey + R));
    let cntP = 0, cntN = 0, maxT = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (own[y * W + x] !== id) continue;
        if (nearRing(x, y)) continue;
        const dx = x - ex, dy = y - ey;
        const s = dx * ux + dy * uy, t = dx * nx + dy * ny;
        if (s < sMin || s > Lw || Math.abs(t) > tMax) continue;
        if (t >= 0) cntP++; else cntN++;
        const at = Math.abs(t);
        if (at > maxT) maxT = at;
      }
    }
    const half = T * (Lw - sMin) / 2;
    const exP = cntP - half, exN = cntN - half;
    return (exP + exN >= 1.3 * T * T) && Math.min(exP, exN) >= 0.35 * T * T && maxT >= 1.1 * T + 1;
  }

  // a filled head next to the line end (ux,uy = outward unit vector): returns the tip point
  function fatHead(px, py, ux, uy) {
    let best = null, bd = 1e9;
    const reach = 1.5 * T + 3;
    for (const h of heads) {
      if (px < h.x0 - reach || px > h.x1 + reach || py < h.y0 - reach || py > h.y1 + reach) continue;
      let d = 1e9;
      for (let k = 0; k < h.xs.length; k++) { const dd = Math.hypot(h.xs[k] - px, h.ys[k] - py); if (dd < d) d = dd; }
      if (d < bd) { bd = d; best = h; }
    }
    if (!best || bd > reach) return null;
    const nx = -uy, ny = ux;
    let smax = 0;
    for (let k = 0; k < best.xs.length; k++) {
      const dx = best.xs[k] - px, dy = best.ys[k] - py;
      if (Math.abs(dx * nx + dy * ny) > 1.3 * T) continue;
      const sdist = dx * ux + dy * uy;
      if (sdist > smax) smax = sdist;
    }
    return [px + ux * smax, py + uy * smax];
  }

  function buildLines(ch, ci, ranges) {
    const xs = ch.xs, ys = ch.ys;
    const segs = [];
    const snap = 4 * Math.PI / 180;
    for (let k = 0; k < ranges.length; k++) {
      const i = ranges[k][0], j = ranges[k][1];
      const f = fitLine(xs, ys, i, Math.max(j, i + 1));
      let ang = f.ang;
      // direction along travel
      const tdx = xs[j] - xs[i], tdy = ys[j] - ys[i];
      let dx = Math.cos(ang), dy = Math.sin(ang);
      if (dx * tdx + dy * tdy < 0) { dx = -dx; dy = -dy; }
      let kind = 'free';
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.asin(Math.min(1, ay)) <= snap) { kind = 'H'; dx = dx >= 0 ? 1 : -1; dy = 0; }
      else if (Math.asin(Math.min(1, ax)) <= snap) { kind = 'V'; dy = dy >= 0 ? 1 : -1; dx = 0; }
      let px = f.mx, py = f.my;
      segs.push({ px, py, dx, dy, kind });
    }
    function proj(s, x, y) {
      const t = (x - s.px) * s.dx + (y - s.py) * s.dy;
      return [s.px + s.dx * t, s.py + s.dy * t];
    }
    const pts = [];
    pts.push(proj(segs[0], xs[ranges[0][0]], ys[ranges[0][0]]));
    for (let k = 1; k < segs.length; k++) {
      const a = segs[k - 1], b = segs[k];
      const cr = a.dx * b.dy - a.dy * b.dx;
      let pt;
      const vx = (xs[ranges[k - 1][1]] + xs[ranges[k][0]]) / 2, vy = (ys[ranges[k - 1][1]] + ys[ranges[k][0]]) / 2;
      if (Math.abs(cr) > 0.3) {
        const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cr;
        pt = [a.px + a.dx * t, a.py + a.dy * t];
        if (Math.hypot(pt[0] - vx, pt[1] - vy) > 3.5 * T + 8) pt = [vx, vy];
      } else pt = [vx, vy];
      pts.push(pt);
    }
    pts.push(proj(segs[segs.length - 1], xs[ranges[ranges.length - 1][1]], ys[ranges[ranges.length - 1][1]]));
    // extend free ends along the ink
    const extMax = 4 * T + 4;
    function extend(pi, pj, free) {
      if (!free) return;
      let ux = pts[pi][0] - pts[pj][0], uy = pts[pi][1] - pts[pj][1];
      const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
      let last = 0, miss = 0;
      for (let s = 1; s <= extMax; s++) {
        if (inkNearM(pts[pi][0] + ux * s, pts[pi][1] + uy * s, ux, uy)) { last = s; miss = 0; }
        else if (++miss >= 2) break;
      }
      pts[pi][0] += ux * last; pts[pi][1] += uy * last;
    }
    extend(0, 1, ch.typeA === 0);
    extend(pts.length - 1, pts.length - 2, ch.typeB === 0);
    // heads at the two outer ends
    const id = ci + 1;
    const first = pts[0], second = pts[1], last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const l0 = Math.hypot(second[0] - first[0], second[1] - first[1]) || 1;
    const l1 = Math.hypot(prev[0] - last[0], prev[1] - last[1]) || 1;
    let headA = false, headB = false;
    if (heads.length) {
      const fa = fatHead(first[0], first[1], (first[0] - second[0]) / l0, (first[1] - second[1]) / l0);
      if (fa) { first[0] = fa[0]; first[1] = fa[1]; headA = true; }
      const fb = fatHead(last[0], last[1], (last[0] - prev[0]) / l1, (last[1] - prev[1]) / l1);
      if (fb) { last[0] = fb[0]; last[1] = fb[1]; headB = true; }
    }
    if (ch.vA) headA = true;
    if (ch.vB) headB = true;
    if (!headA) headA = headAt(first[0], first[1], (second[0] - first[0]) / l0, (second[1] - first[1]) / l0, l0, id);
    if (!headB) headB = headAt(last[0], last[1], (prev[0] - last[0]) / l1, (prev[1] - last[1]) / l1, l1, id);
    const th0 = chainThickMedian(id);
    const color = chainColor(id);
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const f = Math.max(Math.abs(s.dx), Math.abs(s.dy));
      const rec = {
        x1: pts[k][0], y1: pts[k][1], x2: pts[k + 1][0], y2: pts[k + 1][1],
        th: Math.max(1, th0 * f), color, ha: k === 0 && headA, hb: k === segs.length - 1 && headB,
        freeA: k === 0 ? ch.typeA === 0 : false, freeB: k === segs.length - 1 ? ch.typeB === 0 : false, chain: ci
      };
      outLines.push(rec);
    }
  }

  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const xs = ch.xs, ys = ch.ys, n = xs.length;
    if (n < 2) continue;
    if (!ch.closed) {
      const minLen = 5;
      if (ch.len < minLen) continue;
      // straight? (max deviation from the total-least-squares line)
      const fl = fitLine(xs, ys, 0, n - 1);
      const fdx = Math.cos(fl.ang), fdy = Math.sin(fl.ang);
      let dev = 0;
      for (let k = 0; k < n; k++) { const d = Math.abs((xs[k] - fl.mx) * fdy - (ys[k] - fl.my) * fdx); if (d > dev) dev = d; }
      const cl = Math.hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0]);
      if (dev <= eps && cl > 0) { buildLines(ch, ci, [[0, n - 1]]); continue; }
      // orthogonal / polyline connector?  legs between Douglas-Peucker vertices; tiny corner cuts are dropped
      const idx = dpIdx(xs, ys, 0, n - 1, eps);
      let ranges = [];
      for (let k = 0; k + 1 < idx.length; k++) ranges.push([idx[k], idx[k + 1], Math.hypot(xs[idx[k + 1]] - xs[idx[k]], ys[idx[k + 1]] - ys[idx[k]])]);
      const chamferMax = Math.max(12, 3.5 * T);
      for (let again = true; again;) {
        again = false;
        for (let k = 1; k + 1 < ranges.length; k++) {
          if (ranges[k][2] < chamferMax && ranges[k - 1][2] >= segMin && ranges[k + 1][2] >= segMin) { ranges.splice(k, 1); again = true; break; }
        }
      }
      let elbow = ranges.length >= 2 && ranges.length <= 6;
      for (let k = 0; k < ranges.length && elbow; k++) if (ranges[k][2] < segMin) elbow = false;
      for (let k = 1; k < ranges.length && elbow; k++) {
        const a0 = Math.atan2(ys[ranges[k - 1][1]] - ys[ranges[k - 1][0]], xs[ranges[k - 1][1]] - xs[ranges[k - 1][0]]);
        const a1 = Math.atan2(ys[ranges[k][1]] - ys[ranges[k][0]], xs[ranges[k][1]] - xs[ranges[k][0]]);
        let d = Math.abs(a1 - a0); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < 55 * Math.PI / 180) elbow = false;
      }
      if (elbow) { buildLines(ch, ci, ranges); continue; }
      // curvy open stroke -> blob
      emitBlob(ch, ci, false);
    } else {
      emitClosed(ch, ci);
    }
  }

  function emitBlob(ch, ci, closed) {
    const xs = ch.xs, ys = ch.ys, n = xs.length;
    let pts = [];
    if (closed) {
      // closed DP: split at the point farthest from the start
      let far = 0, fd = -1;
      for (let k = 1; k < n; k++) { const d = Math.hypot(xs[k] - xs[0], ys[k] - ys[0]); if (d > fd) { fd = d; far = k; } }
      const xe = xs.slice(), ye = ys.slice();
      xe.push(xs[0]); ye.push(ys[0]);
      const a = dpIdx(xe, ye, 0, far, epsBlob), b = dpIdx(xe, ye, far, n, epsBlob);
      const idx = a.concat(b.slice(1));
      idx.pop();               // drop the duplicate of the start
      for (const k of idx) pts.push([xs[k], ys[k]]);
      if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1.5) pts.pop();
    } else {
      const idx = dpIdx(xs, ys, 0, n - 1, epsBlob);
      for (const k of idx) pts.push([xs[k], ys[k]]);
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (Math.max(x1 - x0, y1 - y0) < Math.max(minBox, 3 * T)) return;
    const id = ci + 1;
    const th = Math.max(1, cArea[id] / Math.max(1, ch.len));
    outBlobs.push({ pts, x0, y0, x1, y1, th, color: chainColor(id), closed });
  }

  function emitClosed(ch, ci) {
    const xs = ch.xs, ys = ch.ys, n = xs.length;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < n; k++) { if (xs[k] < x0) x0 = xs[k]; if (xs[k] > x1) x1 = xs[k]; if (ys[k] < y0) y0 = ys[k]; if (ys[k] > y1) y1 = ys[k]; }
    const a = (x1 - x0) / 2, b = (y1 - y0) / 2;
    if (Math.max(x1 - x0, y1 - y0) < Math.max(minBox, 3 * T)) return;
    const id = ci + 1;
    const th = Math.max(1, cArea[id] / Math.max(1, ch.len));
    if (a >= Math.max(7, minBox / 2) && b >= Math.max(7, minBox / 2)) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      let sum = 0, mx = 0;
      for (let k = 0; k < n; k++) {
        const r = Math.sqrt(((xs[k] - cx) / a) * ((xs[k] - cx) / a) + ((ys[k] - cy) / b) * ((ys[k] - cy) / b));
        const d = Math.abs(r - 1);
        sum += d; if (d > mx) mx = d;
      }
      if (sum / n <= 0.045 && mx <= 0.11) {
        outEllipses.push({ cx, cy, a, b, th, color: chainColor(id) });
        return;
      }
    }
    emitBlob(ch, ci, true);
  }

  if (opts._debug) { opts._debug.M = M; opts._debug.skel = skel; opts._debug.core = core; opts._debug.own = own; opts._debug.chains = chains; opts._debug.T = T; opts._debug.heads = heads; opts._debug.rects = rects; opts._debug.hBars = hBars; opts._debug.vBars = vBars; }
  return finish();

  /* ---------- 6. assemble the result ---------- */
  function finish() {
    // colours + thickness of boxes (bar pixels)
    const boxRecs = [];
    {
      const mapH = new Int32Array(cH.n + 1).fill(-1), mapV = new Int32Array(cV.n + 1).fill(-1);
      rects.forEach((r, k) => { for (const l of r.labsH) mapH[l] = k; for (const l of r.labsV) mapV[l] = k; });
      const acc8 = new Float64Array(Math.max(1, rects.length) * 8);
      const rgb = [0, 0, 0];
      if (rects.length) {
        for (let i = 0; i < N; i++) {
          let k = -1;
          if (mH[i] && mapH[cH.lab[i]] >= 0) k = mapH[cH.lab[i]];
          else if (mV[i] && mapV[cV.lab[i]] >= 0) k = mapV[cV.lab[i]];
          if (k < 0) continue;
          rgbAt(i, rgb);
          const o = k * 8;
          acc8[o] += rgb[0]; acc8[o + 1] += rgb[1]; acc8[o + 2] += rgb[2]; acc8[o + 3]++;
          if (cN[i] <= darkCut) { acc8[o + 4] += rgb[0]; acc8[o + 5] += rgb[1]; acc8[o + 6] += rgb[2]; acc8[o + 7]++; }
        }
      }
      rects.forEach((r, k) => {
        const o = k * 8;
        let color = '#000000';
        if (acc8[o + 7] >= 5) color = toHex(acc8[o + 4] / acc8[o + 7], acc8[o + 5] / acc8[o + 7], acc8[o + 6] / acc8[o + 7]);
        else if (acc8[o + 3] > 0) color = toHex(acc8[o] / acc8[o + 3], acc8[o + 1] / acc8[o + 3], acc8[o + 2] / acc8[o + 3]);
        const th = Math.max(1, r.th);
        const ox0 = r.xl + 0.5 - th / 2, oy0 = r.yt + 0.5 - th / 2;
        const ox1 = r.xr + 0.5 + th / 2, oy1 = r.yb + 0.5 + th / 2;
        boxRecs.push({ kind: 'rect', x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0, th, color, cl: [r.xl + 0.5, r.yt + 0.5, r.xr + 0.5, r.yb + 0.5] });
      });
    }
    for (const e of outEllipses) {
      const ox0 = e.cx - e.a + 0.5 - e.th / 2, oy0 = e.cy - e.b + 0.5 - e.th / 2;
      const pts = [];
      for (let k = 0; k < 48; k++) { const t = k / 48 * 2 * Math.PI; pts.push([e.cx + 0.5 + e.a * Math.cos(t), e.cy + 0.5 + e.b * Math.sin(t)]); }
      boxRecs.push({ kind: 'ellipse', x: ox0, y: oy0, w: 2 * e.a + e.th, h: 2 * e.b + e.th, th: e.th, color: e.color, poly: pts });
    }
    boxRecs.sort((p, q) => q.w * q.h - p.w * p.h);
    boxRecs.forEach((b, k) => { b.id = 'b' + (k + 1); });
    const blobRecs = outBlobs.map(b => {
      const pts = b.pts.map(p => [p[0] + 0.5, p[1] + 0.5]);
      return { pts, x: b.x0 + 0.5 - b.th / 2, y: b.y0 + 0.5 - b.th / 2, w: b.x1 - b.x0 + b.th, h: b.y1 - b.y0 + b.th, th: b.th, closed: b.closed, color: b.color };
    });
    blobRecs.sort((p, q) => q.w * q.h - p.w * p.h);
    blobRecs.forEach((b, k) => { b.id = 'o' + (k + 1); });

    // lines: coordinates to pixel-centre space, heads
    let lines = outLines.map(l => ({
      x1: l.x1 + 0.5, y1: l.y1 + 0.5, x2: l.x2 + 0.5, y2: l.y2 + 0.5, th: l.th, color: l.color, ha: l.ha, hb: l.hb, chain: l.chain
    }));

    // re-join collinear lines that were cut by a box outline
    const ringRects = boxRecs.filter(b => b.kind === 'rect');
    function nearOutline(px, py, slack) {
      for (const b of ringRects) {
        if (distToBox(px, py, b) <= slack) return true;
      }
      return false;
    }
    {
      let merged = true, guard = 0;
      while (merged && guard++ < 50) {
        merged = false;
        outer:
        for (let i = 0; i < lines.length; i++) {
          for (let j = i + 1; j < lines.length; j++) {
            const A = lines[i], Bq = lines[j];
            const ang = (L) => Math.atan2(L.y2 - L.y1, L.x2 - L.x1);
            let da = Math.abs(ang(A) - ang(Bq)) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
            if (da > 5 * Math.PI / 180) continue;
            const ends = [[0, 0], [0, 1], [1, 0], [1, 1]];
            for (const e of ends) {
              const pa = e[0] ? [A.x2, A.y2] : [A.x1, A.y1], pb = e[1] ? [Bq.x2, Bq.y2] : [Bq.x1, Bq.y1];
              const gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
              if (gap > 2 * T + 8) continue;
              const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
              if (!nearOutline(mx, my, T + 4)) continue;
              // perpendicular offset of B's near end from A's line
              const fa = e[0] ? [A.x1, A.y1] : [A.x2, A.y2], fb = e[1] ? [Bq.x1, Bq.y1] : [Bq.x2, Bq.y2];
              const dxl = fb[0] - fa[0], dyl = fb[1] - fa[1], ll = Math.hypot(dxl, dyl) || 1;
              const off1 = Math.abs((pa[0] - fa[0]) * dyl - (pa[1] - fa[1]) * dxl) / ll;
              const off2 = Math.abs((pb[0] - fa[0]) * dyl - (pb[1] - fa[1]) * dxl) / ll;
              if (off1 > Math.max(4, T) || off2 > Math.max(4, T)) continue;
              // far ends and heads
              const headFarA = e[0] ? A.ha : A.hb, headFarB = e[1] ? Bq.hb : Bq.ha;
              const nl = { x1: fa[0], y1: fa[1], x2: fb[0], y2: fb[1], th: (A.th + Bq.th) / 2, color: A.color, ha: headFarA, hb: headFarB, chain: A.chain };
              lines.splice(j, 1); lines.splice(i, 1, nl);
              merged = true;
              break outer;
            }
          }
        }
      }
    }

    // canonical orientation: left->right (or top->bottom for steep lines)
    for (const l of lines) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      const swap = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
      if (swap) { let t = l.x1; l.x1 = l.x2; l.x2 = t; t = l.y1; l.y1 = l.y2; l.y2 = t; t = l.ha; l.ha = l.hb; l.hb = t; }
    }
    // final axis snapping (near-horizontal / vertical) of whole lines
    const snapTan = Math.tan(4 * Math.PI / 180);
    for (const l of lines) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      if (Math.abs(dy) <= Math.abs(dx) * snapTan) { const y = (l.y1 + l.y2) / 2; l.y1 = l.y2 = y; }
      else if (Math.abs(dx) <= Math.abs(dy) * snapTan) { const x = (l.x1 + l.x2) / 2; l.x1 = l.x2 = x; }
    }

    // association + snapping
    const items = [];
    for (const b of boxRecs) items.push(b);
    for (const b of blobRecs) items.push(b);
    function assoc(px, py, lth) {
      let best = null, bd = 1e18;
      for (const it of items) {
        let d;
        if (it.kind === 'rect') d = distToBox(px, py, it);
        else if (it.kind === 'ellipse') d = Math.max(0, polyDist(px, py, it.poly, true) - it.th / 2);
        else {
          if (px < it.x - 40 || px > it.x + it.w + 40 || py < it.y - 40 || py > it.y + it.h + 40) continue;
          d = Math.max(0, polyDist(px, py, it.pts, it.closed) - it.th / 2);
        }
        const thr2 = Math.max(8, 2 * Math.max(lth, it.th));
        if (d <= thr2 && d < bd) { bd = d; best = it; }
      }
      return best;
    }
    const finalLines = [];
    for (const l of lines) {
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      const fromIt = assoc(l.x1, l.y1, l.th), toIt = assoc(l.x2, l.y2, l.th);
      if (len < Math.max(10, 2.5 * T) && !(fromIt && toIt && fromIt !== toIt)) continue;
      if (len < 5) continue;
      // snap endpoints onto the outline of the associated rect
      if (fromIt && fromIt.kind === 'rect') snapEnd(l, 1, fromIt);
      if (toIt && toIt.kind === 'rect') snapEnd(l, 2, toIt);
      finalLines.push({ l, fromIt, toIt });
    }
    finalLines.sort((p, q) => (p.l.y1 - q.l.y1) || (p.l.x1 - q.l.x1));

    res.boxes = boxRecs.map(b => ({ id: b.id, kind: b.kind, x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h), thickness: r1(b.th), color: b.color }));
    res.lines = finalLines.map((o, k) => {
      const l = o.l;
      const head = l.ha && l.hb ? 'both' : (l.ha ? 'start' : (l.hb ? 'end' : 'none'));
      return { id: 'l' + (k + 1), x1: r1(l.x1), y1: r1(l.y1), x2: r1(l.x2), y2: r1(l.y2), thickness: r1(l.th), color: l.color, head, from: o.fromIt ? o.fromIt.id : null, to: o.toIt ? o.toIt.id : null };
    });
    res.blobs = blobRecs.map(b => ({
      id: b.id, x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h), thickness: r1(b.th), closed: b.closed, color: b.color,
      points: b.pts.map(p => [r1(p[0]), r1(p[1])])
    }));
    return res;
  }

  // distance from a point to the outline band of a rect box (0 on / inside the stroke)
  function distToBox(px, py, b) {
    const c = b.cl;
    const xl = c[0], yt = c[1], xr = c[2], yb = c[3];
    const dx = Math.max(xl - px, 0, px - xr), dy = Math.max(yt - py, 0, py - yb);
    let d;
    if (dx > 0 || dy > 0) d = Math.hypot(dx, dy);
    else d = Math.min(px - xl, xr - px, py - yt, yb - py);
    return Math.max(0, d - b.th / 2);
  }
  // move line end (which: 1|2) to where the line meets the outer boundary of the rect box
  function snapEnd(l, which, b) {
    const px = which === 1 ? l.x1 : l.x2, py = which === 1 ? l.y1 : l.y2;
    const qx = which === 1 ? l.x2 : l.x1, qy = which === 1 ? l.y2 : l.y1;
    let ux = px - qx, uy = py - qy;
    const ul = Math.hypot(ux, uy);
    if (ul < 1e-6) return;
    ux /= ul; uy /= ul;
    const ox0 = b.x, oy0 = b.y, ox1 = b.x + b.w, oy1 = b.y + b.h;
    let best = null, bs = 1e18;
    const tol = b.th + 2;
    function tryX(X) {
      if (Math.abs(ux) < 1e-6) return;
      const s = (X - px) / ux;
      const y = py + uy * s;
      if (y < oy0 - tol || y > oy1 + tol) return;
      if (Math.abs(s) < bs) { bs = Math.abs(s); best = [X, y]; }
    }
    function tryY(Y) {
      if (Math.abs(uy) < 1e-6) return;
      const s = (Y - py) / uy;
      const x = px + ux * s;
      if (x < ox0 - tol || x > ox1 + tol) return;
      if (Math.abs(s) < bs) { bs = Math.abs(s); best = [x, Y]; }
    }
    tryX(ox0); tryX(ox1); tryY(oy0); tryY(oy1);
    if (best && bs <= Math.max(8, 2 * b.th) + 2) {
      if (which === 1) { l.x1 = best[0]; l.y1 = best[1]; } else { l.x2 = best[0]; l.y2 = best[1]; }
    }
  }
}

/* Zhang-Suen thinning followed by removal of redundant corner pixels */
function skeletonize(mask, W, H) {
  const N = W * H;
  const s = new Uint8Array(mask);
  let cnt = 0;
  for (let i = 0; i < N; i++) if (s[i]) cnt++;
  const pts = new Int32Array(cnt);
  let np = 0;
  for (let i = 0; i < N; i++) if (s[i]) pts[np++] = i;
  const del = new Int32Array(cnt);
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      let nd = 0;
      for (let k = 0; k < np; k++) {
        const p = pts[k];
        const p2 = s[p - W], p3 = s[p - W + 1], p4 = s[p + 1], p5 = s[p + W + 1], p6 = s[p + W], p7 = s[p + W - 1], p8 = s[p - 1], p9 = s[p - W - 1];
        const Bc = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (Bc < 2 || Bc > 6) continue;
        const A = ((!p2 && p3) ? 1 : 0) + ((!p3 && p4) ? 1 : 0) + ((!p4 && p5) ? 1 : 0) + ((!p5 && p6) ? 1 : 0) +
                  ((!p6 && p7) ? 1 : 0) + ((!p7 && p8) ? 1 : 0) + ((!p8 && p9) ? 1 : 0) + ((!p9 && p2) ? 1 : 0);
        if (A !== 1) continue;
        if (pass === 0) { if (p2 && p4 && p6) continue; if (p4 && p6 && p8) continue; }
        else { if (p2 && p4 && p8) continue; if (p2 && p6 && p8) continue; }
        del[nd++] = p;
      }
      if (nd) {
        changed = true;
        for (let k = 0; k < nd; k++) s[del[k]] = 0;
        let m = 0;
        for (let k = 0; k < np; k++) if (s[pts[k]]) pts[m++] = pts[k];
        np = m;
      }
    }
  }
  // remove redundant pixels: single contiguous neighbour run with >= 2 neighbours
  for (let sweep = 0; sweep < 3; sweep++) {
    let any = false;
    for (let k = 0; k < np; k++) {
      const p = pts[k];
      if (!s[p]) continue;
      const n0 = s[p - W], n1 = s[p - W + 1], n2 = s[p + 1], n3 = s[p + W + 1], n4 = s[p + W], n5 = s[p + W - 1], n6 = s[p - 1], n7 = s[p - W - 1];
      const c = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7;
      if (c < 2) continue;
      const a = ((!n0 && n1) ? 1 : 0) + ((!n1 && n2) ? 1 : 0) + ((!n2 && n3) ? 1 : 0) + ((!n3 && n4) ? 1 : 0) +
                ((!n4 && n5) ? 1 : 0) + ((!n5 && n6) ? 1 : 0) + ((!n6 && n7) ? 1 : 0) + ((!n7 && n0) ? 1 : 0);
      if (a === 1 && c <= 3) { s[p] = 0; any = true; }
    }
    if (!any) break;
  }
  return s;
}

const api = { detect: detect, _windowFilter: windowFilter };
if (typeof module === 'object' && module && module.exports) module.exports = api;
else global.DiagramDetect = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
