// ASCII engine: static layers (lum = white part, red = tint part) sampled on a
// character grid, plus animated falling streaks and a travelling pulse.
export const W = 720, H = 1280;
export const TAU = Math.PI * 2;

// Where things go on the 720x1280 canvas.
// "reels" keeps everything inside Instagram's safe zone: top ~12% is covered by
// the status bar / back button, bottom ~22% by caption + music, right ~13% by the
// action buttons, and tall phones crop a few % off both sides.
export const LAYOUTS = {
  reels: { name: "Reels safe", scene: { x: 60, y: 160, w: 560, h: 669 }, code: { top: 840, bottom: 1010 } },
  full:  { name: "Full frame", scene: { x: 0, y: 0, w: 720, h: 860 }, code: { top: 860, bottom: 1280 } },
  clean: { name: "No code",    scene: { x: 0, y: 0, w: 720, h: 1280 }, code: null },
};

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// small seeded rng so scenes are reproducible
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- built-in scenes: draw white parts on `L`, red parts on `R` ----------
export const PRESETS = {
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
};

function bokehAndEmbers(R, w, h, rnd) {
  R.filter = "blur(6px)"; R.fillStyle = "rgba(255,255,255,0.3)";
  for (let i = 0; i < 5; i++) { R.beginPath(); R.arc(rnd() * w, 80 + rnd() * (h - 160), 40 + rnd() * 40, 0, TAU); R.fill(); }
  R.filter = "none"; R.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 200; i++) R.fillRect(rnd() * w, rnd() * h, 2, 2);
}

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
export function buildLayers({ preset, image, cw, ch, sceneW = W, sceneH, seed, redGain = 1.6, whiteGain = 1.15 }) {
  const cols = Math.floor(sceneW / cw), rows = Math.floor(sceneH / ch);
  const lum = new Float32Array(cols * rows), red = new Float32Array(cols * rows);
  let emitter;
  if (image) {
    const cv = makeCanvas(sceneW, sceneH), c = cv.getContext("2d");
    const s = Math.max(sceneW / image.width, sceneH / image.height);
    const iw = image.width * s, ih = image.height * s;
    c.drawImage(image, (sceneW - iw) / 2, (sceneH - ih) / 2, iw, ih);
    const d = sample(cv, cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
      red[i] = Math.min(1, Math.max(0, (r - Math.max(g, b)) * redGain));   // saturated reds
      lum[i] = Math.min(1, Math.min(r, g, b) * whiteGain);                 // whites/greys
    }
    emitter = brightestBlob(lum, cols, rows, cw, ch);
  } else {
    const p = PRESETS[preset];
    const Lc = makeCanvas(sceneW, sceneH), Rc = makeCanvas(sceneW, sceneH);
    p.draw(Lc.getContext("2d"), Rc.getContext("2d"), sceneW, sceneH, rng(seed));
    const dl = sample(Lc, cols, rows), dr = sample(Rc, cols, rows);
    for (let i = 0; i < cols * rows; i++) { lum[i] = dl[i * 4 + 3] / 255; red[i] = dr[i * 4 + 3] / 255; }
    const e = p.emitter(sceneH), k = sceneW / 720;   // presets are authored for 720 wide
    emitter = { x: e.x * k, y: e.y, spread: e.spread * k };
  }
  let ml = 0, mr = 0;
  for (let i = 0; i < lum.length; i++) { ml += lum[i]; mr += red[i]; }
  return { cols, rows, cw, ch, w: sceneW, h: sceneH, lum, red, emitter,
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
  const { cols, rows, lum, red, cw, ch } = L;
  const ox = o.x || 0, oy = o.y || 0, loop = o.loop, dir = o.direction === "up" ? -1 : 1;

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
      let r = rd * tint[0] + l + s * streakCol[0];
      let g = (rd * tint[1] + l) * flick + s * streakCol[1];
      let b = (rd * tint[2] + l) * flick + s * streakCol[2];
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
      else if (o.colorMode === "tint") { cr = tint[0] * tv; cg = tint[1] * tv; cb = tint[2] * tv; }
      else { const k = (0.35 + 0.65 * tv) / v; cr = r * k; cg = g * k; cb = b * k; }
      const sat = o.saturation, m = (cr + cg + cb) / 3;
      cr = m + (cr - m) * sat; cg = m + (cg - m) * sat; cb = m + (cb - m) * sat;
      ctx.fillStyle = `rgb(${Math.min(255, Math.max(0, cr * 255)) | 0},${Math.min(255, Math.max(0, cg * 255)) | 0},${Math.min(255, Math.max(0, cb * 255)) | 0})`;
      ctx.fillText(chr, ox + x * cw, oy + y * ch - 1);
    }
  }
}

// default fine-tuning values (the UI and saved tabs start from these)
export const FINE_DEFAULTS = {
  cellW: 8, cellH: 8, fontScale: 1.25, bold: false,
  brightness: 1, contrast: 1, gamma: 1, threshold: 0.04, invert: false, saturation: 1,
  colorMode: "source", background: "#000000", whiteMix: 1, tintMix: 1,
  streakColor: "#ffffff", thickness: 1, lenMin: 200, lenMax: 500, speed: 3, accel: 1.4,
  wobble: 4, fade: 0.7, direction: "down", emitX: null, emitY: null, emitSpread: null,
  pulseWave: 120, pulseSpeed: 2, flicker: 0.08,
  vignette: 0, scanlines: 0, jitter: 0, jitterEvery: 3,
};

// scrolling source-code panel under the scene
export function renderCode(ctx, lines, t, loop, top, bottom = H, left = 0, width = W) {
  const h = bottom - top, lh = 20;
  ctx.fillStyle = "#0c0c0e"; ctx.fillRect(left, top, width, h);
  ctx.fillStyle = "#3c1414"; ctx.fillRect(left, top, width, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, h); ctx.clip();
  ctx.font = "15px ui-monospace, Menlo, Consolas, monospace"; ctx.textBaseline = "top";
  const off = (t / loop) * lines.length * lh, first = Math.floor(off / lh);
  for (let i = -1; i < h / lh + 2; i++) {
    const n = (((first + i) % lines.length) + lines.length) % lines.length;
    const y = top + 12 + i * lh - (off % lh), line = lines[n], s = line.trim();
    ctx.fillStyle = "#46464f"; ctx.fillText(String(n + 1).padStart(3), left + 10, y);
    ctx.fillStyle = s.startsWith("//") ? "#6e6e78"
      : /^(export |function |const |for |if |return)/.test(s) ? "#e65a5a" : "#c8c8cd";
    ctx.fillText(line.slice(0, 72), left + 52, y);
  }
  ctx.restore();
}

// turn the picture into words for a music prompt
export function describeVisual(stats, o) {
  const mood = stats.brightness < 0.08 ? "very dark, ominous" : stats.brightness < 0.18 ? "dark, brooding" : "luminous, ethereal";
  const heat = stats.redness > 0.25 ? "blood-red, ritualistic tension" : stats.redness > 0.08 ? "smouldering warmth" : "cold and sparse";
  const tempo = o.loop / 30 < 5 ? "slowly pulsing" : "glacial, barely moving";
  return `Cinematic dark ambient score, ${mood}, ${heat}, ${tempo}. Low choir drones, distant bells, sub-bass swells, ` +
    `granular textures like falling ash, sacred and unsettling. No drums, loopable.`;
}
