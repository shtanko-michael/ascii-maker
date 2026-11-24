// Local API for ASCII Reels Studio
//  POST /api/music          {prompt, lengthMs, instrumental} -> {id}     start an ElevenLabs job
//  GET  /api/music/:id      -> {state, progress, stage, elapsedMs, etaMs, url?, error?}
//  POST /api/ai             {frame (png data url), stats, settings, caption, hashtags} -> {musicPrompt, caption, hashtags}
//  POST /api/convert        raw webm body -> {url}                   (ffmpeg -> mp4)
//  GET  /api/health         -> what is available
import "dotenv/config";
import express from "express";
import spawn from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountInstagram } from "./instagram.js";
import { ngrok, setupNgrokEnv, startNgrok } from "./ngrok.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(ROOT, "..", "media");
fs.mkdirSync(path.join(MEDIA, "frames"), { recursive: true });

const PORT = Number(process.env.PORT || 8787);
setupNgrokEnv();   // fills PUBLIC_BASE_URL / IG_REDIRECT_URI from NGROK_DOMAIN before routes read them
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const parseCmd = (env, def) => {
  try { return env ? JSON.parse(env) : def; } catch { console.warn("bad command JSON, using default"); return def; }
};
// ElevenLabs CLI: the request body goes in as --json (individual flags fail validation in CLI 1.12)
const MUSIC_CMD = parseCmd(process.env.MUSIC_CMD,
  ["elevenlabs", "music", "compose", "--json", "{json}", "--output-format", "mp3_44100_128", "-o", "{out}"]);
const CLAUDE_CMD = parseCmd(process.env.CLAUDE_CMD,
  ["claude", "-p", "{prompt}", "--output-format", "json", "--allowedTools", "Read"]);
const BYTES_PER_SEC = 16000;                       // mp3 128 kbps -> expected file size
const STATS = path.join(MEDIA, "timing.json");     // learned generation speed

const app = express();
app.use("/media", express.static(MEDIA));
app.use(express.json({ limit: "20mb" }));

// run a command without a shell; resolves {code, out, err}
function run(cmd, args, { timeoutMs = 600000, cwd } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "", p;
    try { p = spawn(cmd, args, { shell: false, cwd, env: process.env }); }
    catch (e) { return resolve({ code: -1, out: "", err: String(e) }); }
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const fill = (args, vars) => args.map((a) => a.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));

app.get("/api/health", async (_req, res) => {
  const [cli, claude, ff, cf] = await Promise.all([
    run(MUSIC_CMD[0], ["--version"], { timeoutMs: 10000 }),
    run(CLAUDE_CMD[0], ["--version"], { timeoutMs: 10000 }),
    run(FFMPEG, ["-version"], { timeoutMs: 10000 }),
    run(process.env.CLOUDFLARED || "cloudflared", ["--version"], { timeoutMs: 10000 }),
  ]);
  res.json({ cli: cli.code === 0, claude: claude.code === 0, ffmpeg: ff.code === 0, cloudflared: cf.code === 0 || !!process.env.PUBLIC_BASE_URL,
    tunnel: process.env.NGROK_DOMAIN ? { kind: "ngrok", state: ngrok.state, url: process.env.PUBLIC_BASE_URL, error: ngrok.error }
      : process.env.PUBLIC_BASE_URL ? { kind: "custom", state: "online", url: process.env.PUBLIC_BASE_URL }
      : { kind: "cloudflared", state: cf.code === 0 ? "on demand" : "missing" }, apiKey: !!process.env.ELEVENLABS_API_KEY });
});

// ---------------- music jobs ----------------
const jobs = new Map();
const loadTiming = () => { try { return JSON.parse(fs.readFileSync(STATS, "utf8")); } catch { return { base: 12000, perSec: 450 }; } };

app.post("/api/music", (req, res) => {
  const prompt = String(req.body?.prompt || "").slice(0, 2000).trim();
  const ms = Math.max(3000, Math.min(300000, Number(req.body?.lengthMs) || 30000));
  const instrumental = req.body?.instrumental !== false;
  if (!prompt) return res.status(400).json({ error: "empty prompt" });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const name = `music_${id}.mp3`, out = path.join(MEDIA, name);
  const tm = loadTiming();
  const job = { id, state: "running", stage: "Sending prompt", started: Date.now(),
    estMs: tm.base + tm.perSec * (ms / 1000), expectedBytes: BYTES_PER_SEC * (ms / 1000), out, name };
  jobs.set(id, job);
  res.json({ id });
  runMusic(job, prompt, ms, instrumental);
});

