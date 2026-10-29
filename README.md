# Network Whiteboard

A whiteboard for drawing network and architecture diagrams, in the spirit of Microsoft Whiteboard. It runs
entirely on your own computer: a small local web server plus a page in your browser. There is no account, no
cloud service and no AI model; nothing you draw leaves your machine.

**What it does**

- Infinite canvas with pen, highlighter, eraser, shapes, text, sticky notes, images and a ruler
- Network device palette (generic, Cisco, Palo Alto Networks, Fortinet) and connectors that follow the devices
- Add your own icons; they are saved in the `icons/user` folder
- Turn an imported picture of a diagram into editable shapes, text and links ("Detect components"), done locally
- Autosave in the browser, plus save/open as a file and export to PNG

---

## 1. Requirements

| What | Version | Needed for |
|---|---|---|
| Python | 3.8 or newer (developed and tested on 3.11) | running the app |
| A current browser | Chrome or Edge 99+, Firefox 112+, Safari 16+ | using the app (tested in Edge) |
| Node.js | 16 or newer | **only** to run the detector tests (optional) |

There are **no Python packages to install** and **no virtual environment is needed**: `run.py` uses only the
Python standard library, so the app runs on your machine's own Python. `requirements.txt` documents this.
No internet connection is needed to run it (the text-recognition engine is bundled in `vendor/`).

## 2. Install and run

### Windows

1. Install Python from <https://www.python.org/downloads/>. In the installer, tick **"Add python.exe to PATH"**.
2. Check it works. In PowerShell:
   ```powershell
   py --version        # should print Python 3.8 or newer
   ```
3. Copy this `whiteboard` folder anywhere on your computer.
4. Start it, either way:
   - double-click **`start.bat`**, or
   - in PowerShell:
     ```powershell
     cd path\to\whiteboard
     py run.py
     ```
5. Your browser opens at <http://localhost:8000/index.html>. Leave the terminal window open while you work;
   press **Ctrl+C** in it to stop the server.

### macOS / Linux

```bash
python3 --version      # 3.8 or newer
cd path/to/whiteboard
python3 run.py
```

### Options

```text
py run.py --port 9000      use another port (default 8000)
py run.py --no-browser     do not open a browser tab
py run.py --help
```

If port 8000 is busy, the next free port is used and the terminal says so.

> **Keep using the same address.** The browser saves your board per address (`localhost:8000`). If you start the
> app on a different port, you will see an empty board. Your work is not lost; start it on the old port again, or
> use **Save** to keep a copy as a file.

> **Do not open `index.html` by double-clicking it.** Text recognition, adding icons and the icon list need the
> local server, so always start the app with `run.py` / `start.bat`.

## 3. Using the board

### Tools (left toolbar)

| Tool | Key | Notes |
|---|---|---|
| Select | `V` | Click, Shift-click or drag a box to select. Drag to move, corner handles to resize |
| Pan | `G` | Or hold **Space**, or the mouse wheel. **Ctrl + wheel** (or pinch) zooms |
| Pen / Highlighter | `P` / `H` | Colour and width in the bar at the bottom |
| Eraser | `E` | Removes whole strokes and objects |
| Rectangle, Ellipse, Line, Arrow | `R` `O` `L` `A` | Hold **Shift** for squares, circles and 15° angles |
| Text | `T` | Click and type |
| Sticky note | `N` | Six colours |
| Network devices | `D` | Opens the device palette (see below) |
| Connect devices | `C` | Drag from one device or shape to another |
| Image | `I` | Or paste (Ctrl+V) or drag a picture onto the board |
| Ruler | `K` | Drag the grips to move and rotate it; pen strokes snap to its edge |

Double-click text, a note, a device, a link or the inside of a shape to edit its text. Rectangles and ellipses can
hold a label too.

### Shortcuts

`Ctrl+Z` undo · `Ctrl+Y` / `Ctrl+Shift+Z` redo · `Ctrl+A` select all · `Ctrl+C` / `X` / `V` copy, cut, paste ·
`Ctrl+D` duplicate · `Delete` remove · arrow keys nudge (Shift = 10×) · `Ctrl+0` reset zoom · `Ctrl+ +/-` zoom ·
`Esc` back to Select.

