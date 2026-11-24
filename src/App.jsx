import React, { useEffect, useMemo, useRef, useState } from "react";
import { W, H, LAYOUTS, LAYOUT_KEYS, PRESETS, FINE_DEFAULTS, buildLayers, makeStreaks, renderFrame, renderCode, renderIntro,
  sceneCode, orderByInk, describeVisual } from "./engine.js";
import { loadTabs, saveTabs, newProject, putBlob, getBlob, delBlob, shrinkImage, blobToImage } from "./store.js";
import engineSource from "./engine.js?raw";
import pythonSource from "../python/crucifix.py?raw";

const toLines = (src) => src.split("\n").filter((l) => l.trim());
// what the code panel shows: the code of the scene on screen, the whole engine, the Python renderer or your own text
const CODE_SOURCES = { scene: "This scene", engine: "Whole engine", python: "Python renderer", custom: "My code" };
function codeLinesFor(p) {
  if (p.codeSource === "engine") return toLines(engineSource);
  if (p.codeSource === "python") return toLines(pythonSource);
  if (p.codeSource === "custom") return p.codeText?.trim() ? toLines(p.codeText) : ["// paste your code in Layout → Code in panel"];
  const key = p.hasImage || p.hasVideo ? "image" : p.preset;
  return toLines(sceneCode(engineSource, key) || engineSource);
}
const RAMPS = {
  classic: " .,:;-=+*cox%#@",
  blocks: " ░▒▓█",
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  binary: " 01",
  dots: " ·•●",
  katakana: " ･ｰｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ",
  lines: " .-=≡#",
};
const INK_SORTED = new Set(["katakana"]);   // ramps sorted at runtime by how much ink each glyph has
const rampFor = (key, bold) => { const r = RAMPS[key] || RAMPS.classic; return INK_SORTED.has(key) ? orderByInk(r, bold) : r; };
const TINTS = { blood: [1, 0.06, 0.06], ember: [1, 0.45, 0.1], toxic: [0.3, 1, 0.3], ice: [0.3, 0.6, 1], violet: [0.7, 0.3, 1], gold: [1, 0.8, 0.3], mono: [0.6, 0.6, 0.6] };
const SUGGESTED = ["asciiart", "generativeart", "creativecoding", "codeart", "darkart", "proceduralart", "glitchart",
  "digitalart", "surrealart", "newmediaart", "algorithmicart", "textart", "loopanimation", "javascript", "dailyart"];
const MAX_TAGS = 5;
const FINE_KEYS = Object.keys(FINE_DEFAULTS);

