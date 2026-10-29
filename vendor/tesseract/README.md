# Vendored Tesseract.js (offline English OCR)

Everything here is static; nothing is fetched from a CDN at runtime.

## Versions

- tesseract.js **5.1.1** (Apache-2.0) - `tesseract.min.js` (UMD, global `Tesseract`), `worker.min.js`
- tesseract.js-core **5.1.1** (Apache-2.0) - LSTM-only builds, WASM is embedded (base64) inside the `.wasm.js` files, so there are NO separate `.wasm` files to serve
- `lang/eng.traineddata` - tessdata_fast English (Apache-2.0), stored RAW (not gzipped), so `gzip: false` is REQUIRED

## Files

```
vendor/tesseract/
  tesseract.min.js                      main-thread API (global Tesseract)
  worker.min.js                         Web Worker script
  core/tesseract-core-simd-lstm.wasm.js loaded when browser supports WASM SIMD
  core/tesseract-core-lstm.wasm.js      fallback without SIMD
  lang/eng.traineddata                  4.1 MB, raw
  LICENSE-*, *.LICENSE.txt              licences
```

The worker picks the core file itself from the `corePath` directory (SIMD detection is automatic) and, because we create the worker with OEM `1` (LSTM only), it requests `tesseract-core-simd-lstm.wasm.js` or `tesseract-core-lstm.wasm.js`. Both are present.

## Browser usage (page at http://localhost:8000/index.html)

```html
<script src="vendor/tesseract/tesseract.min.js"></script>
```

```js
const base = new URL('vendor/tesseract/', location.href).href;   // http://localhost:8000/vendor/tesseract/

const worker = await Tesseract.createWorker('eng', 1, {          // 1 = OEM.LSTM_ONLY
  workerPath: base + 'worker.min.js',
  corePath:   base + 'core/',          // directory, MUST end with '/' (or be a .js file URL)
  langPath:   base + 'lang/',          // directory containing eng.traineddata
  gzip:       false,                   // our traineddata is not .gz
  cacheMethod:'none',                  // skip IndexedDB caching (optional; default caches the 4 MB model)
  logger: m => console.log(m.status, m.progress)   // optional
});

const { data } = await worker.recognize(canvas, {}, { blocks: true });   // canvas | img | blob | URL | data URL
// ... use data ...
await worker.terminate();              // when done; or keep the worker and reuse it for many recognize() calls
```

### ABSOLUTE URLs are required

Use absolute URLs (as above) for `workerPath`, `corePath` and `langPath`. By default (`workerBlobURL: true`) the Worker is started from a `blob:` URL containing `importScripts("<workerPath>")`, and a blob: origin cannot resolve relative paths. `corePath`/`langPath` are then fetched/`importScripts`-ed from inside the worker, so they must also be absolute. `new URL('vendor/tesseract/', location.href).href` yields that.

### recognize() and result shape

`worker.recognize(image, options, output)`. In v5 `blocks` is NOT guaranteed in the default output of later 5.x/6.x releases, so always pass `{ blocks: true }` as the third argument (verified with 5.1.1; in 5.1.1 `blocks` also happens to be on by default, plus deprecated top-level `data.lines/words/paragraphs`; do not rely on those).

```
result.data
  text         string (all lines, "\n" separated)
  confidence   0-100 (page)
  blocks[]     { bbox, confidence, text, blocktype, baseline, polygon, paragraphs[] }
    paragraphs[]  { bbox, confidence, text, lines[], ... }
      lines[]       { text (ends with "\n"), bbox, confidence, baseline, words[] }
        words[]       { text, bbox, confidence, baseline, ... }
  bbox = { x0, y0, x1, y1 }   pixels in the coordinate system of the image passed in
                               (x0,y0 top-left, x1,y1 bottom-right); confidence 0-100
```

Collect lines: `data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines))`.

Verified example (3 typed lines on a 900x400 PNG, Arial 36):

```json
{ "text": "why not azure firewall?\nDMZ VNet\nF5 for LB and SNAT\n",
  "lines": [
   { "text": "why not azure firewall?\n", "bbox": {"x0":38,"y0":38,"x1":537,"y1":83},  "confidence": 96.1,
     "words": [ {"text":"why","bbox":{"x0":38,"y0":38,"x1":125,"y1":83},"confidence":96.6}, ... ] },
   { "text": "DMZ VNet\n",         "bbox": {"x0":42,"y0":158,"x1":268,"y1":193}, "confidence": 92.7 },
   { "text": "F5 for LB and SNAT\n","bbox": {"x0":42,"y0":277,"x1":481,"y1":314}, "confidence": 94.1 } ] }
```

## Gotchas

- `corePath` directory must end in `/` (code strips and re-adds it, but keep it); all three paths absolute.
- Page segmentation: tesseract.js defaults to PSM `SINGLE_BLOCK` (6; the result reports `psm: 'SINGLE_BLOCK'`). For scattered whiteboard text you probably want `await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT })` (11) or `AUTO` (3). Not tested here; verify on real whiteboard content.
- Best results: dark text on a light, opaque background (fill the canvas white before drawing), text height roughly 30-50 px; upscale small handwriting/text. Recognition is for printed text; handwriting will be poor.
- First `createWorker` downloads+compiles ~4 MB wasm.js (JS parse of ~3.9 MB) and loads the 4 MB model: about 0.3-0.5 s on localhost in headless Edge (a few seconds on slow machines). Create the worker once, lazily, and reuse it. Recognizing the test image took about 0.25 s.
- Memory: the worker holds the WASM heap plus model (order of 100-200 MB). `terminate()` frees it.
- Serve with a normal static server; `.js` must be served as JavaScript. No special headers (COOP/COEP) are needed for this build (no SharedArrayBuffer/threads).
- `recognize` accepts a canvas (internally `toBlob`), `<img>`, `Blob/File`, URL string, or `data:image/...;base64,` string. Canvas must not be tainted.
- Only one recognize job runs at a time per worker; calls queue.
- `cacheMethod:'none'` avoids IndexedDB; without it the model is cached in IndexedDB after first load (harmless, still offline).

## Verification performed

- Node 16 with tesseract.js 5.1.1, local `langPath`, `gzip:false`, `cacheMethod:'none'`: correct text and the structure above.
- Real Edge (headless) loading a page that used exactly these files at `http://localhost:<port>/vendor/tesseract/...` with absolute URLs, canvas input and `{blocks:true}`: correct text and bboxes; server log showed requests only for `tesseract.min.js`, `worker.min.js`, `core/tesseract-core-simd-lstm.wasm.js`, `lang/eng.traineddata` (no external hosts). The non-SIMD fallback core file was not exercised.
