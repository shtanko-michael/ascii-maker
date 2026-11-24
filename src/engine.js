// ASCII engine: static layers (lum = white part, red = tint part) sampled on a
// character grid, plus animated falling streaks and a travelling pulse.
export const W = 720, H = 1280;
export const TAU = Math.PI * 2;

// Where things go on the 720x1280 canvas.
// "reels" keeps everything inside Instagram's safe zone: top ~12% is covered by
// the status bar / back button, bottom ~22% by caption + music, right ~13% by the
// action buttons, and tall phones crop a few % off both sides.
export const LAYOUTS = {
  // full-bleed 9:16 frame; the subject sits in the band no phone covers and the code strip goes under it
  reels: { name: "Reels safe", subjectY: 152, subjectH: 688, showCode: true, codeY: 846, codeH: 158, codeFull: true, codeOpacity: 0.88 },
  full:  { name: "Classic",    subjectY: 0,   subjectH: 860, showCode: true, codeY: 860, codeH: 420, codeFull: true, codeOpacity: 1 },
  clean: { name: "No code",    subjectY: 152, subjectH: 860, showCode: false, codeY: 846, codeH: 158, codeFull: true, codeOpacity: 0.88 },
};
export const LAYOUT_KEYS = ["subjectY", "subjectH", "showCode", "codeY", "codeH", "codeFull", "codeOpacity", "panX", "panY", "zoom"];

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// small seeded rng so scenes are reproducible
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- built-in scenes: draw white parts on `L`, red parts on `R` ----------
export const PRESETS = {
  // @scene moon
  moon: {
    name: "Moon",
    emitter: (h) => ({ x: 360, y: h * 0.12, spread: 330 }),
    draw(L, R, w, h, rnd) {
      const sx = w / 720, sy = h / 860;
      const g = R.createLinearGradient(0, 0, 0, h);          // red dusk sky
      g.addColorStop(0, "rgba(255,255,255,0.05)"); g.addColorStop(0.6, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0.1)");
      R.fillStyle = g; R.fillRect(0, 0, w, h);
      L.filter = "blur(40px)"; L.fillStyle = "rgba(255,255,255,0.4)";   // moon halo + disc
      L.beginPath(); L.arc(430 * sx, 250 * sy, 150 * sx, 0, TAU); L.fill();
      L.filter = "blur(2px)"; L.fillStyle = "#fff";
      L.beginPath(); L.arc(430 * sx, 250 * sy, 95 * sx, 0, TAU); L.fill();
      L.globalCompositeOperation = "destination-out"; L.fillStyle = "rgba(0,0,0,0.35)";   // craters
      [[400, 220, 20], [470, 280, 26], [440, 200, 10], [395, 290, 12]].forEach(([x, y, r]) => {
        L.beginPath(); L.arc(x * sx, y * sy, r * sx, 0, TAU); L.fill(); });
      L.globalCompositeOperation = "source-over"; L.filter = "none";
      const ridge = (c, base, amp, f, ph, style) => {            // mountain silhouettes
        c.globalCompositeOperation = "destination-out"; c.fillStyle = "#000";
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) c.lineTo(x, (base + amp * Math.sin(x / (f * sx) + ph) + amp * 0.5 * Math.sin(x / (f * 0.37 * sx) + ph * 2)) * sy);
        c.lineTo(w, h); c.fill(); c.globalCompositeOperation = "source-over";
        if (style) { c.fillStyle = style; c.beginPath(); c.moveTo(0, h);
          for (let x = 0; x <= w; x += 6) c.lineTo(x, (base + amp * Math.sin(x / (f * sx) + ph) + amp * 0.5 * Math.sin(x / (f * 0.37 * sx) + ph * 2)) * sy);
          c.lineTo(w, h); c.fill(); }
      };
      ridge(L, 560, 40, 90, 1, null); ridge(R, 560, 40, 90, 1, "rgba(255,255,255,0.55)");
      ridge(L, 680, 30, 60, 3, null); ridge(R, 680, 30, 60, 3, "rgba(255,255,255,0.25)");
      ridge(L, 780, 18, 40, 5, null); ridge(R, 780, 18, 40, 5, "rgba(255,255,255,0.08)");
      R.fillStyle = "rgba(255,255,255,0.7)";                      // stars
      for (let i = 0; i < 120; i++) R.fillRect(rnd() * w, rnd() * h * 0.55, 2, 2);
    },
  },
  // @scene crucifix
  crucifix: {
    name: "Cross",
    emitter: (h) => ({ x: 360, y: h * 0.31, spread: 220 }),
    draw(L, R, w, h, rnd) {
      const sx = w / 720, sy = h / 860;
      R.fillStyle = "#fff";
      const g = R.createLinearGradient(0, 0, 0, h);         // dark-red sky
      g.addColorStop(0, "rgba(255,255,255,0.08)");
      g.addColorStop(1, "rgba(255,255,255,0.38)");
      R.fillStyle = g; R.fillRect(0, 0, w, h);
      R.fillStyle = "rgba(255,255,255,0.85)";                // cross
      R.fillRect(300 * sx, 90 * sy, 120 * sx, h);
      R.fillRect(110 * sx, 230 * sy, 500 * sx, 70 * sy);
      R.fillStyle = "rgba(255,255,255,0.45)";                // side faces
      R.fillRect(420 * sx, 110 * sy, 20 * sx, h);
      R.fillRect(110 * sx, 300 * sy, 520 * sx, 18 * sy);
      // faceless figure
      const fig = (c, a) => {
        c.fillStyle = `rgba(255,255,255,${a})`; c.strokeStyle = c.fillStyle; c.lineCap = "round";
        c.beginPath(); c.ellipse(360 * sx, 205 * sy, 26 * sx, 34 * sy, 0, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(360 * sx, 330 * sy, 48 * sx, 90 * sy, 0, 0, TAU); c.fill();
        c.lineWidth = 24 * sx;
        c.beginPath(); c.moveTo(330 * sx, 262 * sy); c.lineTo(140 * sx, 268 * sy); c.stroke();
        c.beginPath(); c.moveTo(390 * sx, 262 * sy); c.lineTo(580 * sx, 268 * sy); c.stroke();
        c.lineWidth = 34 * sx;
        c.beginPath(); c.moveTo(360 * sx, 400 * sy); c.lineTo(360 * sx, 620 * sy); c.stroke();
      };
      R.globalCompositeOperation = "destination-out"; fig(R, 1); R.globalCompositeOperation = "source-over";
      L.filter = "blur(30px)"; fig(L, 0.35); L.filter = "blur(2px)"; fig(L, 1); L.filter = "none";
      bokehAndEmbers(R, w, h, rnd);
    },
  },
  // @scene monolith
  monolith: {
    name: "Monolith",
    emitter: (h) => ({ x: 360, y: h * 0.56, spread: 55 }),
    draw(L, R, w, h, rnd) {
      const sx = w / 720, sy = h / 860;
      R.fillStyle = "rgba(255,255,255,0.75)";
      R.fillRect(250 * sx, 120 * sy, 220 * sx, h);
      R.fillRect(120 * sx, 120 * sy, 480 * sx, 80 * sy);
      const fig = (c, a) => {
        c.fillStyle = `rgba(255,255,255,${a})`;
        [[360, 220, 55, 70, 0], [360, 380, 95, 150, 0], [265, 360, 22, 120, 0.14], [455, 360, 22, 120, -0.14]]
          .forEach(([x, y, rx, ry, r]) => { c.beginPath(); c.ellipse(x * sx, y * sy, rx * sx, ry * sy, r, 0, TAU); c.fill(); });
      };
      R.globalCompositeOperation = "destination-out"; fig(R, 1); R.globalCompositeOperation = "source-over";
      L.filter = "blur(28px)"; fig(L, 0.45); L.filter = "blur(4px)"; fig(L, 1);
      L.filter = "blur(6px)"; L.globalCompositeOperation = "destination-out";
      L.fillStyle = "rgba(0,0,0,0.95)"; L.beginPath(); L.ellipse(360 * sx, 235 * sy, 30 * sx, 42 * sy, 0, 0, TAU); L.fill();
      L.globalCompositeOperation = "source-over"; L.filter = "none";
      const g = R.createLinearGradient(0, 560 * sy, 0, h);   // glowing slit
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,1)");
      R.fillStyle = g; R.fillRect(350 * sx, 560 * sy, 20 * sx, h);
      bokehAndEmbers(R, w, h, rnd);
    },
  },
  // @scene wires
  // power lines at dusk: white poles and sagging wires, a red sun sinking behind the town
  wires: {
    name: "Wires",
    emitter: (h) => ({ x: 380, y: h * 0.3, spread: 340 }),
    draw(L, R, w, h, rnd) {
      const sx = w / 720, sy = h / 860, X = (x) => x * sx, Y = (y) => y * sy;
      const sky = R.createLinearGradient(0, 0, 0, h);              // dusk glow low on the horizon
      sky.addColorStop(0, "rgba(255,255,255,0)"); sky.addColorStop(0.55, "rgba(255,255,255,0.04)");
      sky.addColorStop(0.8, "rgba(255,255,255,0.22)"); sky.addColorStop(1, "rgba(255,255,255,0.05)");
      R.fillStyle = sky; R.fillRect(0, 0, w, h);
      R.filter = "blur(36px)"; R.fillStyle = "rgba(255,255,255,0.6)";  // sun: halo + disc
      R.beginPath(); R.arc(X(250), Y(560), X(175), 0, TAU); R.fill();
      R.filter = "blur(1px)"; R.fillStyle = "#fff";
      R.beginPath(); R.arc(X(250), Y(560), X(105), 0, TAU); R.fill(); R.filter = "none";
      // the town on the horizon hides the bottom of the sun
      const roofs = [];
      for (let x = -20; x < 740; x += 26 + rnd() * 40) roofs.push([x, 690 - 14 - rnd() * 40]);
      R.globalCompositeOperation = "destination-out"; R.fillStyle = "#000";
      roofs.forEach(([x, y]) => R.fillRect(X(x), Y(y), X(48), h));
      R.fillRect(0, Y(700), w, h); R.globalCompositeOperation = "source-over";
      L.fillStyle = "rgba(255,255,255,0.16)";
      roofs.forEach(([x, y]) => L.fillRect(X(x), Y(y), X(48), Y(700 - y)));
      L.fillStyle = "rgba(255,255,255,0.5)";                         // lit windows
      roofs.forEach(([x, y]) => { if (rnd() < 0.5) L.fillRect(X(x + 10 + rnd() * 26), Y(y + 14 + rnd() * 20), X(6), Y(6)); });
      // poles: x, top, width, crossarm length; returns where the wires hang
      const pole = (x, top, pw, arm) => {
        L.fillStyle = "#fff";
        L.fillRect(X(x - pw / 2), Y(top), X(pw), h);
        L.fillRect(X(x - arm / 2), Y(top + 24), X(arm), Y(pw * 0.6));
        L.fillRect(X(x - arm * 0.35), Y(top + 70), X(arm * 0.7), Y(pw * 0.5));
        return [-0.5, -0.17, 0.17, 0.5].map((k) => [x + k * arm, top + 22])
          .concat([-0.35, 0.35].map((k) => [x + k * arm, top + 68]));
      };
      const a = pole(110, 70, 18, 170), b = pole(560, 330, 9, 84);
      const wire = (p, q, sag) => {                                    // a sagging span
        L.strokeStyle = "#fff"; L.lineWidth = X(5);
        L.beginPath(); L.moveTo(X(p[0]), Y(p[1]));
        L.quadraticCurveTo(X((p[0] + q[0]) / 2), Y((p[1] + q[1]) / 2 + sag), X(q[0]), Y(q[1])); L.stroke();
      };
      a.forEach((p, i) => { wire(p, b[i], 70 + i * 6); wire([-60, p[1] - 160], p, 40); wire(b[i], [780, b[i][1] + 70], 18); });
      // birds resting on the third wire
      const [p, q] = [a[2], b[2]], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 82];
      L.fillStyle = "#fff";
      [0.38, 0.44, 0.71].forEach((u) => {
        const bx = (1 - u) ** 2 * p[0] + 2 * u * (1 - u) * mid[0] + u * u * q[0];
        const by = (1 - u) ** 2 * p[1] + 2 * u * (1 - u) * mid[1] + u * u * q[1];
        L.beginPath(); L.ellipse(X(bx), Y(by - 9), X(7), Y(9), 0, 0, TAU); L.fill();
        L.beginPath(); L.arc(X(bx + 4), Y(by - 20), X(5), 0, TAU); L.fill();
      });
      L.fillStyle = "rgba(255,255,255,0.55)";                          // first stars
      for (let i = 0; i < 50; i++) L.fillRect(rnd() * w, rnd() * h * 0.4, 2, 2);
    },
  },
  // @end
};

