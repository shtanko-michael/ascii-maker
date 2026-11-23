import React, { useEffect, useMemo, useRef, useState } from "react";
import { W, H, PRESETS, buildLayers, makeStreaks, renderFrame, renderCode, describeVisual } from "./engine.js";
import engineSource from "./engine.js?raw";

const CODE_LINES = engineSource.split("\n").filter((l) => l.trim());
const RAMPS = {
  classic: " .,:;-=+*cox%#@",
  blocks: " ░▒▓█",
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  binary: " 01",
  dots: " ·•●",
};
const TINTS = { blood: [1, 0.06, 0.06], ember: [1, 0.45, 0.1], toxic: [0.3, 1, 0.3], ice: [0.3, 0.6, 1], mono: [0.6, 0.6, 0.6] };
const SUGGESTED = ["asciiart", "ascii", "generativeart", "creativecoding", "codeart", "proceduralart", "glitchart",
  "digitalart", "darkart", "surrealart", "horrorart", "newmediaart", "algorithmicart", "computerart", "textart",
  "loopanimation", "animationloop", "javascript", "reactjs", "dailyart"];
const DEFAULT_CAPTION = `He never asked to be seen.
Red light, white silence, ash falling through time.

Every frame is code. Not a single pixel drawn by hand.
The source scrolls at the bottom — pause and read it.

What would you feed into it? 👇`;

