// Local API for ASCII Reels Studio
//  POST /api/music    {prompt, lengthMs, instrumental} -> {url}   (ElevenLabs CLI, REST fallback)
//  POST /api/convert  raw webm body                    -> {url}   (ffmpeg -> mp4)
//  GET  /api/health                                    -> what is available
import "dotenv/config";
import express from "express";
import spawn from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(ROOT, "..", "media");
fs.mkdirSync(MEDIA, { recursive: true });

const PORT = Number(process.env.PORT || 8787);
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const DEFAULT_CMD = ["elevenlabs", "music", "compose", "--prompt", "{prompt}",
  "--music-length-ms", "{ms}", "--output", "{out}"];
let MUSIC_CMD = DEFAULT_CMD;
try { if (process.env.MUSIC_CMD) MUSIC_CMD = JSON.parse(process.env.MUSIC_CMD); }
catch { console.warn("MUSIC_CMD is not valid JSON, using default"); }

const app = express();
app.use("/media", express.static(MEDIA));
app.use(express.json({ limit: "1mb" }));

// run a command without a shell; resolves {code, out}
function run(cmd, args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let out = "";
    let p;
    try { p = spawn(cmd, args, { shell: false }); }
    catch (e) { return resolve({ code: -1, out: String(e) }); }
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: out + String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

app.get("/api/health", async (_req, res) => {
  const cli = await run(MUSIC_CMD[0], ["--version"], 10000);
  const ff = await run(FFMPEG, ["-version"], 10000);
  res.json({ cli: cli.code === 0, ffmpeg: ff.code === 0, apiKey: !!process.env.ELEVENLABS_API_KEY });
});

app.post("/api/music", async (req, res) => {
  const prompt = String(req.body?.prompt || "").slice(0, 2000);
  const ms = Math.max(3000, Math.min(300000, Number(req.body?.lengthMs) || 30000));
  const instrumental = req.body?.instrumental !== false;
  if (!prompt) return res.status(400).json({ error: "empty prompt" });
  const fullPrompt = instrumental ? `${prompt}. Instrumental only, no vocals.` : prompt;
  const name = `music_${Date.now()}.mp3`;
  const out = path.join(MEDIA, name);

  // 1) ElevenLabs CLI
  const args = MUSIC_CMD.slice(1).map((a) => a
    .replaceAll("{prompt}", fullPrompt)
    .replaceAll("{ms}", String(ms))
    .replaceAll("{seconds}", String(Math.round(ms / 1000)))
    .replaceAll("{out}", out));
  const r = await run(MUSIC_CMD[0], args);
  if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0)
    return res.json({ url: `/media/${name}`, via: "cli" });

  // 2) REST fallback
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) {
    try {
      const resp = await fetch("https://api.elevenlabs.io/v1/music", {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, music_length_ms: ms, force_instrumental: instrumental }),
      });
      if (resp.ok) {
        fs.writeFileSync(out, Buffer.from(await resp.arrayBuffer()));
        return res.json({ url: `/media/${name}`, via: "api" });
      }
      return res.status(502).json({ error: `API ${resp.status}: ${(await resp.text()).slice(0, 400)}`, cli: r.out.slice(-600) });
    } catch (e) {
      return res.status(502).json({ error: String(e), cli: r.out.slice(-600) });
    }
  }
  res.status(500).json({
    error: "ElevenLabs CLI failed. Check `elevenlabs auth login` and the MUSIC_CMD flags in .env (run `elevenlabs music --help`).",
    cli: r.out.slice(-600),
  });
});

app.post("/api/convert", express.raw({ type: "*/*", limit: "500mb" }), async (req, res) => {
  const id = Date.now();
  const src = path.join(MEDIA, `rec_${id}.webm`);
  const dst = path.join(MEDIA, `reel_${id}.mp4`);
  fs.writeFileSync(src, req.body);
  const r = await run(FFMPEG, ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-preset", "veryfast", "-crf", "18", "-r", "30", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", dst]);
  fs.rmSync(src, { force: true });
  if (r.code !== 0) return res.status(500).json({ error: "ffmpeg failed", log: r.out.slice(-800) });
  res.json({ url: `/media/reel_${id}.mp4` });
});

// production: serve the built app
const DIST = path.join(ROOT, "..", "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

app.listen(PORT, () => console.log(`api on http://localhost:${PORT}`));