Top-right: undo/redo, background style, **PNG** export, **Save** / **Open** (a `.whiteboard.json` file) and clear
board. Bottom-right: zoom and fit-to-content.

## 4. Network diagrams

### Devices

Open the palette with the **Network devices** button (or `D`). Click a tile and then click the board, or drag the
tile onto the board. Double-click a device to rename it. Use the search box to filter.

| Section | What you get |
|---|---|
| Generic | Router, switch, L3 switch, firewall, load balancer, wireless AP, server, database, workstation, cloud, VPN |
| Cisco | Router, switches, firewall, AP, wireless controller, ISE, FMC / DNA Center (see the note below) |
| Palo Alto Networks | PA-Series and VM-Series firewalls, Panorama, Prisma Access, GlobalProtect (see the note below) |
| Fortinet | The **official Fortinet icon set** (FortiGate, FortiSwitch, FortiAP, FortiManager, FortiAnalyzer, ...) |
| User icons | Your own icons (next section) |

> **Cisco and Palo Alto tiles are not the vendors' official artwork.** Their official icon sets are only offered as
> Visio/PowerPoint files, or behind a download page that does not allow scripted downloads, so they could not be
> bundled. The tiles are generic symbols in the vendor's colour with the product name. Section 6 explains how to
> swap in the official icons.

### Links

Choose **Connect devices** (`C`) and drag from one device or shape to another. Links follow the objects when you
move them, can be dashed (for VPN or backup paths), coloured and thicker, and carry a label (double-click the
link). Select a link to change its style in the bar at the bottom.

## 5. Add your own icons

1. Open the device palette and click **+ Add icon** (top of the palette), or the **+** tile under **User icons**.
2. Choose one or more files: **PNG, SVG, JPG, GIF or WebP, up to 2 MB each**.
3. For a single file you are asked for a name (several files use their file names).
4. The icon is **copied into the `icons/user` folder** and appears under **User icons**, ready to use like any other
   device. It is still there the next time you start the app.

To remove one, hover its tile and click the **×**. Devices already on a board that use a removed icon show a "?".

Details: files are checked by their real content (not their extension), SVGs containing scripts, event handlers or
external links are refused, and the server only accepts requests from its own page. The list of your icons is
`icons/user/manifest.json`; you can also copy files into `icons/user` yourself and list them there:

```json
[ { "name": "Branch router", "file": "branch-router.svg" } ]
```

## 6. Using official Cisco / Palo Alto icons

Download the official icon sets yourself (their terms apply), then convert to SVG or PNG, because browsers cannot
show Visio/EMF files directly:

- Cisco: <https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html> (Visio and PowerPoint packs; read the
  usage terms on that page)
- Palo Alto Networks: their official Visio stencil (`panw-vssx.vssx`; open it in Visio, or convert the images with
  Inkscape or draw.io) and the usage terms that come with it

Then either use **+ Add icon** (simplest), or put the files into the `icons` folder and list them in
`icons/manifest.json` with the vendor so they appear in the right section:

```json
{ "name": "Catalyst 9300", "label": "Cat 9300", "vendor": "cisco", "file": "cisco-cat9300.svg" }
```

`vendor` must be `cisco`, `palo` or `fortinet`. Sources and terms for the bundled Fortinet icons are in
`icons/SOURCES.md`.

## 7. Turn an image into editable objects

1. Add a picture of a diagram (Image tool, paste, or drag it in) and leave it selected.
2. Click **Detect components** in the bar at the bottom.
3. After a few seconds the picture is replaced by editable objects:
   - boxes and ellipses (with the text inside them as their label)
   - connectors as links attached to the shapes, with arrowheads where there are any
   - curvy shapes as freehand strokes
   - text as text objects; words such as "firewall", "load balancer", "router" or "Internet" turn a small shape into
     the matching device symbol
4. **Ctrl+Z** brings the original picture back.