// ---------- code of one scene, for the code panel ----------
// The engine's own source is split by "// @scene <key>" ... "// @end" markers. sceneCode() cuts out
// the block of one scene and appends the helpers it calls ("// @helper <name>").
export function sceneCode(src, key) {
  const lines = src.split("\n"), blocks = {}, helpers = {};
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^\s*\/\/ @(scene|helper|end)\s*(\w*)/);
    if (m) { cur = m[1] === "end" ? null : { kind: m[1], name: m[2], lines: [] }; if (cur) (cur.kind === "scene" ? blocks : helpers)[cur.name] = cur.lines; continue; }
    if (cur) cur.lines.push(line);
  }
  const body = blocks[key];
  if (!body) return null;
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const out = [`// scene "${key}" · src/engine.js`, ...body.map((l) => l.slice(pad))];
  for (const [name, h] of Object.entries(helpers)) if (body.some((l) => l.includes(name + "("))) out.push("", ...h);
  return out.join("\n");
}

// @helper bokehAndEmbers
function bokehAndEmbers(R, w, h, rnd) {
  R.filter = "blur(6px)"; R.fillStyle = "rgba(255,255,255,0.3)";
  for (let i = 0; i < 5; i++) { R.beginPath(); R.arc(rnd() * w, 80 + rnd() * (h - 160), 40 + rnd() * 40, 0, TAU); R.fill(); }
  R.filter = "none"; R.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 200; i++) R.fillRect(rnd() * w, rnd() * h, 2, 2);
}
// @end

