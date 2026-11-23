import React, { useEffect, useMemo, useRef, useState } from "react";
import { W, H, LAYOUTS, PRESETS, FINE_DEFAULTS, buildLayers, makeStreaks, renderFrame, renderCode, describeVisual } from "./engine.js";
import { loadTabs, saveTabs, newProject, putBlob, getBlob, delBlob, shrinkImage, blobToImage } from "./store.js";
import engineSource from "./engine.js?raw";

const CODE_LINES = engineSource.split("\n").filter((l) => l.trim());
const RAMPS = {
  classic: " .,:;-=+*cox%#@",
  blocks: " ░▒▓█",
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  binary: " 01",
  dots: " ·•●",
  katakana: " ･ｰｼﾂｦｱｳｴｵｶｷｸｹｺｻ",
  lines: " .-=≡#",
};
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
  const [ai, setAi] = useState({});              // tabId -> {started}
  const [ig, setIg] = useState({ accounts: [] });  // connected Instagram accounts
  const [igJobs, setIgJobs] = useState({});      // tabId -> publish progress
  const [queue, setQueue] = useState([]);
  const [tokenInput, setTokenInput] = useState("");
  const [showAccounts, setShowAccounts] = useState(false);
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16));
  const [, bump] = useState(0);

  const canvasRef = useRef(null), audioRef = useRef(null), tRef = useRef(0);
  const images = useRef(new Map()), audios = useRef(new Map()), graphs = useRef(new WeakMap());

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
  }, [p.id, p.hasImage, p.musicBlob]);

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
  const musicUrl = p.musicBlob ? audios.current.get(p.id) || null : p.musicUrl;

  // ---------- engine ----------
  const L = LAYOUTS[p.layout] || LAYOUTS.reels, box = L.scene, loop = p.loopSec * 30;
  const layers = useMemo(
    () => buildLayers({ preset: p.preset, image, cw: p.cellW, ch: p.cellH, sceneW: box.w, sceneH: box.h, seed: p.seed }),
    [p.preset, image, p.cellW, p.cellH, p.layout, p.seed]
  );
  const streakList = useMemo(
    () => makeStreaks(layers, { count: p.streaks, loop, seed: p.seed, lenMin: p.lenMin, lenMax: p.lenMax, speed: p.speed,
      emitX: p.emitX, emitY: p.emitY, emitSpread: p.emitSpread }),
    [layers, p.streaks, loop, p.seed, p.lenMin, p.lenMax, p.speed, p.emitX, p.emitY, p.emitSpread]
  );
  const opts = { ...Object.fromEntries(FINE_KEYS.map((k) => [k, p[k]])), ramp: RAMPS[p.ramp] || RAMPS.classic,
    tint: TINTS[p.tint] || TINTS.blood, streakGain: p.streakGain, pulse: p.pulse, loop, x: box.x, y: box.y };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let raf, last = performance.now();
    const draw = () => {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      renderFrame(ctx, layers, streakList, tRef.current, opts);
      if (L.code) renderCode(ctx, CODE_LINES, tRef.current, loop, L.code.top, L.code.bottom, box.x, box.w);
    };
    const tick = (now) => {
      if (playing && now - last >= 1000 / 30) { last = now; tRef.current = (tRef.current + 1) % loop; draw(); }
      raf = requestAnimationFrame(tick);
    };
    draw(); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  useEffect(() => {
    const a = audioRef.current; if (!a || !musicUrl) return;
    playing ? a.play().catch(() => {}) : a.pause();
  }, [playing, musicUrl, p.id]);

  // ---------- tabs ----------
  const addTab = (from) => {
    const t = from ? { ...from, id: newProject().id, name: from.name + " copy", hasImage: false, musicBlob: false } : newProject(`Scene ${state.tabs.length + 1}`);
    if (from?.hasImage) getBlob(`img:${from.id}`).then((b) => b && putBlob(`img:${t.id}`, b).then(() => updateTab(t.id, { hasImage: true })));
    setState((s) => ({ tabs: [...s.tabs, t], active: t.id }));
  };
  const closeTab = (id) => {
    if (state.tabs.length === 1) return;
    delBlob(`img:${id}`); delBlob(`aud:${id}`);
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id), tabs = s.tabs.filter((t) => t.id !== id);
      return { tabs, active: s.active === id ? tabs[Math.max(0, i - 1)].id : s.active };
    });
  };

  // ---------- inputs ----------
  const onImage = async (f) => {
    if (!f) return;
    const blob = await shrinkImage(f), id = p.id;
    await putBlob(`img:${id}`, blob);
    images.current.set(id, await blobToImage(blob));
    updateTab(id, { hasImage: true });
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

  // ---------- Claude: prompt + caption + hashtags ----------
  async function askClaude() {
    const id = p.id;
    setAi((a) => ({ ...a, [id]: { started: Date.now() } }));
    try {
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame: canvasRef.current.toDataURL("image/png"), stats: layers.stats,
          settings: { preset: p.hasImage ? "custom image" : p.preset, tint: p.tint, glyphs: p.ramp, loopSec: p.loopSec, direction: p.direction },
          caption: p.caption, hashtags: p.tags, musicSec: p.musicSec }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`${j.error}\n${j.log || ""}`);
      const patch = {};
      if (j.musicPrompt) patch.prompt = j.musicPrompt;
      if (j.caption) patch.caption = j.caption;
      if (j.hashtags?.length) patch.tags = j.hashtags.slice(0, MAX_TAGS);
      updateTab(id, patch);
      setLog("Claude filled the music prompt, caption and hashtags.");
    } catch (e) { setLog(String(e.message || e)); }
    setAi((a) => { const n = { ...a }; delete n[id]; return n; });
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
    tRef.current = 0; setPlaying(true); rec.start();
    const total = Math.max(p.loopSec, musicUrl ? Math.min(p.musicSec, 90) : p.loopSec * 2) * 1000, t0 = Date.now();
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

  async function exportVideo() {
    setBusy("export"); setLog("Recording…");
    try {
      const blob = await recordWebm();
      let url = URL.createObjectURL(blob), name = `${p.name || "reel"}.webm`;
      if (health?.ffmpeg) { setLog("Converting to MP4…"); url = await toMp4(blob); name = `${p.name || "reel"}.mp4`; }
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setLog(`Saved ${name}`);
    } catch (e) { setLog(String(e.message || e)); }
    setBusy("");
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
      setIgJob(id, { state: "running", stage: "Recording", progress: 0, results: [] });
      const blob = await recordWebm((f) => setIgJob(id, { progress: f * 0.3, stage: "Recording" }));
      setIgJob(id, { stage: "Converting to MP4", progress: 0.32 });
      const video = await toMp4(blob);
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

  const job = jobs[p.id], aiJob = ai[p.id], igJob = igJobs[p.id];

  // ---------- UI ----------
  return (
    <div className="app">
      <aside className="panel">
        <h1>ASCII <span>Reels</span> Studio</h1>

        <Section title="Source">
          <div className="row">
            {Object.entries(PRESETS).map(([k, pr]) => (
              <button key={k} className={!p.hasImage && p.preset === k ? "on" : ""} onClick={() => set({ hasImage: false, preset: k })}>{pr.name}</button>
            ))}
          </div>
          <label className="drop">
            <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files[0])} />
            {p.hasImage ? "✓ Your image — click to replace" : "Upload your image (JPG/PNG)"}
          </label>
        </Section>

        <Section title="Layout">
          <div className="row">
            {Object.entries(LAYOUTS).map(([k, l]) => (
              <button key={k} className={p.layout === k ? "on" : ""} onClick={() => set({ layout: k })}>{l.name}</button>
            ))}
          </div>
          <Toggle label="Show Instagram safe zones" v={guides} set={setGuides} />
        </Section>

        <Section title="Look">
          <Select label="Glyphs" v={p.ramp} set={field("ramp")} opts={Object.keys(RAMPS)} />
          <Select label="Tint" v={p.tint} set={field("tint")} opts={Object.keys(TINTS)} />
          <Slider label="Streaks" v={p.streaks} set={field("streaks")} min={0} max={300} />
          <Slider label="Streak glow" v={p.streakGain} set={field("streakGain")} min={0} max={1.5} step={0.05} />
          <Slider label="Pulse" v={p.pulse} set={field("pulse")} min={0} max={1} step={0.05} />
          <Slider label="Loop, s" v={p.loopSec} set={field("loopSec")} min={2} max={15} />
          <div className="row">
            <button onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })}>🎲 Reseed</button>
            <button onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
            <button onClick={() => set(FINE_DEFAULTS)}>Reset fine-tune</button>
          </div>
        </Section>

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
        </Group>
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
              {(jobs[t.id]?.state === "running" || ai[t.id] || igJobs[t.id]?.state === "running") && <i className="dot" />}
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
          <button className="primary" disabled={!!busy} onClick={exportVideo}>{busy === "export" ? "Recording…" : "⬇ Export reel"}</button>
          <button onClick={() => { const a = document.createElement("a"); a.href = canvasRef.current.toDataURL("image/png"); a.download = "frame.png"; a.click(); }}>Save frame PNG</button>
        </div>
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

      <aside className="panel">
        <Section title="Claude">
          <button className="primary wide" disabled={!!aiJob} onClick={askClaude}>
            {aiJob ? "Claude is looking at the frame…" : "✨ Write prompt, caption & tags"}
          </button>
          {aiJob && <Progress indeterminate label={<Elapsed since={aiJob.started} />} />}
          <p className="hint">Runs your local <code>claude</code> CLI on the current frame.</p>
        </Section>

        <Section title="Music · ElevenLabs">
          <Status health={health} />
          <textarea rows={5} value={p.prompt} placeholder={describeVisual(layers.stats, opts)} onChange={(e) => set({ prompt: e.target.value })} />
          <div className="row">
            <button onClick={() => set({ prompt: describeVisual(layers.stats, opts) })}>↻ From visual</button>
            <Toggle label="Instrumental" v={p.instrumental} set={field("instrumental")} />
          </div>
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
        </Section>

        <Section title="Post to Instagram">
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
        </Section>

        <Section title="Post">
          <label className="lbl">Username</label>
          <input value={p.username} onChange={(e) => set({ username: e.target.value })} />
          <label className="lbl">Caption <small>{fullText.length}/2200</small></label>
          <textarea rows={8} value={p.caption} onChange={(e) => set({ caption: e.target.value })} />
        </Section>
        <Section title={`Hashtags ${p.tags.length}/${MAX_TAGS}`}>
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
        </Section>
        <button className="primary wide" onClick={() => navigator.clipboard.writeText(fullText)}>Copy caption + tags</button>
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
const Group = ({ title, children }) => <details className="group"><summary>{title}</summary>{children}</details>;
const Slider = ({ label, v, set, min, max, step = 1 }) => (
  <label className="slider"><span>{label}</span><input type="range" min={min} max={max} step={step} value={v ?? min} onChange={(e) => set(Number(e.target.value))} /><em>{v}</em></label>
);
const Select = ({ label, v, set, opts }) => (
  <label className="slider"><span>{label}</span><select value={v} onChange={(e) => set(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
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