Everything runs inside your browser, with the bundled Tesseract text-recognition engine; the picture is not
uploaded anywhere. The first use takes a few seconds longer while the engine starts.

Works best on clean diagrams with printed text. It is not perfect:

- boxes need four closed sides; dashed or open boxes and filled shapes are not recognised as boxes
- two lines that cross are not separated
- open "V" arrowheads at diagonal angles are unreliable (filled triangles work)
- very wobbly circles come out as freehand shapes instead of ellipses
- handwriting is read poorly; text sizes are estimates

## 8. Saving your work

- **Autosave:** the board is saved in your browser as you work. It stays after closing the browser, but only for the
  same address and the same browser profile, and clearing site data deletes it.
- **Save / Open:** writes or reads a `.whiteboard.json` file. Use this for backups and for moving a board to another
  computer. Images and icon names are stored in it (icon *files* are not, so copy `icons/user` as well).
- **PNG:** exports the whole board as an image.

Large images can fill the browser's autosave space; you then get a message to use **Save**.

## 9. Project layout

```text
whiteboard/
  run.py               local web server (+ the icon upload API); Python standard library only
  start.bat            Windows launcher
  requirements.txt     documents that there are no Python dependencies
  index.html           the page
  app.js               the whiteboard (canvas, tools, palette, links, detection glue)
  detect.js            the shape/line detector (pure JavaScript, no dependencies)
  style.css
  icons/
    manifest.json      official vendor icons (Fortinet)      SOURCES.md  where they came from
    user/              icons added through the palette (created on first use)
  vendor/tesseract/    bundled OCR engine (tesseract.js 5.1.1 + English model), with licences and a README
  tests/
    test_icons_api.py  tests for the icon upload API   (Python)
    detect.test.js     tests for the detector          (Node)
```

## 10. Tests

```powershell
py -m unittest tests/test_icons_api.py -v     # icon upload API (starts a temporary server; touches no real files)
node tests/detect.test.js                     # shape/line detector (needs Node.js 16+)
```

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `python` is "not found" on Windows | Use `py run.py`, or reinstall Python with "Add python.exe to PATH" ticked |
| The page looks old or a feature is missing after an update | Hard refresh with **Ctrl+F5** |
| The board is empty | You probably started on a different port. Use the same port as before |
| "Add icon" or "Detect components" says the server is not reachable | Start the app with `run.py` / `start.bat` and use the `http://localhost:...` address, not a file |
| Detect finds little or reads text wrongly | Use a larger, sharper picture with a plain background; see the limits in section 7 |
| "Autosave failed" message | The board is too big for browser storage. Click **Save** to keep a file copy |
| Port already in use | Another program has port 8000. The app picks the next port automatically, or pass `--port` |

## 12. Security and privacy

- The server listens on **127.0.0.1 only**, so other computers cannot reach it. Do not expose it to a network:
  it is built for one person on one machine.
- It writes only inside `icons/user`, accepts only image files that pass content checks, and rejects requests
  that do not come from its own pages.
- No telemetry, no external requests at runtime; all libraries are bundled.

## 13. Known limits

- One board at a time; no real-time collaboration, templates or version history yet.
- The whole board is redrawn on every change, which is fine for normal boards but slows down on very large ones.
- Tested in Microsoft Edge (Chromium) on Windows. Other modern browsers should work but are untested.

## 14. Third-party material and trademarks

- **Fortinet icons** (`icons/*.svg`): downloaded from Fortinet's official icon library; see `icons/SOURCES.md` for
  the source URLs and terms.
- **Tesseract.js, tesseract.js-core, tessdata** (`vendor/tesseract/`): Apache-2.0, licence files are included there.
- Cisco, Palo Alto Networks, Fortinet and all product names are trademarks of their respective owners. This project
  is not affiliated with or endorsed by them. The Cisco and Palo Alto tiles in the palette are original generic
  symbols, not vendor artwork.
- No licence has been chosen yet for the whiteboard's own code (`app.js`, `detect.js`, `run.py`, `style.css`,
  `index.html`); decide on one before sharing it outside your team.
