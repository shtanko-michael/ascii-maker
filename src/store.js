// Tabs persistence: settings in localStorage, big blobs (images, uploaded audio) in IndexedDB.
import { FINE_DEFAULTS } from "./engine.js";

const KEY = "ascii-studio:tabs:v2";

export const DEFAULT_CAPTION = `The moon is just a gradient that learned to glow.
Red dusk, white light, characters falling like rain.

Every frame is code. Not a single pixel drawn by hand.

What would you feed into it? 👇`;

export function newProject(name = "Untitled", patch = {}) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    preset: "moon", hasImage: false, layout: "reels", seed: 7,
    ramp: "classic", tint: "blood", streaks: 60, streakGain: 0.6, pulse: 0.3, loopSec: 6,
    ...FINE_DEFAULTS,
    username: "ascii.maker", caption: DEFAULT_CAPTION,
    tags: ["asciiart", "generativeart", "creativecoding", "codeart", "darkart"],
    prompt: "", instrumental: true, musicSec: 30,
    musicUrl: null, musicName: "Original audio", musicBlob: false,
    igTargets: null, aiLabel: true,
    ...patch,
  };
}

export function loadTabs() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.tabs?.length) return { ...s, tabs: s.tabs.map((t) => ({ ...newProject(), ...t })) };
  } catch {}
  const p = newProject("Moon");
  return { tabs: [p], active: p.id };
}

export function saveTabs(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// ---- tiny IndexedDB key/value ----
let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open("ascii-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function putBlob(key, blob) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction("blobs", "readwrite"); tx.objectStore("blobs").put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch {}
}
export async function getBlob(key) {
  try {
    const d = await db();
    return await new Promise((res) => { const r = d.transaction("blobs").objectStore("blobs").get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  } catch { return null; }
}
export async function delBlob(key) {
  try { const d = await db(); d.transaction("blobs", "readwrite").objectStore("blobs").delete(key); } catch {}
}

// downscale an uploaded image so storage stays small
export function shrinkImage(file, max = 1440) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => res(b), "image/jpeg", 0.92);
    };
    img.src = URL.createObjectURL(file);
  });
}
export function blobToImage(blob) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(blob); });
}