// ---------- build static layers on the grid ----------
function makeCanvas(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return c;
}

function sample(canvas, cols, rows) {
  const s = makeCanvas(cols, rows), c = s.getContext("2d", { willReadFrequently: true });
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  c.drawImage(canvas, 0, 0, cols, rows);
  return c.getImageData(0, 0, cols, rows).data;
}

// cw/ch = character cell width/height in px (can differ for tall/wide glyphs)
// put the subject band into the full frame: underneath, a blurred, dimmed copy of the same
// scene stretched to the whole frame (no hard edges, no smeared stripes); the band itself
// fades into it over `feather` px at the top and bottom
function placeBand(src, w, h, y0, bh, { zoom = 1, panX = 0, panY = 0 } = {}, feather = 90) {
  const c = makeCanvas(w, h), g = c.getContext("2d");
  const k = Math.max(w / src.width, h / src.height);
  g.filter = "blur(28px)"; g.globalAlpha = 0.22;
  g.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
  g.filter = "none"; g.globalAlpha = 1;
  // fade the backdrop out towards the frame edges so the area under the UI stays calm
  g.globalCompositeOperation = "destination-in";
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(Math.max(0, (y0 - 40) / h), "rgba(0,0,0,0.9)");
  v.addColorStop(Math.min(1, (y0 + bh + 40) / h), "rgba(0,0,0,0.9)"); v.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  const band = makeCanvas(w, bh), bg = band.getContext("2d");
  // zoom around the centre, then shift: pan -1..1 moves by up to half the band
  const zw = src.width * zoom, zh = src.height * zoom;
  bg.drawImage(src, (w - zw) / 2 + panX * w / 2, (bh - zh) / 2 + panY * bh / 2, zw, zh);
  bg.globalCompositeOperation = "destination-in";
  const grad = bg.createLinearGradient(0, 0, 0, bh), f = Math.min(0.45, feather / bh);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(f, "rgba(0,0,0,1)");
  grad.addColorStop(1 - f, "rgba(0,0,0,1)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  bg.fillStyle = grad; bg.fillRect(0, 0, w, bh);
  g.drawImage(band, 0, y0);
  return c;
}

export function buildLayers({ preset, image, cw, ch, sceneW = W, sceneH, seed, subject = null, framing = {}, redGain = 1.6, whiteGain = 1.15 }) {
  const cols = Math.floor(sceneW / cw), rows = Math.floor(sceneH / ch);
  const lum = new Float32Array(cols * rows), red = new Float32Array(cols * rows);
  let rgb = null;   // source colours per cell (images and video only), used by the "original" colour mode
  let emitter;
  if (image) {
    // @scene image
    // cover-crop the image into the subject band (or the whole scene), then extend its edges
    const bh = subject ? subject.h : sceneH, by = subject ? subject.y : 0;
    let cv = makeCanvas(sceneW, bh); const c = cv.getContext("2d");
    // works for <img>, <canvas> and <video> (whose intrinsic size is videoWidth/videoHeight)
    const srcW = image.videoWidth || image.naturalWidth || image.width, srcH = image.videoHeight || image.naturalHeight || image.height;
    const s = Math.max(sceneW / srcW, bh / srcH);
    const iw = srcW * s, ih = srcH * s;
    c.drawImage(image, (sceneW - iw) / 2, (bh - ih) / 2, iw, ih);
    if (subject) cv = placeBand(cv, sceneW, sceneH, by, bh, framing);
    const d = sample(cv, cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const al = d[i * 4 + 3] / 255;   // getImageData is un-premultiplied: apply alpha so faded areas really go dark
      const r = d[i * 4] / 255 * al, g = d[i * 4 + 1] / 255 * al, b = d[i * 4 + 2] / 255 * al;
      red[i] = Math.min(1, Math.max(0, (r - Math.max(g, b)) * redGain));   // saturated reds
      lum[i] = Math.min(1, Math.min(r, g, b) * whiteGain);                 // whites/greys
      if (!rgb) rgb = new Float32Array(cols * rows * 3);
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    }
    emitter = brightestBlob(lum, cols, rows, cw, ch);
    // @end
  } else {
    const p = PRESETS[preset];
    const bh = subject ? subject.h : sceneH, by = subject ? subject.y : 0;
    let Lc = makeCanvas(sceneW, bh), Rc = makeCanvas(sceneW, bh);
    p.draw(Lc.getContext("2d"), Rc.getContext("2d"), sceneW, bh, rng(seed));
    if (subject) { Lc = placeBand(Lc, sceneW, sceneH, by, bh, framing); Rc = placeBand(Rc, sceneW, sceneH, by, bh, framing); }
    const dl = sample(Lc, cols, rows), dr = sample(Rc, cols, rows);
    for (let i = 0; i < cols * rows; i++) { lum[i] = dl[i * 4 + 3] / 255; red[i] = dr[i * 4 + 3] / 255; }
    const e = p.emitter(bh), k = sceneW / 720;   // presets are authored for 720 wide
    const z = framing.zoom || 1, cxm = sceneW / 2, cym = bh / 2;
    emitter = { x: cxm + (e.x * k - cxm) * z + (framing.panX || 0) * sceneW / 2,
      y: by + cym + (e.y - cym) * z + (framing.panY || 0) * bh / 2, spread: e.spread * k * z };
  }
  let ml = 0, mr = 0;
  for (let i = 0; i < lum.length; i++) { ml += lum[i]; mr += red[i]; }
  return { cols, rows, cw, ch, w: sceneW, h: sceneH, lum, red, rgb, emitter,
    stats: { brightness: ml / lum.length, redness: mr / red.length } };
}

function brightestBlob(lum, cols, rows, cw, ch) {
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.97)] || 0.5;
  const xs = [], ys = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    if (lum[y * cols + x] >= thr && thr > 0.05) { xs.push(x * cw); ys.push(y * ch); }
  if (!xs.length) return { x: cols * cw / 2, y: rows * ch * 0.5, spread: 60 };
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { x: xs[xs.length >> 1], y: ys[Math.floor(ys.length * 0.9)], spread: Math.max(20, sd * 0.8) };
}