export default function App() {
  // ---------- visual params ----------
  const [preset, setPreset] = useState("crucifix");
  const [image, setImage] = useState(null);
  const [cell, setCell] = useState(8);
  const [ramp, setRamp] = useState("classic");
  const [tint, setTint] = useState("blood");
  const [streaks, setStreaks] = useState(60);
  const [streakGain, setStreakGain] = useState(0.6);
  const [pulse, setPulse] = useState(0.3);
  const [loopSec, setLoopSec] = useState(6);
  const [codePanel, setCodePanel] = useState(true);
  const [seed, setSeed] = useState(7);
  const [playing, setPlaying] = useState(true);

  // ---------- post ----------
  const [view, setView] = useState("reels");
  const [username, setUsername] = useState("ascii.maker");
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [tags, setTags] = useState(SUGGESTED.slice(0, 15));
  const [tagInput, setTagInput] = useState("");
  const [expanded, setExpanded] = useState(false);

  // ---------- music ----------
  const [musicUrl, setMusicUrl] = useState(null);
  const [musicName, setMusicName] = useState("Original audio");
  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [musicSec, setMusicSec] = useState(30);
  const [busy, setBusy] = useState("");
  const [health, setHealth] = useState(null);
  const [log, setLog] = useState("");

  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const tRef = useRef(0);
  const audioGraph = useRef(null);

  const sceneH = codePanel ? 860 : H;
  const loop = loopSec * 30;
  const layers = useMemo(
    () => buildLayers({ preset, image, cell, sceneH, seed }),
    [preset, image, cell, sceneH, seed]
  );
  const streakList = useMemo(
    () => makeStreaks({ count: streaks, loop, emitter: layers.emitter, seed }),
    [streaks, loop, layers, seed]
  );
  const opts = { cell, ramp: RAMPS[ramp], tint: TINTS[tint], streakGain, pulse, loop };

  useEffect(() => { if (!prompt) setPrompt(describeVisual(layers.stats, opts)); }, [layers]); // eslint-disable-line
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(false)); }, []);

  // ---------- animation loop, fixed 30 fps ----------
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let raf, last = performance.now();
    const draw = () => {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      renderFrame(ctx, layers, streakList, tRef.current, opts);
      if (codePanel) renderCode(ctx, CODE_LINES, tRef.current, loop, sceneH);
    };
    const tick = (now) => {
      if (playing && now - last >= 1000 / 30) {
        last = now; tRef.current = (tRef.current + 1) % loop; draw();
      }
      raf = requestAnimationFrame(tick);
    };
    draw();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }); // re-bind every render so params are live

  useEffect(() => {
    const a = audioRef.current; if (!a || !musicUrl) return;
    playing ? a.play().catch(() => {}) : a.pause();
  }, [playing, musicUrl]);

  // ---------- handlers ----------
  const onImage = (f) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = URL.createObjectURL(f);
  };
  const addTag = (t) => {
    t = t.replace(/^#/, "").trim().replace(/\s+/g, "");
    if (t && !tags.includes(t) && tags.length < 30) setTags([...tags, t]);
  };
  const fullText = `${caption}\n\n${tags.map((t) => "#" + t).join(" ")}`;

  async function generateMusic() {
    setBusy("music"); setLog("");
    try {
      const r = await fetch("/api/music", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, lengthMs: musicSec * 1000, instrumental }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`${j.error}\n${j.cli || ""}`);
      setMusicUrl(j.url); setMusicName(`ElevenLabs · ${prompt.split(",")[0].slice(0, 40)}`);
      setLog(`Generated via ${j.via}`);
    } catch (e) { setLog(String(e.message || e)); }
    setBusy("");
  }

  async function exportVideo() {
    setBusy("export"); setLog("Recording…");
    const stream = canvasRef.current.captureStream(30);
    if (musicUrl && audioRef.current) {
      // an <audio> element can be wired to Web Audio only once, so cache the graph
      if (!audioGraph.current) {
        const actx = new AudioContext();
        const src = actx.createMediaElementSource(audioRef.current);
        const dst = actx.createMediaStreamDestination();
        src.connect(dst); src.connect(actx.destination);
        audioGraph.current = { actx, dst };
      }
      await audioGraph.current.actx.resume();
      audioGraph.current.dst.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    tRef.current = 0; setPlaying(true);
    rec.start();
    const total = Math.max(loopSec, musicUrl ? Math.min(musicSec, 90) : loopSec * 2);
    await new Promise((r) => setTimeout(r, total * 1000));
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: "video/webm" });
    let url = URL.createObjectURL(blob), name = "reel.webm";
    if (health?.ffmpeg) {
      setLog("Converting to MP4…");
      try {
        const r = await fetch("/api/convert", { method: "POST", body: blob });
        const j = await r.json();
        if (r.ok) { url = j.url; name = "reel.mp4"; } else setLog(j.error);
      } catch (e) { setLog(String(e)); }
    }
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setLog(`Saved ${name}`); setBusy("");
  }

  // ---------- UI ----------
  return (
    <div className="app">
      <aside className="panel">
        <h1>ASCII <span>Reels</span> Studio</h1>

        <Section title="Source">
          <div className="row">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} className={!image && preset === k ? "on" : ""} onClick={() => { setImage(null); setPreset(k); }}>{p.name}</button>
            ))}
          </div>
          <label className="drop">
            <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files[0])} />
            {image ? "✓ Your image loaded — click to replace" : "Upload your image (JPG/PNG)"}
          </label>
          <p className="hint">Whites become white glyphs, saturated reds become the tint layer.</p>
        </Section>

        <Section title="Look">
          <Slider label="Cell size" v={cell} set={setCell} min={5} max={16} />
          <Select label="Glyphs" v={ramp} set={setRamp} opts={Object.keys(RAMPS)} />
          <Select label="Tint" v={tint} set={setTint} opts={Object.keys(TINTS)} />
          <Slider label="Streaks" v={streaks} set={setStreaks} min={0} max={200} />
          <Slider label="Streak glow" v={streakGain} set={setStreakGain} min={0} max={1.5} step={0.05} />
          <Slider label="Pulse" v={pulse} set={setPulse} min={0} max={1} step={0.05} />
          <Slider label="Loop, s" v={loopSec} set={setLoopSec} min={2} max={15} />
          <div className="row">
            <button onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>🎲 Reseed</button>
            <button className={codePanel ? "on" : ""} onClick={() => setCodePanel(!codePanel)}>Code panel</button>
            <button onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          </div>
        </Section>

        <Section title="Music · ElevenLabs">
          <Status health={health} />
          <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="row">
            <button onClick={() => setPrompt(describeVisual(layers.stats, opts))}>↻ From visual</button>
            <label className="chk"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> Instrumental</label>
          </div>
          <Slider label="Length, s" v={musicSec} set={setMusicSec} min={10} max={90} step={5} />
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={generateMusic}>{busy === "music" ? "Generating…" : "♪ Generate"}</button>
            <label className="btn">Upload audio<input type="file" accept="audio/*" hidden onChange={(e) => {
              const f = e.target.files[0]; if (f) { setMusicUrl(URL.createObjectURL(f)); setMusicName(f.name); }
            }} /></label>
          </div>
          {musicUrl && <audio ref={audioRef} src={musicUrl} loop controls crossOrigin="anonymous" />}
        </Section>
      </aside>

      <main className="stage">
        <div className="tabs">
          {["reels", "feed", "raw"].map((v) => (
            <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
        <Phone view={view} username={username} caption={caption} tags={tags} musicName={musicName}
          expanded={expanded} setExpanded={setExpanded}>
          <canvas ref={canvasRef} width={W} height={H} />
        </Phone>
        <div className="row center">
          <button className="primary" disabled={!!busy} onClick={exportVideo}>{busy === "export" ? "Recording…" : "⬇ Export reel"}</button>
          <button onClick={() => { const a = document.createElement("a"); a.href = canvasRef.current.toDataURL("image/png"); a.download = "frame.png"; a.click(); }}>Save frame PNG</button>
        </div>
        {log && <pre className="log">{log}</pre>}
      </main>

      <aside className="panel">
        <Section title="Post">
          <label className="lbl">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
          <label className="lbl">Caption <small>{fullText.length}/2200</small></label>
          <textarea rows={9} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Section>
        <Section title={`Hashtags ${tags.length}/30`}>
          <div className="chips">
            {tags.map((t) => <span key={t} className="chip" onClick={() => setTags(tags.filter((x) => x !== t))}>#{t} ×</span>)}
          </div>
          <input placeholder="add tag + Enter" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addTag(tagInput); setTagInput(""); } }} />
          <div className="chips muted">
            {SUGGESTED.filter((t) => !tags.includes(t)).map((t) => <span key={t} className="chip" onClick={() => addTag(t)}>+#{t}</span>)}
          </div>
        </Section>
        <button className="primary wide" onClick={() => navigator.clipboard.writeText(fullText)}>Copy caption + tags</button>
      </aside>
    </div>
  );
}

function Phone({ view, username, caption, tags, musicName, expanded, setExpanded, children }) {
  const text = `${caption}\n\n${tags.map((t) => "#" + t).join(" ")}`;
  const first = caption.split("\n")[0];
  const Caption = () => (
    <div className="cap" onClick={() => setExpanded(!expanded)}>
      <b>{username}</b> {expanded ? <span className="pre">{text}</span> : <>{first.slice(0, 60)}<span className="more">… more</span></>}
    </div>
  );
  if (view === "raw") return <div className="raw">{children}</div>;
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
      {children}
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
const Slider = ({ label, v, set, min, max, step = 1 }) => (
  <label className="slider"><span>{label}</span><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} /><em>{v}</em></label>
);
const Select = ({ label, v, set, opts }) => (
  <label className="slider"><span>{label}</span><select value={v} onChange={(e) => set(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
);
const Status = ({ health }) => {
  if (health === null) return <p className="hint">Checking local server…</p>;
  if (!health) return <p className="hint warn">Local server is offline — run <code>npm run dev</code>.</p>;
  return <p className="hint">CLI {health.cli ? "✓" : "✗"} · API key {health.apiKey ? "✓" : "–"} · ffmpeg {health.ffmpeg ? "✓" : "✗"}</p>;
};
