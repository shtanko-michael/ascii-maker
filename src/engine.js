// ASCII engine: static layers (lum = white part, red = tint part) sampled on a
// character grid, plus animated falling streaks and a travelling pulse.
export const W = 720, H = 1280;
export const TAU = Math.PI * 2;

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// small seeded rng so scenes are reproducible
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- built-in scenes: draw white parts on `L`, red parts on `R` ----------
export const PRESETS = {
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

export function buildLayers({ preset, image, cell, sceneH, seed }) {
  const cols = Math.floor(W / cell), rows = Math.floor(sceneH / cell);
  const lum = new Float32Array(cols * rows), red = new Float32Array(cols * rows);
  let emitter;
  if (image) {
    const cv = makeCanvas(W, sceneH), c = cv.getContext("2d");
    const s = Math.max(W / image.width, sceneH / image.height);
    const iw = image.width * s, ih = image.height * s;
    c.drawImage(image, (W - iw) / 2, (sceneH - ih) / 2, iw, ih);
    const d = sample(cv, cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
      red[i] = Math.min(1, Math.max(0, (r - Math.max(g, b)) * 1.6));     // saturated reds
      lum[i] = Math.min(1, Math.min(r, g, b) * 1.15);                    // whites/greys
    }
    emitter = brightestBlob(lum, cols, rows, cell);
  } else {
    const p = PRESETS[preset];
    const Lc = makeCanvas(W, sceneH), Rc = makeCanvas(W, sceneH);
    p.draw(Lc.getContext("2d"), Rc.getContext("2d"), W, sceneH, rng(seed));
    const dl = sample(Lc, cols, rows), dr = sample(Rc, cols, rows);
    for (let i = 0; i < cols * rows; i++) { lum[i] = dl[i * 4 + 3] / 255; red[i] = dr[i * 4 + 3] / 255; }
    emitter = p.emitter(sceneH);
  }
  // mean brightness / redness, used to suggest a music prompt
  let ml = 0, mr = 0;
  for (let i = 0; i < lum.length; i++) { ml += lum[i]; mr += red[i]; }
  return { cols, rows, lum, red, emitter, stats: { brightness: ml / lum.length, redness: mr / red.length } };
}

function brightestBlob(lum, cols, rows, cell) {
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.97)] || 0.5;
  const xs = [], ys = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    if (lum[y * cols + x] >= thr && thr > 0.05) { xs.push(x * cell); ys.push(y * cell); }
  if (!xs.length) return { x: W / 2, y: rows * cell * 0.5, spread: 60 };
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { x: xs[xs.length >> 1], y: ys[Math.floor(ys.length * 0.9)], spread: Math.max(20, sd * 0.8) };
}

// ---------- streaks (falling ash / drips) ----------
export function makeStreaks({ count, loop, emitter, seed }) {
  const r = rng(seed + 99), out = [];
  for (let k = 0; k < count; k++) out.push({
    x: emitter.x + (r() * 2 - 1) * emitter.spread,
    y0: emitter.y + (r() - 0.5) * 60,
    len: 200 + r() * 300,
    period: loop / [1, 2, 3][Math.floor(r() * 3)],     // divisors of loop -> seamless
    t0: r() * loop,
  });
  return out;
}

// ---------- render one frame ----------
export function renderFrame(ctx, L, S, t, o) {
  const { cols, rows, lum, red } = L, cell = o.cell;
  const field = new Float32Array(cols * rows);
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    const u = ((((t - s.t0) / s.period) % 1) + 1) % 1;
    const a = ease(u / 0.1) * ease((1 - u) / 0.25) * o.streakGain;
    const tip = s.y0 + s.len * Math.pow(u, 1.4);
    const r0 = Math.max(0, Math.floor(s.y0 / cell)), r1 = Math.min(rows - 1, Math.floor(tip / cell));
    for (let ry = r0; ry <= r1; ry++) {
      const cx = Math.round((s.x + 4 * Math.sin((ry * cell) / 40 + k)) / cell);
      if (cx < 0 || cx >= cols) continue;
      const v = (1 - 0.7 * (ry - r0) / Math.max(1, r1 - r0 + 1)) * a;
      const i = ry * cols + cx;
      if (v > field[i]) field[i] = v;
    }
  }
  const tint = o.tint, glyphs = o.ramp, n = glyphs.length - 1;
  const flick = 0.92 + 0.08 * Math.sin((TAU * t / o.loop) * 3);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, rows * cell);
  ctx.font = `${Math.round(cell * 1.25)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  for (let y = 0; y < rows; y++) {
    const pulse = 1 - o.pulse + o.pulse * (0.5 + 0.5 * Math.sin(TAU * ((y * cell) / 120 - (t / o.loop) * 2)));
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, s = field[i], l = lum[i], rd = red[i] * pulse;
      const r = Math.min(1, rd * tint[0] + l + s);
      const g = Math.min(1, (rd * tint[1] + l) * flick + s);
      const b = Math.min(1, (rd * tint[2] + l) * flick + s);
      const v = Math.max(r, g, b);
      if (v < 0.04) continue;
      const ch = glyphs[Math.min(n, Math.round(v * n))];
      if (ch === " ") continue;
      const k = (0.35 + 0.65 * v) / v * 255;
      ctx.fillStyle = `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`;
      ctx.fillText(ch, x * cell, y * cell - 1);
    }
  }
}

// scrolling source-code panel under the scene
export function renderCode(ctx, lines, t, loop, top) {
  const h = H - top, lh = 20;
  ctx.fillStyle = "#0c0c0e"; ctx.fillRect(0, top, W, h);
  ctx.fillStyle = "#3c1414"; ctx.fillRect(0, top, W, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, h); ctx.clip();
  ctx.font = "15px ui-monospace, Menlo, Consolas, monospace"; ctx.textBaseline = "top";
  const off = (t / loop) * lines.length * lh, first = Math.floor(off / lh);
  for (let i = -1; i < h / lh + 2; i++) {
    const n = (((first + i) % lines.length) + lines.length) % lines.length;
    const y = top + 12 + i * lh - (off % lh), line = lines[n], s = line.trim();
    ctx.fillStyle = "#46464f"; ctx.fillText(String(n + 1).padStart(3), 10, y);
    ctx.fillStyle = s.startsWith("//") ? "#6e6e78"
      : /^(export |function |const |for |if |return)/.test(s) ? "#e65a5a" : "#c8c8cd";
    ctx.fillText(line.slice(0, 72), 52, y);
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