// ---------- streaks (falling ash / drips) ----------
// o: count, loop, seed, lenMin, lenMax, speed (1..4 = passes per loop), emitX/emitY/emitSpread
// (0..1 of scene, or null = auto)
export function makeStreaks(L, o) {
  const r = rng(o.seed + 99), out = [], e = L.emitter;
  const ex = o.emitX == null ? e.x : o.emitX * L.w;
  const ey = o.emitY == null ? e.y : o.emitY * L.h;
  const sp = o.emitSpread == null ? e.spread : o.emitSpread * L.w / 2;
  const speeds = [1, 2, 3, 4].filter((k) => k <= Math.max(1, o.speed));
  for (let k = 0; k < o.count; k++) out.push({
    x: ex + (r() * 2 - 1) * sp,
    y0: ey + (r() - 0.5) * 60,
    len: o.lenMin + r() * Math.max(0, o.lenMax - o.lenMin),
    period: o.loop / speeds[Math.floor(r() * speeds.length)],   // divisors of loop -> seamless
    t0: r() * o.loop,
  });
  return out;
}

// ---------- render one frame ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export function renderFrame(ctx, L, S, t, o) {
  const { cols, rows, lum, red, rgb, cw, ch } = L;
  const original = o.colorMode === "original" && rgb, pal = o.colorMode === "palette" ? PALETTE_LUT[o.palette] || PALETTE_LUT.amber : null;
  let ox = o.x || 0, oy = o.y || 0;
  const loop = o.loop, dir = o.direction === "up" ? -1 : 1;
  if (o.shake) {   // film gate weave: the whole frame jumps a little; seeded by t, so the loop stays seamless
    const sr = rng(((t % loop) + loop) % loop * 7919 + 13);
    ox += (sr() - 0.5) * 2 * o.shake; oy += (sr() - 0.5) * 2 * o.shake;
  }

  // 1) streak field
  const field = new Float32Array(cols * rows);
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    const u = ((((t - s.t0) / s.period) % 1) + 1) % 1;
    const a = ease(u / 0.1) * ease((1 - u) / 0.25) * o.streakGain;
    const tip = s.y0 + dir * s.len * Math.pow(u, o.accel);
    const yA = Math.min(s.y0, tip), yB = Math.max(s.y0, tip);
    const r0 = Math.max(0, Math.floor(yA / ch)), r1 = Math.min(rows - 1, Math.floor(yB / ch));
    const span = Math.max(1, r1 - r0 + 1);
    for (let ry = r0; ry <= r1; ry++) {
      const cx = Math.round((s.x + o.wobble * Math.sin((ry * ch) / 40 + k)) / cw);
      if (cx < 0 || cx >= cols) continue;
      const along = dir > 0 ? (ry - r0) / span : (r1 - ry) / span;   // 0 at source, 1 at tip
      const v = (1 - o.fade * along) * a;
      for (let dx = 0; dx < o.thickness; dx++) {
        const c2 = cx + dx; if (c2 >= cols) break;
        const i = ry * cols + c2;
        if (v > field[i]) field[i] = v;
      }
    }
  }

  // 2) shade + glyphs
  const tint = o.tint, glyphs = o.ramp, n = glyphs.length - 1;
  const streakCol = hex(o.streakColor), bg = o.background;
  const flick = 1 - o.flicker + o.flicker * (0.5 + 0.5 * Math.sin((TAU * t / loop) * 3));
  ctx.fillStyle = bg; ctx.fillRect(ox, oy, cols * cw, rows * ch);
  ctx.font = `${o.bold ? "700 " : ""}${Math.round(ch * o.fontScale)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  const jr = rng(Math.floor(t / Math.max(1, o.jitterEvery)) + 1);   // glyph jitter changes every N frames
  const cx0 = cols / 2, cy0 = rows / 2, vr = Math.hypot(cx0, cy0);
  for (let y = 0; y < rows; y++) {
    const pulse = 1 - o.pulse + o.pulse * (0.5 + 0.5 * Math.sin(TAU * ((dir * y * ch) / o.pulseWave - (t / loop) * o.pulseSpeed)));
    const scan = o.scanlines && y % 2 ? 1 - o.scanlines : 1;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, s = field[i], l = lum[i] * o.whiteMix, rd = red[i] * pulse * o.tintMix;
      let r, g, b;
      if (original) {   // the picture's own colours (+ streaks); pulse and flicker still modulate it
        const k = (1 - o.pulse * 0.5 + o.pulse * 0.5 * pulse) * flick * o.whiteMix;
        r = rgb[i * 3] * k + s * streakCol[0]; g = rgb[i * 3 + 1] * k + s * streakCol[1]; b = rgb[i * 3 + 2] * k + s * streakCol[2];
      } else if (pal && rgb) {   // palette on a picture: map its real luminance, not just the white layer
        const k = (1 - o.pulse * 0.5 + o.pulse * 0.5 * pulse) * flick * o.whiteMix;
        r = g = b = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) * k + s;
      } else {
        r = rd * tint[0] + l + s * streakCol[0];
        g = (rd * tint[1] + l) * flick + s * streakCol[1];
        b = (rd * tint[2] + l) * flick + s * streakCol[2];
      }
      // tone: brightness, contrast, gamma, vignette
      let v = Math.max(r, g, b);
      if (v <= 0) continue;
      let tv = Math.min(1, Math.max(0, (v * o.brightness - 0.5) * o.contrast + 0.5));
      tv = Math.pow(tv, 1 / o.gamma);
      if (o.vignette) tv *= 1 - o.vignette * Math.pow(Math.hypot(x - cx0, y - cy0) / vr, 2);
      tv *= scan;
      if (o.invert) tv = 1 - tv;
      if (tv < o.threshold) continue;
      let gi = Math.min(n, Math.round(tv * n));
      if (o.jitter && jr() < o.jitter) gi = Math.max(1, Math.min(n, gi + (jr() < 0.5 ? -1 : 1)));
      const chr = glyphs[gi];
      if (chr === " ") continue;
      // colour
      let cr, cg, cb;
      if (o.colorMode === "mono") { cr = cg = cb = tv; }
      else if (pal) { const q = Math.min(255, Math.max(0, tv * 255 | 0)) * 3; cr = pal[q]; cg = pal[q + 1]; cb = pal[q + 2]; }
      else if (o.colorMode === "tint") { cr = tint[0] * tv; cg = tint[1] * tv; cb = tint[2] * tv; }
      else { const k = (0.35 + 0.65 * tv) / v; cr = r * k; cg = g * k; cb = b * k; }
      const sat = o.saturation, m = (cr + cg + cb) / 3;
      cr = m + (cr - m) * sat; cg = m + (cg - m) * sat; cb = m + (cb - m) * sat;
      ctx.fillStyle = `rgb(${Math.min(255, Math.max(0, cr * 255)) | 0},${Math.min(255, Math.max(0, cg * 255)) | 0},${Math.min(255, Math.max(0, cb * 255)) | 0})`;
      ctx.fillText(chr, ox + x * cw, oy + y * ch - 1);
    }
  }
}

// gradient maps: brightness 0..1 -> colour, stops from dark to light
export const PALETTES = {
  amber:     ["#1a0a00", "#7a3a00", "#ffb000", "#fff2c8"],
  matrix:    ["#001a05", "#00661a", "#00ff41", "#d8ffe0"],
  cyberpunk: ["#12002a", "#7a00ff", "#ff2bd6", "#00f0ff"],
  sunset:    ["#1b0a2e", "#8a1c5c", "#ff6b35", "#ffe28a"],
  ocean:     ["#00111f", "#004a7c", "#00a8e8", "#d6f6ff"],
  sepia:     ["#1e1208", "#6b4423", "#c49a6c", "#f3e5c8"],
  fireice:   ["#2a0000", "#ff3d00", "#ffffff", "#40c4ff"],
  vapor:     ["#1c0b33", "#ff71ce", "#01cdfe", "#fffb96"],
};
const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const PALETTE_LUT = Object.fromEntries(Object.entries(PALETTES).map(([k, stops]) => {
  const c = stops.map(toRgb), lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255 * (c.length - 1), j = Math.min(c.length - 2, Math.floor(x)), f = x - j;
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = c[j][ch] + (c[j + 1][ch] - c[j][ch]) * f;
  }
  return [k, lut];
}));

// default fine-tuning values (the UI and saved tabs start from these)
export const FINE_DEFAULTS = {
  cellW: 8, cellH: 8, fontScale: 1.25, bold: false,
  brightness: 1, contrast: 1, gamma: 1, threshold: 0.04, invert: false, saturation: 1,
  colorMode: "source", palette: "amber", background: "#000000", whiteMix: 1, tintMix: 1,
  streakColor: "#ffffff", thickness: 1, lenMin: 200, lenMax: 500, speed: 3, accel: 1.4,
  wobble: 4, fade: 0.7, direction: "down", emitX: null, emitY: null, emitSpread: null,
  pulseWave: 120, pulseSpeed: 2, flicker: 0.08,
  vignette: 0, scanlines: 0, jitter: 0, jitterEvery: 3, shake: 0,
};

// ---------- glyph ramps ordered by ink ----------
// A ramp must go from empty to full. For scripts like katakana nobody knows the order by heart,
// so measure how much of a cell each glyph covers in the font the browser actually uses.
const inkCache = new Map();
export function orderByInk(chars, bold = false) {
  const key = (bold ? "b|" : "") + chars;
  if (inkCache.has(key)) return inkCache.get(key);
  const s = 40, c = makeCanvas(s, s), g = c.getContext("2d", { willReadFrequently: true });
  g.font = `${bold ? "700 " : ""}32px ui-monospace, Menlo, Consolas, monospace`; g.textBaseline = "top"; g.fillStyle = "#fff";
  const glyphs = [...new Set(Array.from(chars))].filter((ch) => ch !== " ");
  const ink = new Map(glyphs.map((ch) => {
    g.clearRect(0, 0, s, s); g.fillText(ch, 4, 4);
    const d = g.getImageData(0, 0, s, s).data; let a = 0;
    for (let i = 3; i < d.length; i += 4) a += d[i];
    return [ch, a];
  }));
  const out = " " + glyphs.sort((a, b) => ink.get(a) - ink.get(b)).join("");
  inkCache.set(key, out);
  return out;
}

// scrolling source-code panel under the scene
// `chars` limits how many characters are shown (the "typing" intro), `caret` draws a block cursor after them
export const CODE_COLS = 72, CODE_LH = 20;
export function renderCode(ctx, lines, t, loop, top, bottom = H, left = 0, width = W, opacity = 1, { chars = Infinity, caret = false } = {}) {
  const h = bottom - top, lh = CODE_LH, typing = chars !== Infinity;
  if (h <= 0 || !lines.length) return;
  ctx.fillStyle = `rgba(10,10,12,${opacity})`; ctx.fillRect(left, top, width, h);
  ctx.fillStyle = "#3c1414"; ctx.fillRect(left, top, width, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, h); ctx.clip();
  ctx.font = "15px ui-monospace, Menlo, Consolas, monospace"; ctx.textBaseline = "top";
  const off = (t / loop) * lines.length * lh, first = Math.floor(off / lh);
  let budget = chars;
  for (let i = typing ? 0 : -1; i < h / lh + 2; i++) {
    const n = (((first + i) % lines.length) + lines.length) % lines.length;
    const y = top + 12 + i * lh - (off % lh), line = lines[n].slice(0, CODE_COLS), s = line.trim();
    const shown = typing ? line.slice(0, Math.max(0, budget)) : line;
    ctx.fillStyle = "#46464f"; ctx.fillText(String(n + 1).padStart(3), left + 10, y);
    ctx.fillStyle = s.startsWith("//") || s.startsWith("#") ? "#6e6e78"
      : /^(export |function |const |let |for |if |return|def |class |import |from |while )/.test(s) ? "#e65a5a" : "#c8c8cd";
    ctx.fillText(shown, left + 52, y);
    if (typing && (budget -= line.length + 1) < 0) {   // the line being typed right now
      if (caret) { ctx.fillStyle = "#e65a5a"; ctx.fillRect(left + 52 + ctx.measureText(shown).width + 1, y, 8, 16); }
      break;
    }
  }
  ctx.restore();
}

// ---------- "code first" intro ----------
// The code types itself over the whole frame, then the panel slides down into its place while
// the scene resolves out of scrambled glyphs, brightest parts first. Frame f of `frames` (30 per s).
// The last intro frame hands over to frame 0 of the loop, so intro + loop play as one shot.
export function renderIntro(ctx, L, S, f, frames, o, code, lines) {
  const u = frames > 1 ? Math.min(1, f / (frames - 1)) : 1, split = 0.55;
  const end = code || { top: H, bottom: H + CODE_LH, left: 0, width: W, opacity: 1 };   // no code panel: slide out
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (u < split) {
    const fit = lines.slice(0, Math.floor((H - 12) / CODE_LH)).reduce((a, l) => a + Math.min(CODE_COLS, l.length) + 1, 0);
    const typed = Math.round(fit * Math.min(1, u / (split * 0.85)));
    renderCode(ctx, lines, 0, 1, 0, H, 0, W, 1, { chars: typed, caret: Math.floor(f / 5) % 2 === 0 || typed < fit });
    return;
  }
  const k = ease((u - split) / (1 - split)), mix = (a, b) => a + (b - a) * k;
  const t = (((f - frames) % o.loop) + o.loop) % o.loop;
  renderFrame(ctx, L, S, t, { ...o, threshold: mix(1, o.threshold), jitter: mix(0.6, o.jitter), jitterEvery: 1 });
  renderCode(ctx, lines, 0, 1, mix(0, end.top), mix(H, end.bottom), mix(0, end.left), mix(W, end.width), mix(1, end.opacity),
    { chars: 1e9 });
}

// turn the picture into words for a music prompt
export function describeVisual(stats, o) {
  const mood = stats.brightness < 0.08 ? "very dark, ominous" : stats.brightness < 0.18 ? "dark, brooding" : "luminous, ethereal";
  const heat = stats.redness > 0.25 ? "blood-red, ritualistic tension" : stats.redness > 0.08 ? "smouldering warmth" : "cold and sparse";
  const tempo = o.loop / 30 < 5 ? "slowly pulsing" : "glacial, barely moving";
  return `Cinematic dark ambient score, ${mood}, ${heat}, ${tempo}. Low choir drones, distant bells, sub-bass swells, ` +
    `granular textures like falling ash, sacred and unsettling. No drums, loopable.`;
}