async function runMusic(job, prompt, ms, instrumental) {
  const body = { prompt, music_length_ms: ms, force_instrumental: instrumental };
  const args = fill(MUSIC_CMD.slice(1), { json: JSON.stringify(body), out: job.out, ms, prompt });
  if (process.env.ELEVENLABS_API_KEY && !args.includes("--xi-api-key")) args.push("--xi-api-key", process.env.ELEVENLABS_API_KEY);
  if (process.env.ELEVENLABS_BASE_URL) args.push("--base-url", process.env.ELEVENLABS_BASE_URL);
  job.stage = "Composing";
  const r = await run(MUSIC_CMD[0], args);
  const size = fs.existsSync(job.out) ? fs.statSync(job.out).size : 0;
  if (r.code === 0 && size > 1000) return finish(job);
  job.cliError = (r.err || r.out).slice(-800);

  // REST fallback with a key
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) {
    try {
      job.stage = "Composing (REST)";
      const base = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
      const resp = await fetch(`${base}/v1/music?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (resp.ok) {
        const ws = fs.createWriteStream(job.out);            // stream so progress shows file growth
        for await (const chunk of resp.body) ws.write(chunk);
        await new Promise((r2) => ws.end(r2));
        return finish(job);
      }
      return fail(job, `ElevenLabs API ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    } catch (e) { return fail(job, String(e)); }
  }
  fail(job, "ElevenLabs CLI failed. Run `elevenlabs auth login` (or set ELEVENLABS_API_KEY in .env).");
}

function finish(job) {
  const took = Date.now() - job.started;
  // learn: blend measured speed into the estimate for next time
  const tm = loadTiming(), secs = job.expectedBytes / BYTES_PER_SEC;
  const perSec = Math.max(50, (took - tm.base) / Math.max(1, secs));
  fs.writeFileSync(STATS, JSON.stringify({ base: tm.base, perSec: tm.perSec * 0.6 + perSec * 0.4 }));
  Object.assign(job, { state: "done", stage: "Done", url: `/media/${job.name}`, finished: Date.now() });
}
function fail(job, error) { Object.assign(job, { state: "error", stage: "Failed", error, finished: Date.now() }); }

app.get("/api/music/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "unknown job" });
  const elapsed = (job.finished || Date.now()) - job.started;
  const bytes = fs.existsSync(job.out) ? fs.statSync(job.out).size : 0;
  // progress = the larger of time-based estimate (capped) and real bytes received
  const byTime = 0.92 * (1 - Math.exp(-2.2 * elapsed / job.estMs));
  const byBytes = Math.min(0.99, bytes / job.expectedBytes);
  const progress = job.state === "done" ? 1 : Math.max(byTime, byBytes);
  const stage = job.state === "running" && bytes > 0 ? "Receiving audio" : job.stage;
  res.json({ state: job.state, stage, progress, elapsedMs: elapsed,
    etaMs: job.state === "running" ? Math.max(0, job.estMs - elapsed) : 0,
    bytes, url: job.url, error: job.error, cliError: job.cliError });
});

// ---------------- Claude: music prompt + caption + hashtags ----------------
app.post("/api/ai", async (req, res) => {
  const { mode = "caption", brief = "", frame, stats = {}, settings = {}, caption = "", hashtags = [], musicSec = 30, musicPrompt = "" } = req.body || {};
  let framePath = "";
  if (typeof frame === "string" && frame.startsWith("data:image/png;base64,")) {
    framePath = path.join(MEDIA, "frames", `frame_${Date.now()}.png`);
    fs.writeFileSync(framePath, Buffer.from(frame.split(",")[1], "base64"));
  }
  const common = [
    "You help publish a looping ASCII-art animation as an Instagram Reel.",
    framePath ? `First, read the image file at ${framePath}: it is the current frame.` : "",
    `Scene stats: brightness ${(+stats.brightness || 0).toFixed(3)}, redness ${(+stats.redness || 0).toFixed(3)}.`,
    `Visual settings: ${JSON.stringify(settings).slice(0, 800)}.`,
  ];
  const hasBrief = String(brief).trim().length > 0;
  const lines = mode === "music" ? [
    ...common,
    hasBrief ? `The author's brief for the post (use its mood and meaning): """${String(brief).slice(0, 1500)}"""` : "",
    musicPrompt ? `Current music prompt draft: """${String(musicPrompt).slice(0, 800)}"""` : "",
    `Return ONLY a JSON object with one key:`,
    `"musicPrompt": an English prompt for ElevenLabs Music (genre, mood, instruments, tempo, texture) that fits the visual and the brief, instrumental, loopable, ${musicSec} s, under 400 characters.`,
  ] : hasBrief ? [
    "You write Instagram Reel captions. The author gave a BRIEF: it is the single most important input.",
    `BRIEF:\n"""${String(brief).slice(0, 2000)}"""`,
    "Rules:",
    "1. The caption is about the brief's idea, story and meaning. Develop it: a hook, 1-3 lines that deepen the idea, a closing question for comments.",
    "2. Write in the SAME language as the brief (if the brief is in Russian, write in Russian). Match its tone.",
    "3. The animation is only an illustration of the idea. Do not describe the visual or the technique (ASCII, code, glyphs, characters, render) unless the brief asks for it.",
    "4. Hashtags must match the brief's theme first; at most one may be about the art form.",
    framePath ? `You may glance at the current frame for mood only: ${framePath}` : "",
    `Return ONLY a JSON object with keys:`,
    `"caption": 2-6 short lines, no hashtags inside;`,
    `"hashtags": exactly 5 hashtags without the # sign (Instagram allows at most 5).`,
  ] : [
    ...common,
    "No brief was given; write in English and base the caption on the visual.",
    caption ? `Current caption draft (may be replaced): """${String(caption).slice(0, 1500)}"""` : "",
    `Return ONLY a JSON object with keys:`,
    `"caption": an engaging Instagram caption, 2-5 short lines, ending with a question to drive comments, no hashtags inside;`,
    `"hashtags": exactly 5 relevant hashtags without the # sign, mixing niche and broader tags (Instagram allows at most 5).`,
  ];
  console.log(`[ai] mode=${mode} brief=${hasBrief ? String(brief).length + " chars" : "none"} frame=${!!framePath}`);
  const prompt = lines.filter(Boolean).join("\n");
  const r = await run(CLAUDE_CMD[0], fill(CLAUDE_CMD.slice(1), { prompt }), { timeoutMs: 180000, cwd: MEDIA });
  if (framePath) fs.rmSync(framePath, { force: true });
  if (r.code !== 0) return res.status(500).json({ error: "Claude CLI failed. Is `claude` installed and logged in?", log: (r.err || r.out).slice(-800) });
  let text = r.out;
  try { const j = JSON.parse(r.out); text = j.result ?? j.text ?? r.out; } catch {}
  const j = extractJson(String(text)) || extractJson(r.out);
  if (!j) return res.status(500).json({ error: "Could not parse Claude's answer", log: String(text).slice(0, 800) });
  const tags = (j.hashtags || []).map((t) => String(t).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 5);
  res.json({ musicPrompt: String(j.musicPrompt || ""), caption: String(j.caption || ""), hashtags: tags, usedBrief: hasBrief, mode });
});

