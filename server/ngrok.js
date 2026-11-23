// Starts an ngrok tunnel on a fixed domain when NGROK_DOMAIN is set, e.g. "my-name.ngrok-free.app".
// It gives this server a stable public HTTPS address that is used for
//   - PUBLIC_BASE_URL  (Instagram downloads the video from here)
//   - IG_REDIRECT_URI  (the "Log in with Instagram" OAuth callback)
// unless those are set explicitly in .env.
import spawn from "cross-spawn";

export const ngrok = { url: null, state: "off", error: null };

export function setupNgrokEnv() {
  const domain = (process.env.NGROK_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) return null;
  const url = `https://${domain}`;
  process.env.PUBLIC_BASE_URL ||= url;
  process.env.IG_REDIRECT_URI ||= `${url}/api/ig/callback`;
  return { domain, url };
}

export function startNgrok(port) {
  const cfg = setupNgrokEnv();
  if (!cfg) return;
  const bin = process.env.NGROK || "ngrok";
  const args = ["http", `--url=${cfg.url}`, String(port), "--log=stdout", "--log-format=logfmt"];
  if (process.env.NGROK_AUTHTOKEN) args.push(`--authtoken=${process.env.NGROK_AUTHTOKEN}`);
  ngrok.state = "starting";
  let proc;
  try { proc = spawn(bin, args, { env: process.env }); }
  catch (e) { ngrok.state = "error"; ngrok.error = String(e); return; }
  const onData = (d) => {
    const s = String(d);
    if (/started tunnel|url=https:\/\//.test(s)) { ngrok.state = "online"; ngrok.url = cfg.url; ngrok.error = null; console.log(`ngrok: ${cfg.url} -> http://localhost:${port}`); }
    const err = s.match(/lvl=(?:eror|crit)[^\n]*?err="?([^"\n]+)/);
    if (err) { ngrok.state = "error"; ngrok.error = err[1].slice(0, 300); console.warn("ngrok:", ngrok.error); }
  };
  proc.stdout?.on("data", onData); proc.stderr?.on("data", onData);
  proc.on("error", (e) => { ngrok.state = "error"; ngrok.error = `ngrok not found (${e.code || e.message}). Install it and run: ngrok config add-authtoken <token>`; console.warn(ngrok.error); });
  proc.on("close", (code) => { if (ngrok.state !== "error") { ngrok.state = "error"; ngrok.error = `ngrok exited (${code})`; } });
  const stop = () => { try { proc.kill(); } catch {} };
  process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(0); }); process.on("SIGTERM", () => { stop(); process.exit(0); });
}