export default function App() {
  const [state, setState] = useState(loadTabs);
  const p = state.tabs.find((t) => t.id === state.active) || state.tabs[0];
  const [saved, setSaved] = useState("saved");
  const [renaming, setRenaming] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState("reels");
  const [guides, setGuides] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [health, setHealth] = useState(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState("");
  const [jobs, setJobs] = useState({});          // tabId -> music job progress
  const [ai, setAi] = useState({});              // "tabId:mode" -> {started}
  const [aiErr, setAiErr] = useState({});
  const [aiNote, setAiNote] = useState({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [ig, setIg] = useState({ accounts: [] });  // connected Instagram accounts
  const [igJobs, setIgJobs] = useState({});      // tabId -> publish progress
  const [queue, setQueue] = useState([]);
  const [tokenInput, setTokenInput] = useState("");
  const [showAccounts, setShowAccounts] = useState(false);
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16));
  const [, bump] = useState(0);

  const canvasRef = useRef(null), audioRef = useRef(null), tRef = useRef(0);
  const introRef = useRef(-1);   // frame of the "code first" intro, -1 = intro is not playing
  const images = useRef(new Map()), audios = useRef(new Map()), graphs = useRef(new WeakMap());
  const videos = useRef(new Map()), videoRef = useRef(null);   // tabId -> object URL of the source video

  // ---------- tab state helpers ----------
  const updateTab = (id, patch) => setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)) }));
  const set = (patch) => updateTab(p.id, patch);
  const field = (k) => (v) => set({ [k]: v });

  // autosave, debounced
  useEffect(() => {
    setSaved("saving…");
    const h = setTimeout(() => setSaved(saveTabs(state) ? "saved" : "not saved (storage full)"), 400);
    return () => clearTimeout(h);
  }, [state]);

  // lazy-load the tab's image and uploaded audio from IndexedDB
  useEffect(() => {
    const id = p.id;
    if (p.hasImage && !images.current.has(id))
      getBlob(`img:${id}`).then((b) => b && blobToImage(b)).then((img) => { if (img) { images.current.set(id, img); bump((x) => x + 1); } });
    if (p.musicBlob && !audios.current.has(id))
      getBlob(`aud:${id}`).then((b) => { if (b) { audios.current.set(id, URL.createObjectURL(b)); bump((x) => x + 1); } });
    if (p.hasVideo && !videos.current.has(id))
      getBlob(`vid:${id}`).then((b) => { if (b) { videos.current.set(id, URL.createObjectURL(b)); bump((x) => x + 1); } });
  }, [p.id, p.hasImage, p.musicBlob, p.hasVideo]);

  useEffect(() => { fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(false)); }, []);

  // Instagram accounts + queue, refreshed on focus and every 15 s
  const loadIg = () => {
    fetch("/api/ig/accounts").then((r) => r.json()).then(setIg).catch(() => {});
    fetch("/api/ig/queue").then((r) => r.json()).then(setQueue).catch(() => {});
  };
  useEffect(() => {
    loadIg(); const h = setInterval(loadIg, 15000);
    window.addEventListener("focus", loadIg);
    return () => { clearInterval(h); window.removeEventListener("focus", loadIg); };
  }, []);

  const image = p.hasImage ? images.current.get(p.id) || null : null;
  const videoUrl = p.hasVideo ? videos.current.get(p.id) || null : null;
  const [videoReady, setVideoReady] = useState(0);   // bumps when the <video> has a frame
  const musicUrl = p.musicBlob ? audios.current.get(p.id) || null : p.musicUrl;

  // ---------- engine ----------
  // layout comes from the tab's own values (the layout buttons are presets for them)
  const loop = p.loopSec * 30, box = { x: 0, y: 0, w: W, h: H };
  const subject = { y: Math.round(p.subjectY), h: Math.round(Math.max(120, Math.min(H - p.subjectY, p.subjectH))) };
  const codeW = p.codeFull ? W : 588, codeX = p.codeFull ? 0 : 28;
  const code = p.showCode ? { top: p.codeY, bottom: Math.min(H, p.codeY + p.codeH), left: codeX, width: codeW, opacity: p.codeOpacity } : null;
  // build layers from any source; video frames are rebuilt every frame
  const buildFrom = (src) => buildLayers({ preset: p.preset, image: src, cw: p.cellW, ch: p.cellH, sceneW: box.w, sceneH: box.h,
    seed: p.seed, subject, framing: { zoom: p.zoom, panX: p.panX, panY: p.panY } });
  const vidEl = p.hasVideo && videoReady ? videoRef.current : null;
  const layers = useMemo(
    () => buildFrom(vidEl || image),
    [p.preset, image, vidEl, videoReady, p.cellW, p.cellH, p.seed, subject.y, subject.h, p.zoom, p.panX, p.panY]
  );
  const streakList = useMemo(
    () => makeStreaks(layers, { count: p.streaks, loop, seed: p.seed, lenMin: p.lenMin, lenMax: p.lenMax, speed: p.speed,
      emitX: p.emitX, emitY: p.emitY, emitSpread: p.emitSpread }),
    [layers, p.streaks, loop, p.seed, p.lenMin, p.lenMax, p.speed, p.emitX, p.emitY, p.emitSpread]
  );
  const codeLines = useMemo(() => codeLinesFor(p), [p.codeSource, p.codeText, p.preset, p.hasImage, p.hasVideo]);
  const introFrames = Math.round((p.introSec || 0) * 30);
  const opts = { ...Object.fromEntries(FINE_KEYS.map((k) => [k, p[k]])), ramp: rampFor(p.ramp, p.bold),
    tint: TINTS[p.tint] || TINTS.blood, streakGain: p.streakGain, pulse: p.pulse, loop, x: box.x, y: box.y };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let raf, last = performance.now();
    const draw = () => {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      const v = videoRef.current;
      const L = p.hasVideo && v && v.readyState >= 2 ? buildFrom(v) : layers;   // live video: fresh frame each tick
      if (introRef.current >= 0) return renderIntro(ctx, L, streakList, introRef.current, introFrames, opts, code, codeLines);
      renderFrame(ctx, L, streakList, tRef.current, opts);
      if (code) renderCode(ctx, codeLines, tRef.current, loop, code.top, code.bottom, code.left, code.width, code.opacity);
    };
    const tick = (now) => {
      if (playing && now - last >= 1000 / 30) {
        last = now;
        if (introRef.current >= 0) { if (++introRef.current >= introFrames) { introRef.current = -1; tRef.current = 0; } }
        else tRef.current = (tRef.current + 1) % loop;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    draw(); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // play the intro once whenever it is switched on or its length changes
  const playIntro = () => { introRef.current = introFrames > 0 ? 0 : -1; tRef.current = 0; };
  useEffect(playIntro, [p.id, introFrames]);

  useEffect(() => {
    const v = videoRef.current; if (!v || !videoUrl || busy === "video") return;
    playing ? v.play().catch(() => {}) : v.pause();
  }, [playing, videoUrl, busy]);

  useEffect(() => {
    const a = audioRef.current; if (!a || !musicUrl) return;
    playing ? a.play().catch(() => {}) : a.pause();
  }, [playing, musicUrl, p.id]);

  // ---------- tabs ----------
  const addTab = (from) => {
    const t = from ? { ...from, id: newProject().id, name: from.name + " copy", hasImage: false, hasVideo: false, musicBlob: false } : newProject(`Scene ${state.tabs.length + 1}`);
    if (from?.hasImage) getBlob(`img:${from.id}`).then((b) => b && putBlob(`img:${t.id}`, b).then(() => updateTab(t.id, { hasImage: true })));
    if (from?.hasVideo) getBlob(`vid:${from.id}`).then((b) => b && putBlob(`vid:${t.id}`, b).then(() => updateTab(t.id, { hasVideo: true })));
    setState((s) => ({ tabs: [...s.tabs, t], active: t.id }));
  };
  const closeTab = (id) => {
    if (state.tabs.length === 1) return;
    delBlob(`img:${id}`); delBlob(`aud:${id}`); delBlob(`vid:${id}`);
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id), tabs = s.tabs.filter((t) => t.id !== id);
      return { tabs, active: s.active === id ? tabs[Math.max(0, i - 1)].id : s.active };
    });
  };

  // every visual setting back to the defaults of a new project (source, texts and music are kept)
  const VISUAL_KEYS = ["layout", ...LAYOUT_KEYS, "seed", "ramp", "tint", "streaks", "streakGain", "pulse", "loopSec", "codeSource", "introSec", ...FINE_KEYS];
  const resetVisual = () => { const d = newProject(); set(Object.fromEntries(VISUAL_KEYS.map((k) => [k, d[k]]))); };

  // ---------- inputs ----------
  const onImage = async (f) => {
    if (!f) return;
    const blob = await shrinkImage(f), id = p.id;
    await putBlob(`img:${id}`, blob);
    images.current.set(id, await blobToImage(blob));
    updateTab(id, { hasImage: true, hasVideo: false });
  };
  const onVideo = async (f) => {
    if (!f) return;
    const id = p.id;
    await putBlob(`vid:${id}`, f);
    const old = videos.current.get(id); if (old) URL.revokeObjectURL(old);
    videos.current.set(id, URL.createObjectURL(f));
    setVideoReady(0);
    updateTab(id, { hasVideo: true, hasImage: false, videoName: f.name });
  };
  const onAudio = async (f) => {
    if (!f) return;
    const id = p.id;
    await putBlob(`aud:${id}`, f);
    audios.current.set(id, URL.createObjectURL(f));
    updateTab(id, { musicBlob: true, musicName: f.name });
  };
  const addTag = (t) => {
    t = t.replace(/^#/, "").trim().replace(/\s+/g, "");
    if (t && !p.tags.includes(t) && p.tags.length < MAX_TAGS) set({ tags: [...p.tags, t] });
  };
  const fullText = `${p.caption}\n\n${p.tags.map((t) => "#" + t).join(" ")}`;

  // ---------- music job with progress ----------
  async function generateMusic() {
    const id = p.id, prompt = p.prompt || describeVisual(layers.stats, opts);
    setJobs((j) => ({ ...j, [id]: { progress: 0, stage: "Starting", elapsedMs: 0, etaMs: 0, state: "running" } }));
    try {
      const r = await fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, lengthMs: p.musicSec * 1000, instrumental: p.instrumental }) });
      const { id: jobId, error } = await r.json();
      if (!r.ok) throw new Error(error);
      for (;;) {
        await new Promise((res) => setTimeout(res, 500));
        const s = await (await fetch(`/api/music/${jobId}`)).json();
        setJobs((j) => ({ ...j, [id]: s }));
        if (s.state === "done") {
          updateTab(id, { musicUrl: s.url, musicBlob: false, musicName: `ElevenLabs · ${prompt.split(/[,.]/)[0].slice(0, 40)}`, prompt });
          setTimeout(() => setJobs((j) => { const n = { ...j }; delete n[id]; return n; }), 2500);
          return;
        }
        if (s.state === "error") throw new Error(`${s.error}${s.cliError ? "\n\nCLI: " + s.cliError : ""}`);
      }
    } catch (e) {
      setJobs((j) => ({ ...j, [id]: { state: "error", progress: 0, stage: "Failed", error: String(e.message || e) } }));
    }
  }

  // ---------- Claude: caption + hashtags (from the brief) or music prompt ----------
  async function askClaude(mode) {
    const id = p.id, key = `${id}:${mode}`;
    setAi((a) => ({ ...a, [key]: { started: Date.now() } }));
    try {
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, brief: p.brief, frame: canvasRef.current.toDataURL("image/png"), stats: layers.stats,
          settings: { preset: p.hasImage ? "custom image" : p.preset, tint: p.tint, glyphs: p.ramp, loopSec: p.loopSec, direction: p.direction },
          caption: p.caption, hashtags: p.tags, musicSec: p.musicSec, musicPrompt: p.prompt }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`${j.error}\n${j.log || ""}`);
      const patch = {};
      if (mode === "music" && j.musicPrompt) patch.prompt = j.musicPrompt;
      if (mode === "caption" && j.caption) patch.caption = j.caption;
      if (mode === "caption" && j.hashtags?.length) patch.tags = j.hashtags.slice(0, MAX_TAGS);
      updateTab(id, patch);
      setAiErr((e) => ({ ...e, [key]: null }));
      if (mode === "caption") setAiNote((n) => ({ ...n, [id]: j.usedBrief ? "✓ Written from your brief" : p.brief?.trim()
        ? "⚠ The server ignored the brief — restart it (close the window and run start-ascii-maker.cmd again)" : "No brief: written from the frame" }));
    } catch (e) { setAiErr((x) => ({ ...x, [key]: String(e.message || e) })); }
    setAi((a) => { const n = { ...a }; delete n[key]; return n; });
  }

  // ---------- export ----------
  // record the canvas (+ music) for one loop or the music length; onProgress(0..1)
  async function recordWebm(onProgress = () => {}) {
    const stream = canvasRef.current.captureStream(30), el = audioRef.current;
    if (musicUrl && el) {
      let g = graphs.current.get(el);   // an <audio> can be wired to Web Audio only once
      if (!g) {
        const actx = new AudioContext(), src = actx.createMediaElementSource(el), dst = actx.createMediaStreamDestination();
        src.connect(dst); src.connect(actx.destination); g = { actx, dst }; graphs.current.set(el, g);
      }
      await g.actx.resume();
      g.dst.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      el.currentTime = 0; el.play().catch(() => {});
    }
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    playIntro(); setPlaying(true); rec.start();
    const total = (Math.max(p.loopSec, musicUrl ? Math.min(p.musicSec, 90) : p.loopSec < 15 ? p.loopSec * 2 : p.loopSec) + (p.introSec || 0)) * 1000, t0 = Date.now();
    while (Date.now() - t0 < total) { onProgress((Date.now() - t0) / total); await new Promise((r) => setTimeout(r, 250)); }
    rec.stop(); await done;
    return new Blob(chunks, { type: "video/webm" });
  }
  async function toMp4(blob) {
    const r = await fetch("/api/convert", { method: "POST", body: blob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "ffmpeg failed");
    return j.url;                       // "/media/reel_<n>.mp4"
  }

  // ---------- video source: frame-by-frame conversion (audio is dropped) ----------
  const seek = (v, t) => new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
    v.addEventListener("seeked", () => res(), { once: true });
    v.currentTime = t;
  });
  async function convertVideo(onProgress = () => {}) {
    const v = videoRef.current;
    if (!v || !v.duration) throw new Error("The video is not loaded yet");
    setBusy("video"); setPlaying(false); v.pause();
    const fps = p.videoFps, dur = Math.min(v.duration, p.videoMax), ni = Math.round((p.introSec || 0) * fps);
    const n = ni + Math.max(1, Math.floor(dur * fps));   // intro frames (on the first video frame), then the video
    const r = await fetch("/api/vrender/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fps }) });
    const { id, error } = await r.json();
    if (!r.ok) throw new Error(error);
    const cv = canvasRef.current, ctx = cv.getContext("2d"), pending = [], t0 = Date.now();
    try {
      for (let i = 0; i < n; i++) {
        await seek(v, Math.max(0, i - ni) / fps);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        const tt = Math.round(Math.max(0, i - ni) * 30 / fps);   // engine time runs at 30 ticks per second
        if (i < ni) renderIntro(ctx, buildFrom(v), streakList, Math.round(i * 30 / fps), introFrames, opts, code, codeLines);
        else {
          renderFrame(ctx, buildFrom(v), streakList, tt, opts);
          if (code) renderCode(ctx, codeLines, tt, loop, code.top, code.bottom, code.left, code.width, code.opacity);
        }
        const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.92));
        pending.push(fetch(`/api/vrender/${id}/frame/${i}`, { method: "POST", body: blob }).then((x) => { if (!x.ok) throw new Error("frame upload failed"); }));
        if (pending.length >= 6) await pending.shift();
        const el = (Date.now() - t0) / 1000;
        onProgress((i + 1) / n * 0.95, `Frame ${i + 1} / ${n}`, el / (i + 1) * (n - i - 1));
      }
      await Promise.all(pending);
      onProgress(0.97, "Encoding MP4", 0);
      const f = await fetch(`/api/vrender/${id}/finish`, { method: "POST" });
      const j = await f.json();
      if (!f.ok) throw new Error(`${j.error}\n${j.log || ""}`);
      return j.url;
    } finally { setBusy(""); setPlaying(true); }
  }

  // one place that produces the reel MP4 on the server, for export and for publishing
  async function makeReelMp4(onProgress = () => {}) {
    if (p.hasVideo) return convertVideo(onProgress);
    const blob = await recordWebm((f) => onProgress(f * 0.9, "Recording"));
    onProgress(0.92, "Converting to MP4");
    return toMp4(blob);
  }

  const [conv, setConv] = useState(null);   // export / conversion progress
  async function exportVideo() {
    setBusy((b) => b || "export"); setLog("");
    try {
      let url, name = `${p.name || "reel"}.mp4`;
      if (p.hasVideo || health?.ffmpeg) {
        url = await makeReelMp4((progress, stage, eta) => setConv({ progress, stage, eta }));
      } else {
        url = URL.createObjectURL(await recordWebm((f) => setConv({ progress: f, stage: "Recording" }))); name = `${p.name || "reel"}.webm`;
      }
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setLog(`Saved ${name}`);
    } catch (e) { setLog(String(e.message || e)); }
    setConv(null); setBusy("");
  }

  // ---------- Instagram ----------
  // accounts are global (stored on the server); each tab only keeps the list of targets it posts to
  const chosen = p.igTargets ?? (p.igAccount ? [p.igAccount] : []);
  const targets = ig.accounts.filter((a) => chosen.includes(a.id));
  const toggleTarget = (accId) => set({ igTargets: chosen.includes(accId) ? chosen.filter((x) => x !== accId) : [...chosen, accId] });
  const setIgJob = (id, v) => setIgJobs((j) => ({ ...j, [id]: v && { ...(j[id] || {}), ...v } }));

  async function addToken() {
    const r = await fetch("/api/ig/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenInput }) });
    const j = await r.json();
    if (!r.ok) return setLog(`Instagram: ${j.error}`);
    setTokenInput(""); setLog(`Connected @${j.username}`); loadIg();
  }
  async function removeAccount(id) { await fetch(`/api/ig/accounts/${id}`, { method: "DELETE" }); loadIg(); }

  // record once -> mp4 once -> publish to every chosen account (one after another), or queue them
  async function publishReel(scheduleAt) {
    const id = p.id, accs = targets;
    if (!accs.length) return setLog("Choose at least one account to post to");
    const base = { caption: fullText, aiLabel: p.aiLabel, title: p.name };
    const results = [];
    try {
      setIgJob(id, { state: "running", stage: p.hasVideo ? "Converting video" : "Recording", progress: 0, results: [] });
      const video = await makeReelMp4((f, stage) => setIgJob(id, { progress: f * 0.33, stage: stage || "Recording" }));
      if (scheduleAt) {
        for (const acc of accs) {
          const r = await fetch("/api/ig/queue", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, video, accountId: acc.id, publishAt: new Date(scheduleAt).toISOString() }) });
          const j = await r.json();
          results.push(r.ok ? { username: acc.username, ok: true } : { username: acc.username, error: j.error });
        }
        const failed = results.filter((x) => x.error);
        setIgJob(id, { state: failed.length ? "error" : "done", progress: 1, results,
          stage: `Scheduled for ${new Date(scheduleAt).toLocaleString()}`,
          error: failed.map((x) => `@${x.username}: ${x.error}`).join("\n") || undefined });
        loadIg(); return;
      }
      for (let k = 0; k < accs.length; k++) {
        const acc = accs[k], span = 0.65 / accs.length, from = 0.35 + k * span;
        try {
          const r = await fetch("/api/ig/publish", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, video, accountId: acc.id }) });
          const { id: jobId, error } = await r.json();
          if (!r.ok) throw new Error(error);
          for (;;) {
            await new Promise((res) => setTimeout(res, 1000));
            const s = await (await fetch(`/api/ig/publish/${jobId}`)).json();
            setIgJob(id, { stage: `@${acc.username}: ${s.stage}`, progress: from + span * s.progress, elapsedMs: s.elapsedMs });
            if (s.state === "done") { results.push({ username: acc.username, permalink: s.permalink }); break; }
            if (s.state === "error") throw new Error(s.error);
          }
        } catch (e) { results.push({ username: acc.username, error: String(e.message || e) }); }
        setIgJob(id, { results: [...results] });
      }
      const failed = results.filter((x) => x.error);
      setIgJob(id, { state: failed.length === results.length ? "error" : "done", progress: 1,
        stage: failed.length ? `Published ${results.length - failed.length} of ${results.length}` : "Published", results,
        error: failed.length ? failed.map((x) => `@${x.username}: ${x.error}`).join("\n") : undefined });
      loadIg();
    } catch (e) { setIgJob(id, { state: "error", stage: "Failed", error: String(e.message || e), results }); }
  }

  const job = jobs[p.id], capJob = ai[`${p.id}:caption`], musJob = ai[`${p.id}:music`], igJob = igJobs[p.id];

  // ---------- UI ----------
  return (
    <div className="app">
      <aside className="panel">
        <h1>ASCII <span>Reels</span> Studio</h1>

        <Section title="Source">
          <div className="row">
            {Object.entries(PRESETS).map(([k, pr]) => (
              <button key={k} className={!p.hasImage && !p.hasVideo && p.preset === k ? "on" : ""} onClick={() => set({ hasImage: false, hasVideo: false, preset: k })}>{pr.name}</button>
            ))}
          </div>
          <label className="drop">
            <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files[0])} />
            {p.hasImage ? "✓ Your image — click to replace" : "Upload your image (JPG/PNG)"}
          </label>
          <label className="drop">
            <input type="file" accept="video/*" onChange={(e) => onVideo(e.target.files[0])} />
            {p.hasVideo ? `✓ ${p.videoName || "Your video"} — click to replace` : "Upload a video (MP4/MOV/WebM)"}
          </label>
          {p.hasVideo && <>
            <p className="hint">Sound is dropped. Every frame is converted at export.</p>
            <Select label="Output fps" v={String(p.videoFps)} set={(v) => set({ videoFps: Number(v) })} opts={["24", "25", "30", "60"]} />
            <Slider label="Max length, s" v={p.videoMax} set={field("videoMax")} min={1} max={180} />
          </>}
          {videoUrl && <video key={videoUrl} ref={videoRef} src={videoUrl} muted playsInline loop preload="auto" style={{ display: "none" }}
            onLoadedData={() => setVideoReady((x) => x + 1)} />}
        </Section>

        <Section title="Layout">
          <div className="row">
            {Object.entries(LAYOUTS).map(([k, l]) => (
              <button key={k} className={p.layout === k ? "on" : ""} onClick={() => { const { name, ...v } = l; set({ layout: k, ...v }); }}>{l.name}</button>
            ))}
          </div>
          <Toggle label="Show Instagram safe zones" v={guides} set={setGuides} />
          <Select label="Code in panel" v={p.codeSource} set={field("codeSource")} opts={Object.keys(CODE_SOURCES)} names={CODE_SOURCES} />
          {p.codeSource === "custom" && <textarea rows={5} className="code" value={p.codeText} spellCheck={false}
            placeholder="Paste the code to scroll in the panel" onChange={(e) => set({ codeText: e.target.value })} />}
          <Slider label="Intro: code first, s" v={p.introSec} set={field("introSec")} min={0} max={4} step={0.5} />
          {p.introSec > 0 && <div className="row">
            <button onClick={() => { playIntro(); setPlaying(true); }}>▶ Replay intro</button>
          </div>}
          {p.introSec > 0 && <p className="hint">The code types over the whole frame, then slides down while the scene resolves. Export and publishing start with it.</p>}
        </Section>

        <Section title="Look">
          <Select label="Glyphs" v={p.ramp} set={field("ramp")} opts={Object.keys(RAMPS)} />
          <Select label="Tint" v={p.tint} set={field("tint")} opts={Object.keys(TINTS)} />
          <Slider label="Streaks" v={p.streaks} set={field("streaks")} min={0} max={300} />
          <Slider label="Streak glow" v={p.streakGain} set={field("streakGain")} min={0} max={1.5} step={0.05} />
          <Slider label="Pulse" v={p.pulse} set={field("pulse")} min={0} max={1} step={0.05} />
          <Slider label="Loop, s" v={p.loopSec} set={field("loopSec")} min={2} max={60} />
          <div className="row">
            <button onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })}>🎲 Reseed</button>
            <button onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          </div>
        </Section>

        <Group title="Layout: background & code">
          <p className="hint">Background / subject band</p>
          <Slider label="Band top" v={p.subjectY} set={(v) => set({ subjectY: v, layout: "custom" })} min={0} max={900} step={4} />
          <Slider label="Band height" v={p.subjectH} set={(v) => set({ subjectH: v, layout: "custom" })} min={200} max={1280} step={4} />
          <Slider label="Zoom" v={p.zoom} set={field("zoom")} min={0.5} max={3} step={0.05} />
          <Slider label="Shift X" v={p.panX} set={field("panX")} min={-1} max={1} step={0.01} />
          <Slider label="Shift Y" v={p.panY} set={field("panY")} min={-1} max={1} step={0.01} />
          <p className="hint">Code panel</p>
          <Toggle label="Show code" v={p.showCode} set={(v) => set({ showCode: v, layout: "custom" })} />
          {p.showCode && <>
            <Slider label="Code top" v={p.codeY} set={(v) => set({ codeY: v, layout: "custom" })} min={0} max={1240} step={4} />
            <Slider label="Code height" v={p.codeH} set={(v) => set({ codeH: v, layout: "custom" })} min={40} max={700} step={4} />
            <Slider label="Panel opacity" v={p.codeOpacity} set={field("codeOpacity")} min={0} max={1} step={0.02} />
            <Toggle label="Full width" v={p.codeFull} set={(v) => set({ codeFull: v, layout: "custom" })} />
          </>}
          <div className="row">
            <button onClick={() => set({ zoom: 1, panX: 0, panY: 0 })}>Centre background</button>
          </div>
        </Group>

        <Group title="Tone">
          <Slider label="Brightness" v={p.brightness} set={field("brightness")} min={0.2} max={3} step={0.05} />
          <Slider label="Contrast" v={p.contrast} set={field("contrast")} min={0.2} max={3} step={0.05} />
          <Slider label="Gamma" v={p.gamma} set={field("gamma")} min={0.3} max={3} step={0.05} />
          <Slider label="Threshold" v={p.threshold} set={field("threshold")} min={0} max={0.6} step={0.01} />
          <Slider label="White layer" v={p.whiteMix} set={field("whiteMix")} min={0} max={2} step={0.05} />
          <Slider label="Tint layer" v={p.tintMix} set={field("tintMix")} min={0} max={2} step={0.05} />
          <Toggle label="Invert" v={p.invert} set={field("invert")} />
        </Group>

        <Group title="Glyph grid">
          <Slider label="Cell width" v={p.cellW} set={field("cellW")} min={4} max={20} />
          <Slider label="Cell height" v={p.cellH} set={field("cellH")} min={4} max={24} />
          <Slider label="Font scale" v={p.fontScale} set={field("fontScale")} min={0.6} max={2} step={0.05} />
          <Toggle label="Bold glyphs" v={p.bold} set={field("bold")} />
          <Slider label="Glyph jitter" v={p.jitter} set={field("jitter")} min={0} max={0.5} step={0.01} />
          <Slider label="Jitter every" v={p.jitterEvery} set={field("jitterEvery")} min={1} max={15} />
        </Group>

        <Group title="Colour">
          <Select label="Mode" v={p.colorMode} set={field("colorMode")} opts={["source", "tint", "mono"]} />
          <Slider label="Saturation" v={p.saturation} set={field("saturation")} min={0} max={2} step={0.05} />
          <Color label="Background" v={p.background} set={field("background")} />
          <Color label="Streak colour" v={p.streakColor} set={field("streakColor")} />
        </Group>

        <Group title="Streaks">
          <Select label="Direction" v={p.direction} set={field("direction")} opts={["down", "up"]} />
          <Slider label="Min length" v={p.lenMin} set={field("lenMin")} min={20} max={900} step={10} />
          <Slider label="Max length" v={p.lenMax} set={field("lenMax")} min={20} max={1200} step={10} />
          <Slider label="Speed" v={p.speed} set={field("speed")} min={1} max={4} />
          <Slider label="Acceleration" v={p.accel} set={field("accel")} min={0.5} max={3} step={0.05} />
          <Slider label="Wobble" v={p.wobble} set={field("wobble")} min={0} max={30} />
          <Slider label="Thickness" v={p.thickness} set={field("thickness")} min={1} max={4} />
          <Slider label="Tail fade" v={p.fade} set={field("fade")} min={0} max={1} step={0.05} />
          <Toggle label="Auto source (brightest area)" v={p.emitX == null}
            set={(on) => set(on ? { emitX: null, emitY: null, emitSpread: null } : { emitX: 0.5, emitY: 0.3, emitSpread: 0.5 })} />
          {p.emitX != null && <>
            <Slider label="Source X" v={p.emitX} set={field("emitX")} min={0} max={1} step={0.01} />
            <Slider label="Source Y" v={p.emitY} set={field("emitY")} min={0} max={1} step={0.01} />
            <Slider label="Spread" v={p.emitSpread} set={field("emitSpread")} min={0} max={1} step={0.01} />
          </>}
        </Group>

        <Group title="Motion & effects">
          <Slider label="Pulse wave, px" v={p.pulseWave} set={field("pulseWave")} min={20} max={600} step={10} />
          <Slider label="Pulse cycles" v={p.pulseSpeed} set={field("pulseSpeed")} min={0} max={6} />
          <Slider label="Flicker" v={p.flicker} set={field("flicker")} min={0} max={0.6} step={0.01} />
          <Slider label="Vignette" v={p.vignette} set={field("vignette")} min={0} max={1} step={0.05} />
          <Slider label="Scanlines" v={p.scanlines} set={field("scanlines")} min={0} max={0.8} step={0.05} />
          <Slider label="Film shake, px" v={p.shake} set={field("shake")} min={0} max={6} step={0.5} />
        </Group>
        <div className="resetbar">
          <button className={"wide" + (confirmReset ? " danger" : "")} onBlur={() => setConfirmReset(false)}
            onClick={() => { if (!confirmReset) return setConfirmReset(true); resetVisual(); setConfirmReset(false); }}>
            {confirmReset ? "Click again to reset everything" : "↺ Reset all settings"}
          </button>
          <p className="hint">Resets look, fine-tuning and layout for this tab. Source image, caption and music stay.</p>
        </div>
      </aside>

      <main className="stage">
        <div className="tabbar">
          {state.tabs.map((t) => (
            <div key={t.id} className={"tab" + (t.id === p.id ? " on" : "")} onClick={() => setState((s) => ({ ...s, active: t.id }))}
              onDoubleClick={() => setRenaming(t.id)} title="Double-click to rename">
              {renaming === t.id
                ? <input autoFocus defaultValue={t.name} onBlur={(e) => { updateTab(t.id, { name: e.target.value || t.name }); setRenaming(null); }}
                    onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
                : <span>{t.name}</span>}
              {(jobs[t.id]?.state === "running" || ai[`${t.id}:caption`] || ai[`${t.id}:music`] || igJobs[t.id]?.state === "running") && <i className="dot" />}
              {state.tabs.length > 1 && <b onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>×</b>}
            </div>
          ))}
          <button className="tabbtn" onClick={() => addTab()} title="New tab">＋</button>
          <button className="tabbtn" onClick={() => addTab(p)} title="Duplicate tab">⧉</button>
          <span className="saved">{saved}</span>
          <button className="tabbtn acctbtn" onClick={() => setShowAccounts(true)} title="Instagram accounts (shared by all tabs)">
            ◎ Accounts{ig.accounts.length ? ` · ${ig.accounts.length}` : ""}
          </button>
        </div>
        <div className="tabs">
          {["reels", "feed", "raw"].map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <Phone view={view} guides={guides} username={p.username} caption={p.caption} tags={p.tags} musicName={p.musicName}
          expanded={expanded} setExpanded={setExpanded}>
          <canvas ref={canvasRef} width={W} height={H} />
        </Phone>
        <div className="row center">
          <button className="primary" disabled={!!busy} onClick={exportVideo}>{busy ? (p.hasVideo ? "Converting…" : "Recording…") : p.hasVideo ? "⬇ Convert video" : "⬇ Export reel"}</button>
          <button onClick={() => { const a = document.createElement("a"); a.href = canvasRef.current.toDataURL("image/png"); a.download = "frame.png"; a.click(); }}>Save frame PNG</button>
        </div>
        {conv && <div style={{ width: 360 }}><Progress value={conv.progress} label={`${conv.stage} · ${Math.round(conv.progress * 100)}%`}
          sub={conv.eta ? `~${fmt(conv.eta * 1000)} left` : null} /></div>}
        {log && <pre className="log">{log}</pre>}
      </main>

      {showAccounts && (
        <div className="modal" onClick={() => setShowAccounts(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheethead"><h2>Instagram accounts</h2><b onClick={() => setShowAccounts(false)}>×</b></div>
            <p className="hint">Shared by all tabs. Each tab picks where to post.</p>
            {ig.accounts.map((a) => (
              <div key={a.id} className="acct">
                {a.avatar ? <img src={a.avatar} alt="" /> : <span className="ava" />}
                <span className="aname">@{a.username}
                  <small>{a.limit ? `${a.limit.used}/${a.limit.total} posts today · ` : ""}token {Math.max(0, Math.round((a.expiresAt - Date.now()) / 864e5))} d</small>
                </span>
                <button onClick={() => removeAccount(a.id)}>Disconnect</button>
              </div>
            ))}
            <h2>Add account</h2>
            {ig.oauth && <a className="btn wide center primary" href="/api/ig/login" target="_blank" rel="noreferrer">Log in with Instagram</a>}
            {ig.redirectUri && <p className="hint">Redirect URI for the Meta app: <code>{ig.redirectUri}</code></p>}
            <div className="row">
              <input placeholder="Paste access token" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} style={{ flex: 1, width: "auto" }} />
              <button disabled={!tokenInput} onClick={addToken}>Add</button>
            </div>
            <p className="hint">Meta app → Instagram → API setup → Generate token. See README.</p>
          </div>
        </div>
      )}

      <aside className="cards">
        <Card title="Caption & hashtags" sub="Claude">
          <label className="lbl">Brief <small>what the post is about, tone, language, call to action</small></label>
          <textarea rows={3} value={p.brief} placeholder="e.g. Launching my ASCII series. Mysterious tone, English, ask followers what to animate next."
            onChange={(e) => set({ brief: e.target.value })} />
          <button className="primary wide" disabled={!!capJob} onClick={() => askClaude("caption")}>
            {capJob ? "Claude is writing…" : "✨ Generate caption & tags"}
          </button>
          {capJob && <Progress indeterminate label={<Elapsed since={capJob.started} />} />}
          {aiErr[`${p.id}:caption`] && <pre className="log err">{aiErr[`${p.id}:caption`]}</pre>}
          <p className={"hint" + (aiNote[p.id]?.startsWith("⚠") ? " warn" : "")}>{aiNote[p.id] || "Claude builds the caption on the brief; the frame only sets the mood."}</p>

          <label className="lbl">Username</label>
          <input value={p.username} onChange={(e) => set({ username: e.target.value })} />
          <label className="lbl">Caption <small>{fullText.length}/2200</small></label>
          <textarea rows={7} value={p.caption} onChange={(e) => set({ caption: e.target.value })} />
          <label className="lbl">Hashtags <small>{p.tags.length}/{MAX_TAGS}</small></label>
          <div className="chips">
            {p.tags.map((t) => <span key={t} className="chip" onClick={() => set({ tags: p.tags.filter((x) => x !== t) })}>#{t} ×</span>)}
          </div>
          <input placeholder={p.tags.length >= MAX_TAGS ? "Instagram allows 5 hashtags" : "add tag + Enter"} disabled={p.tags.length >= MAX_TAGS}
            value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addTag(tagInput); setTagInput(""); } }} />
          <div className="chips muted">
            {SUGGESTED.filter((t) => !p.tags.includes(t)).map((t) => (
              <span key={t} className={"chip" + (p.tags.length >= MAX_TAGS ? " off" : "")} onClick={() => addTag(t)}>+#{t}</span>
            ))}
          </div>
          <button className="wide" onClick={() => navigator.clipboard.writeText(fullText)}>Copy caption + tags</button>
        </Card>

        <Card title="Music" sub="ElevenLabs">
          <Status health={health} />
          <label className="lbl">Music prompt</label>
          <textarea rows={5} value={p.prompt} placeholder={describeVisual(layers.stats, opts)} onChange={(e) => set({ prompt: e.target.value })} />
          <div className="row">
            <button disabled={!!musJob} onClick={() => askClaude("music")}>{musJob ? "Claude is listening…" : "✨ Prompt with Claude"}</button>
            <button onClick={() => set({ prompt: describeVisual(layers.stats, opts) })}>↻ From visual</button>
          </div>
          {musJob && <Progress indeterminate label={<Elapsed since={musJob.started} />} />}
          {aiErr[`${p.id}:music`] && <pre className="log err">{aiErr[`${p.id}:music`]}</pre>}
          <Toggle label="Instrumental" v={p.instrumental} set={field("instrumental")} />
          <Slider label="Length, s" v={p.musicSec} set={field("musicSec")} min={10} max={90} step={5} />
          <div className="row">
            <button className="primary" disabled={job?.state === "running"} onClick={generateMusic}>
              {job?.state === "running" ? "Generating…" : "♪ Generate"}
            </button>
            <label className="btn">Upload audio<input type="file" accept="audio/*" hidden onChange={(e) => onAudio(e.target.files[0])} /></label>
          </div>
          {job && job.state !== "error" && (
            <Progress value={job.progress} label={`${job.stage} · ${Math.round(job.progress * 100)}%`}
              sub={`${fmt(job.elapsedMs)} elapsed${job.etaMs ? ` · ~${fmt(job.etaMs)} left` : ""}${job.bytes ? ` · ${(job.bytes / 1024).toFixed(0)} KB` : ""}`} />
          )}
          {job?.state === "error" && <pre className="log err">{job.error}</pre>}
          {musicUrl && <audio key={p.id + musicUrl} ref={audioRef} src={musicUrl} loop controls crossOrigin="anonymous" />}
        </Card>

        <Card title="Publish" sub="Instagram">
          {!ig.accounts.length && <p className="hint">No accounts yet. <a href="#" onClick={(e) => { e.preventDefault(); setShowAccounts(true); }}>Connect an account</a></p>}
          <div className="targets">
            {ig.accounts.map((a) => (
              <label key={a.id} className={"target" + (chosen.includes(a.id) ? " on" : "")}>
                <input type="checkbox" checked={chosen.includes(a.id)} onChange={() => toggleTarget(a.id)} />
                {a.avatar ? <img src={a.avatar} alt="" /> : <span className="ava" />}@{a.username}
              </label>
            ))}
          </div>
          {ig.accounts.length > 0 && <>
            <Toggle label="Label as AI-generated" v={p.aiLabel} set={field("aiLabel")} />
            <div className="row">
              <button className="primary" disabled={igJob?.state === "running" || !targets.length || !health?.ffmpeg} onClick={() => publishReel()}>
                ⇪ Publish{targets.length ? ` to ${targets.length === 1 ? "@" + targets[0].username : targets.length + " accounts"}` : ""}
              </button>
            </div>
            <div className="row">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ flex: 1 }} />
              <button disabled={igJob?.state === "running" || !targets.length || !health?.ffmpeg} onClick={() => publishReel(when)}>Schedule</button>
            </div>
          {!health?.ffmpeg && <p className="hint warn">Publishing needs ffmpeg for the MP4.</p>}
          </>}
          {igJob && igJob.state !== "error" && (
            <Progress value={igJob.progress} label={`${igJob.stage} · ${Math.round(igJob.progress * 100)}%`}
              sub={igJob.state === "running" && igJob.elapsedMs ? `${fmt(igJob.elapsedMs)} on Instagram's side` : null} />
          )}
          {igJob?.results?.length > 0 && (
            <ul className="results">
              {igJob.results.map((r) => <li key={r.username} className={r.error ? "bad" : "ok"}>
                @{r.username} {r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer">open ↗</a> : r.error ? "failed" : "✓"}
              </li>)}
            </ul>
          )}
          {igJob?.error && <pre className="log err">{igJob.error}</pre>}
          {queue.length > 0 && <>
            <h2>Queue</h2>
            {queue.slice().sort((a, b) => a.publishAt - b.publishAt).map((q) => (
              <div key={q.id} className={"qitem " + q.status}>
                <span>{new Date(q.publishAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="qmeta">@{q.username} · {q.title || "reel"} · {q.status}
                  {q.permalink && <> · <a href={q.permalink} target="_blank" rel="noreferrer">open</a></>}
                  {q.error && <em title={q.error}> · {q.error.slice(0, 40)}</em>}
                </span>
                {q.status !== "publishing" && <b onClick={() => fetch(`/api/ig/queue/${q.id}`, { method: "DELETE" }).then(loadIg)}>×</b>}
              </div>
            ))}
            <p className="hint">Scheduled posts go out while the local server is running.</p>
          </>}
        </Card>

      </aside>
    </div>
  );
}

const fmt = (ms = 0) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

function Elapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(h); }, []);
  return <>Working · {fmt(Date.now() - since)}</>;
}