// find the JSON object with our keys anywhere in a model answer
function extractJson(text) {
  const end = text.lastIndexOf("}");
  for (let i = text.indexOf("{"); i !== -1 && i < end; i = text.indexOf("{", i + 1)) {
    for (let e = end; e > i; e = text.lastIndexOf("}", e - 1)) {
      try {
        const j = JSON.parse(text.slice(i, e + 1));
        if (j && (j.musicPrompt || j.caption || j.hashtags)) return j;
      } catch {}
    }
  }
  return null;
}

mountInstagram(app, { MEDIA, PORT });

// ---------------- video source: frames rendered in the browser -> mp4 (no audio) ----------------
const vjobs = new Map();
app.post("/api/vrender/start", (req, res) => {
  const fps = Math.max(1, Math.min(60, Number(req.body?.fps) || 30));
  const id = String(Date.now());
  const dir = path.join(MEDIA, `vr_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  vjobs.set(id, { dir, fps, frames: 0 });
  res.json({ id });
});
app.post("/api/vrender/:id/frame/:n", express.raw({ type: "*/*", limit: "25mb" }), (req, res) => {
  const job = vjobs.get(req.params.id), n = Number(req.params.n);
  if (!job || !Number.isInteger(n) || n < 0 || n > 200000) return res.status(400).json({ error: "bad frame" });
  fs.writeFileSync(path.join(job.dir, `${String(n).padStart(6, "0")}.jpg`), req.body);
  job.frames++;
  res.json({ ok: true });
});
app.post("/api/vrender/:id/finish", async (req, res) => {
  const id = req.params.id, job = vjobs.get(id);
  if (!job) return res.status(404).json({ error: "unknown render job" });
  const out = path.join(MEDIA, `reel_${id}.mp4`);
  const r = await run(FFMPEG, ["-y", "-framerate", String(job.fps), "-i", path.join(job.dir, "%06d.jpg"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18", "-an", "-movflags", "+faststart", out]);
  fs.rmSync(job.dir, { recursive: true, force: true });
  vjobs.delete(id);
  if (r.code !== 0) return res.status(500).json({ error: "ffmpeg failed", log: (r.err || r.out).slice(-800) });
  res.json({ url: `/media/reel_${id}.mp4`, frames: job.frames });
});

// ---------------- export ----------------
app.post("/api/convert", express.raw({ type: "*/*", limit: "500mb" }), async (req, res) => {
  const id = Date.now();
  const src = path.join(MEDIA, `rec_${id}.webm`), dst = path.join(MEDIA, `reel_${id}.mp4`);
  fs.writeFileSync(src, req.body);
  const r = await run(FFMPEG, ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-preset", "veryfast", "-crf", "18", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst]);
  fs.rmSync(src, { force: true });
  if (r.code !== 0) return res.status(500).json({ error: "ffmpeg failed", log: (r.err || r.out).slice(-800) });
  res.json({ url: `/media/reel_${id}.mp4` });
});

const DIST = path.join(ROOT, "..", "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

app.listen(PORT, () => { console.log(`api on http://localhost:${PORT}`); startNgrok(PORT); });
