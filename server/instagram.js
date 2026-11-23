// Instagram publishing (Instagram API with Instagram Login, graph.instagram.com)
// Several accounts can be connected; every publish / queue item names its accountId.
//   GET    /api/ig/accounts              -> {accounts:[{id, username, avatar, expiresAt, limit}], oauth, publicUrl}
//   POST   /api/ig/token {token}         -> add an account from a token generated in the Meta dashboard
//   GET    /api/ig/login                 -> OAuth redirect (needs IG_APP_ID/SECRET/REDIRECT_URI)
//   GET    /api/ig/callback?code=        -> OAuth code -> long-lived token -> account added
//   DELETE /api/ig/accounts/:id
//   POST   /api/ig/publish {accountId, video, caption, aiLabel} -> {id}   (video = "/media/reel_x.mp4")
//   GET    /api/ig/publish/:id           -> job progress
//   GET /api/ig/queue | POST /api/ig/queue {accountId, video, caption, aiLabel, publishAt, title} | DELETE /api/ig/queue/:id
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import spawn from "cross-spawn";

export function mountInstagram(app, { MEDIA, PORT }) {
  const V = process.env.IG_API_VERSION || "v23.0";
  const GRAPH = process.env.IG_GRAPH_BASE || "https://graph.instagram.com";        // overridable for tests
  const OAUTH = process.env.IG_OAUTH_BASE || "https://api.instagram.com";
  const AUTH_URL = process.env.IG_AUTH_URL || "https://www.instagram.com/oauth/authorize";
  const TOKEN_FILE = path.join(MEDIA, "instagram.json");   // keep media/ out of git (it is in .gitignore)
  const QUEUE_FILE = path.join(MEDIA, "queue.json");

  // ---------------- token storage ----------------
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
  let accounts = readJson(TOKEN_FILE, []);
  if (!Array.isArray(accounts)) accounts = accounts ? [accounts] : [];
  const saveAccounts = () => fs.writeFileSync(TOKEN_FILE, JSON.stringify(accounts, null, 2));
  const upsert = (a) => { accounts = [...accounts.filter((x) => x.userId !== a.userId), a]; saveAccounts(); return a; };
  const getAccount = (id) => {
    const a = accounts.find((x) => String(x.userId) === String(id)) || (accounts.length === 1 && !id ? accounts[0] : null);
    if (!a) throw new Error("Pick a connected Instagram account");
    return a;
  };

  async function api(method, p, params = {}, token) {
    const url = new URL(p.startsWith("http") ? p : `${GRAPH}/${V}/${p}`);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, access_token: token })) if (v != null) (method === "GET" ? url.searchParams : body).set(k, String(v));
    const r = await fetch(url, method === "GET" ? {} : { method, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message || `Instagram API ${r.status}`);
    return j;
  }

  async function connect(token) {
    const me = await api("GET", "me", { fields: "user_id,username,profile_picture_url" }, token);
    return upsert({ token, userId: String(me.user_id || me.id), username: me.username, avatar: me.profile_picture_url,
      expiresAt: Date.now() + 60 * 864e5, connectedAt: Date.now() });
  }

  // long-lived tokens live ~60 days and can be refreshed once they are 24 h old
  async function refreshIfNeeded(a) {
    const left = a.expiresAt - Date.now();
    if (left > 10 * 864e5 || Date.now() - a.connectedAt < 864e5) return a;
    try {
      const j = await api("GET", `${GRAPH}/refresh_access_token`, { grant_type: "ig_refresh_token" }, a.token);
      return upsert({ ...a, token: j.access_token, expiresAt: Date.now() + (j.expires_in || 5184000) * 1000, connectedAt: Date.now() });
    } catch (e) { console.warn(`token refresh failed for @${a.username}:`, e.message); return a; }
  }

  // ---------------- public URL for Instagram to download the video ----------------
  let tunnel = null;   // { url, proc }
  async function publicBase() {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
    if (tunnel?.url) return tunnel.url;
    const bin = process.env.CLOUDFLARED || "cloudflared";
    return new Promise((resolve, reject) => {
      let proc;
      try { proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`]); }
      catch { return reject(new Error("No public URL: install cloudflared or set PUBLIC_BASE_URL")); }
      const timer = setTimeout(() => reject(new Error("cloudflared did not give a URL in 30 s")), 30000);
      const onData = (d) => {
        const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) { clearTimeout(timer); tunnel = { url: m[0], proc }; setTimeout(() => resolve(m[0]), 4000); }  // DNS needs a moment
      };
      proc.stdout?.on("data", onData); proc.stderr?.on("data", onData);
      proc.on("error", () => { clearTimeout(timer); reject(new Error("No public URL: install cloudflared or set PUBLIC_BASE_URL")); });
      proc.on("close", () => { tunnel = null; });
    });
  }
  process.on("exit", () => tunnel?.proc?.kill());

  let queue = readJson(QUEUE_FILE, []);
  const saveQueue = () => fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

  // ---------------- publish job ----------------
  const jobs = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const localFile = (video) => {
    const name = path.basename(String(video || ""));
    const f = path.join(MEDIA, name);
    if (!/^reel_\d+\.mp4$/.test(name) || !fs.existsSync(f)) throw new Error("Video not found — export the reel first");
    return { name, f };
  };

  async function publish({ accountId, video, caption, aiLabel }, job = { stage: "", progress: 0 }) {
    const acc = await refreshIfNeeded(getAccount(accountId));
    const T = acc.token;
    job.username = acc.username;
    const { name } = localFile(video);
    // share the file under an unguessable name, removed after publishing
    const secret = `pub_${crypto.randomBytes(12).toString("hex")}.mp4`;
    fs.copyFileSync(path.join(MEDIA, name), path.join(MEDIA, secret));
    try {
      job.stage = "Opening public link"; job.progress = 0.05;
      const base = await publicBase();
      job.stage = "Instagram is downloading the video"; job.progress = 0.15;
      const c = await api("POST", `${acc.userId}/media`, {
        media_type: "REELS", video_url: `${base}/media/${secret}`, caption, share_to_feed: true,
        ...(aiLabel ? { is_ai_generated: true } : {}),
      }, T);
      job.container = c.id;
      // Meta suggests polling about once a minute for up to 5 min; we poll every 5 s for up to 10 min
      const t0 = Date.now();
      for (;;) {
        const s = await api("GET", c.id, { fields: "status_code,status" }, T);
        job.igStatus = s.status_code;
        if (s.status_code === "FINISHED") break;
        if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram processing failed: ${s.status || s.status_code}`);
        if (Date.now() - t0 > 600000) throw new Error("Instagram is still processing after 10 minutes");
        job.stage = "Instagram is processing the video";
        job.progress = 0.2 + 0.65 * (1 - Math.exp(-(Date.now() - t0) / 45000));
        await sleep(5000);
      }
      job.stage = "Publishing"; job.progress = 0.9;
      const m = await api("POST", `${acc.userId}/media_publish`, { creation_id: c.id }, T);
      let permalink = null;
      try { permalink = (await api("GET", m.id, { fields: "permalink" }, T)).permalink; } catch {}
      job.stage = "Published"; job.progress = 1;
      return { mediaId: m.id, permalink };
    } finally {
      fs.rmSync(path.join(MEDIA, secret), { force: true });
    }
  }

  // ---------------- routes ----------------
  app.get("/api/ig/accounts", async (_req, res) => {
    const list = await Promise.all(accounts.map(async (a) => {
      let limit = null;
      try {
        const j = await api("GET", `${a.userId}/content_publishing_limit`, { fields: "quota_usage,config" }, a.token);
        const d = j.data?.[0]; if (d) limit = { used: d.quota_usage, total: d.config?.quota_total };
      } catch {}
      return { id: a.userId, username: a.username, avatar: a.avatar, expiresAt: a.expiresAt, limit };
    }));
    res.json({
      accounts: list,
      oauth: !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET && process.env.IG_REDIRECT_URI),
      publicUrl: process.env.PUBLIC_BASE_URL || (tunnel?.url ? tunnel.url : "auto (cloudflared)"),
      redirectUri: process.env.IG_REDIRECT_URI || null,
    });
  });

  app.post("/api/ig/token", async (req, res) => {
    try { const a = await connect(String(req.body?.token || "").trim()); res.json({ username: a.username }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/ig/accounts/:id", (req, res) => {
    accounts = accounts.filter((a) => String(a.userId) !== req.params.id); saveAccounts();
    queue = queue.filter((q) => !(String(q.accountId) === req.params.id && q.status === "scheduled")); saveQueue();
    res.json({ ok: true });
  });

  const states = new Set();
  app.get("/api/ig/login", (_req, res) => {
    const { IG_APP_ID, IG_REDIRECT_URI } = process.env;
    if (!IG_APP_ID || !IG_REDIRECT_URI) return res.status(400).send("Set IG_APP_ID, IG_APP_SECRET and IG_REDIRECT_URI in .env");
    const state = crypto.randomBytes(8).toString("hex"); states.add(state);
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({ client_id: IG_APP_ID, redirect_uri: IG_REDIRECT_URI, response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish", state }).toString();
    res.redirect(u.toString());
  });

  app.get("/api/ig/callback", async (req, res) => {
    try {
      if (!states.delete(String(req.query.state))) throw new Error("Bad OAuth state");
      const { IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI } = process.env;
      const r = await fetch(`${OAUTH}/oauth/access_token`, { method: "POST", body: new URLSearchParams({
        client_id: IG_APP_ID, client_secret: IG_APP_SECRET, grant_type: "authorization_code",
        redirect_uri: IG_REDIRECT_URI, code: String(req.query.code || "").replace(/#_$/, "") }) });
      const short = await r.json();
      if (!short.access_token) throw new Error(short.error_message || "No access token");
      const long = await api("GET", `${GRAPH}/access_token`, { grant_type: "ig_exchange_token", client_secret: IG_APP_SECRET }, short.access_token);
      await connect(long.access_token);
      res.send("<script>window.close()</script>Instagram account connected. You can close this tab.");
    } catch (e) { res.status(400).send(`Instagram login failed: ${e.message}`); }
  });

  app.post("/api/ig/publish", (req, res) => {
    const id = crypto.randomBytes(6).toString("hex");
    const job = { state: "running", stage: "Starting", progress: 0, started: Date.now() };
    jobs.set(id, job);
    res.json({ id });
    publish(req.body || {}, job)
      .then((r) => Object.assign(job, { state: "done", ...r, finished: Date.now() }))
      .catch((e) => Object.assign(job, { state: "error", stage: "Failed", error: e.message, finished: Date.now() }));
  });
  app.get("/api/ig/publish/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: "unknown job" });
    res.json({ ...j, elapsedMs: (j.finished || Date.now()) - j.started });
  });

  // ---------------- scheduled queue (runs while the server is running) ----------------
  app.get("/api/ig/queue", (_req, res) => res.json(queue));
  app.post("/api/ig/queue", (req, res) => {
    try {
      const { accountId, video, caption = "", aiLabel = false, publishAt, title = "" } = req.body || {};
      localFile(video);
      const acc = getAccount(accountId);
      const at = Date.parse(publishAt);
      if (!(at > Date.now())) throw new Error("Pick a time in the future");
      const item = { id: crypto.randomBytes(6).toString("hex"), accountId: acc.userId, username: acc.username,
        video, caption, aiLabel, title, publishAt: at, status: "scheduled" };
      queue.push(item); saveQueue(); res.json(item);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/ig/queue/:id", (req, res) => { queue = queue.filter((q) => q.id !== req.params.id); saveQueue(); res.json({ ok: true }); });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const due = queue.find((q) => q.status === "scheduled" && q.publishAt <= Date.now());
    if (!due) return;
    busy = true; due.status = "publishing"; saveQueue();
    try { Object.assign(due, { status: "published", ...(await publish(due)), doneAt: Date.now() }); }
    catch (e) { Object.assign(due, { status: "failed", error: e.message, doneAt: Date.now() }); }
    saveQueue(); busy = false;
  }, 20000);
  setInterval(() => accounts.forEach(refreshIfNeeded), 6 * 3600e3);
}