function Progress({ value = 0, label, sub, indeterminate }) {
  return (
    <div className="progress">
      <div className="pbar"><i className={indeterminate ? "ind" : ""} style={indeterminate ? null : { width: `${Math.max(2, value * 100)}%` }} /></div>
      <div className="plabel"><span>{label}</span></div>
      {sub && <div className="psub">{sub}</div>}
    </div>
  );
}

function Phone({ view, guides, username, caption, tags, musicName, expanded, setExpanded, children }) {
  const text = `${caption}\n\n${tags.map((t) => "#" + t).join(" ")}`;
  const first = caption.split("\n")[0];
  const Guides = () => guides && <div className="guides"><i className="gt" /><i className="gb" /><i className="gr" /></div>;
  const Caption = () => (
    <div className="cap" onClick={() => setExpanded(!expanded)}>
      <b>{username}</b> {expanded ? <span className="pre">{text}</span> : <>{first.slice(0, 60)}<span className="more">… more</span></>}
    </div>
  );
  if (view === "raw") return <div className="raw">{children}<Guides /></div>;
  if (view === "feed") return (
    <div className="phone feed">
      <div className="fhead"><span className="ava" /> <b>{username}</b><span className="dots">•••</span></div>
      <div className="crop45">{children}</div>
      <div className="actions">♡ 💬 ➤<span>🔖</span></div>
      <div className="likes"><b>1,024 likes</b></div>
      <Caption />
    </div>
  );
  return (
    <div className="phone reels">
      {children}<Guides />
      <div className="rtop"><b>Reels</b><span>📷</span></div>
      <div className="rside"><div>♡<small>1.2K</small></div><div>💬<small>87</small></div><div>➤</div><div>•••</div><div className="disc" /></div>
      <div className="rbottom">
        <div className="who"><span className="ava" /> <b>{username}</b> <span className="follow">Follow</span></div>
        <Caption />
        <div className="music"><span className="note">♪</span><div className="marq"><span>{musicName} · {musicName}</span></div></div>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => <section><h2>{title}</h2>{children}</section>;
const Card = ({ title, sub, children }) => <section className="card"><h3>{title}{sub && <small>{sub}</small>}</h3>{children}</section>;
const Group = ({ title, children }) => <details className="group"><summary>{title}</summary>{children}</details>;
const Slider = ({ label, v, set, min, max, step = 1 }) => (
  <label className="slider"><span>{label}</span><input type="range" min={min} max={max} step={step} value={v ?? min} onChange={(e) => set(Number(e.target.value))} /><em>{v}</em></label>
);
const Select = ({ label, v, set, opts, names }) => (
  <label className="slider"><span>{label}</span><select value={v} onChange={(e) => set(e.target.value)}>
    {opts.map((o) => <option key={o} value={o}>{names?.[o] || o}</option>)}</select></label>
);
const Toggle = ({ label, v, set }) => (
  <label className="chk"><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} /> {label}</label>
);
const Color = ({ label, v, set }) => (
  <label className="slider"><span>{label}</span><input type="color" value={v} onChange={(e) => set(e.target.value)} /><em>{v}</em></label>
);
const Status = ({ health }) => {
  if (health === null) return <p className="hint">Checking local server…</p>;
  if (!health) return <p className="hint warn">Local server is offline — run <code>npm run dev</code>.</p>;
  return <p className="hint">ElevenLabs CLI {health.cli ? "✓" : "✗"} · API key {health.apiKey ? "✓" : "–"} · Claude {health.claude ? "✓" : "✗"} · ffmpeg {health.ffmpeg ? "✓" : "✗"} · tunnel {health.tunnel?.kind === "ngrok"
    ? (health.tunnel.state === "online" ? "ngrok ✓" : `ngrok ${health.tunnel.state}`) : health.cloudflared ? "✓" : "✗"}
    {health.tunnel?.error && <><br /><span className="warn">ngrok: {health.tunnel.error}</span></>}</p>;
};
