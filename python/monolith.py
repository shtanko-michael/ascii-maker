"""ASCII monolith — original scene: a faceless hooded figure fused to a red
monolith, glowing roots dripping down, two small silhouettes below.
Top: ASCII render. Bottom: scrolling source code. Seamless loop.
usage: python3 monolith.py [image.jpg] && ffmpeg -r 30 -i fr/%04d.png -pix_fmt yuv420p -crf 20 monolith.mp4
"""
import os, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

W, H = 720, 1280            # phone video
SH = 860                    # height of the ASCII scene area
CELL = 8                    # pixels per glyph cell
LOOP = 180                  # frames per loop (6 s @ 30 fps)
TAU = 2 * np.pi
RAMP = " .,:;-=+*cox%#@"    # dark -> bright
def load_font(size):
    """first monospace font found on Windows / macOS / Linux"""
    for p in ("C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf",
              "/System/Library/Fonts/Menlo.ttc", "/Library/Fonts/Courier New.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "DejaVuSansMono.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


FONT = load_font(10)
CFONT = load_font(15)
rng = np.random.default_rng(7)
YY, XX = np.mgrid[0:SH, 0:W].astype(np.float32)


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ---------- static layers -------------------------------------------------
def build_scene():
    """returns (lum, red) static maps in 0..1"""
    lum = np.zeros((SH, W), np.float32)
    red = np.zeros((SH, W), np.float32)
    # red monolith: tall slab with a wide lintel (not a cross: no upper post)
    slab = np.zeros_like(lum)
    cv2.rectangle(slab, (250, 120), (470, SH), 1, -1)
    cv2.rectangle(slab, (120, 120), (600, 200), 1, -1)
    red += slab * 0.75
    # hooded faceless figure: rounded hood + body column, arms hanging down
    fig = np.zeros_like(lum)
    cv2.ellipse(fig, (360, 220), (55, 70), 0, 0, 360, 1, -1)       # hood
    cv2.ellipse(fig, (360, 380), (95, 150), 0, 0, 360, 1, -1)      # torso
    cv2.ellipse(fig, (265, 360), (22, 120), 8, 0, 360, 1, -1)      # left arm
    cv2.ellipse(fig, (455, 360), (22, 120), -8, 0, 360, 1, -1)     # right arm
    face = np.zeros_like(lum)
    cv2.ellipse(face, (360, 235), (30, 42), 0, 0, 360, 1, -1)      # dark void, no features
    fig = cv2.GaussianBlur(fig, (0, 0), 4)
    folds = 0.75 + 0.25 * np.sin(XX / 9 + np.sin(YY / 40) * 2)     # cloth folds
    lum = np.maximum(lum, fig * folds)
    red *= 1 - fig                                                  # figure occludes slab
    red *= 0.55 + 0.45 * np.abs(np.sin(XX / 7)) * (0.6 + 0.4 * rng.random((SH, W)))  # stone grain
    lum *= 1 - cv2.GaussianBlur(face, (0, 0), 6) * 0.95
    # two small silhouettes in front (pure black cut-outs over a glow)
    glow = np.exp(-((XX - 360) ** 2) / 4000 - ((YY - SH) ** 2) / 30000)
    red = np.maximum(red, glow * 0.9)
    sil = np.zeros_like(lum)
    for cx, h in ((320, 150), (400, 165)):
        cv2.ellipse(sil, (cx, SH - h - 16), (15, 18), 0, 0, 360, 1, -1)   # head
        cv2.rectangle(sil, (cx - 20, SH - h), (cx + 20, SH), 1, -1)        # body
    # back-lit slit in the monolith behind the silhouettes
    slit = np.exp(-((XX - 360) ** 2) / 300) * ease((YY - 560) / 200)
    red = np.maximum(red, slit)
    lum = np.maximum(lum, slit * 0.55)
    # halo / bloom around the figure
    lum = np.maximum(lum, cv2.GaussianBlur(fig, (0, 0), 28) * 0.45)
    # soft red bokeh discs in the background
    bok = np.zeros_like(lum)
    for _ in range(6):
        cv2.circle(bok, (int(rng.uniform(0, W)), int(rng.uniform(80, SH - 80))),
                   int(rng.uniform(35, 75)), 1, -1)
    red = np.maximum(red, cv2.GaussianBlur(bok, (0, 0), 6) * 0.3)
    # floating embers
    emb = np.zeros_like(lum)
    for _ in range(250):
        cv2.circle(emb, (int(rng.uniform(0, W)), int(rng.uniform(0, SH))), 1, 1, -1)
    red = np.maximum(red, emb * 0.4)
    return lum, red, sil


def load_image(path):
    """external image -> (lum, red, sil). red = how 'red' each pixel is"""
    im = cv2.imread(path)[..., ::-1].astype(np.float32) / 255
    h, w = im.shape[:2]
    s = max(W / w, SH / h)                                  # cover-crop to scene
    im = cv2.resize(im, (int(w * s + 1), int(h * s + 1)), interpolation=cv2.INTER_AREA)
    y0, x0 = (im.shape[0] - SH) // 2, (im.shape[1] - W) // 2
    im = im[y0:y0 + SH, x0:x0 + W]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    red = np.clip((r - np.maximum(g, b)) * 1.6, 0, 1)        # saturated reds
    lum = np.clip(np.minimum(r, np.minimum(g, b)) * 1.15, 0, 1)  # white/grey part
    return lum, red, np.zeros_like(lum)


def roots_origin(lum):
    """roots hang from the bottom edge of the brightest blob"""
    ys, xs = np.nonzero(lum > np.percentile(lum, 97))
    if len(xs) == 0:
        return W / 2, SH * 0.55, 55
    return np.median(xs), np.percentile(ys, 90), max(20, xs.std() * 0.6)


import sys
IMG = sys.argv[1] if len(sys.argv) > 1 else None   # python3 monolith.py [image]
LUM, RED, SIL = load_image(IMG) if IMG else build_scene()
RX0, RY0, RSPREAD = roots_origin(LUM) if IMG else (360, 480, 55)

# ---------- animated roots dripping from the figure ----------------------
NR = 90
R_X = RX0 + rng.normal(0, RSPREAD, NR)
R_Y0 = RY0 + rng.uniform(-20, 20, NR)
R_LEN = rng.uniform(120, 330, NR)
R_P = rng.choice([LOOP, LOOP / 2, LOOP / 3], NR)   # divisors -> seamless loop
R_T0 = rng.uniform(0, LOOP, NR)
R_W = rng.uniform(3, 7, NR)


def roots(t):
    """white tendrils that grow down from the robe hem, then fade"""
    m = np.zeros((SH, W), np.float32)
    u = ((t - R_T0) / R_P) % 1.0
    for k in range(NR):
        a = ease(u[k] / 0.1) * ease((1 - u[k]) / 0.25)
        tip = R_Y0[k] + R_LEN[k] * u[k] ** 1.4
        ys = np.arange(int(R_Y0[k]), int(tip))
        if len(ys) < 2:
            continue
        xs = R_X[k] + 6 * np.sin(ys / 23 + k)              # wobble
        ramp = np.linspace(1.0, 0.3, len(ys))
        for y, x, r in zip(ys, xs, ramp):
            x0 = int(x)
            if 0 <= x0 < W - 2 and y < SH:
                m[y, x0:x0 + int(1 + R_W[k])] = np.maximum(m[y, x0:x0 + int(1 + R_W[k])], r * a)
    return cv2.GaussianBlur(m, (0, 0), 0.8)


def pulse(t):
    """slow breathing glow that runs downward over the monolith"""
    return 0.85 + 0.15 * np.sin(TAU * (YY / 120 - t / LOOP * 2))


# ---------- ASCII pass ---------------------------------------------------
def to_ascii(rgb):
    img = Image.new("RGB", (W, SH), (0, 0, 0))
    d = ImageDraw.Draw(img)
    small = cv2.resize(rgb, (W // CELL, SH // CELL), interpolation=cv2.INTER_AREA)
    lum = small.max(axis=2)
    for cy in range(small.shape[0]):
        for cx in range(small.shape[1]):
            v = lum[cy, cx]
            if v < 0.04:
                continue
            ch = RAMP[min(len(RAMP) - 1, int(v * (len(RAMP) - 1) + 0.5))]
            col = tuple(int(c * 255) for c in np.clip(small[cy, cx] / max(v, 1e-3) * (0.35 + 0.65 * v), 0, 1))
            d.text((cx * CELL, cy * CELL - 1), ch, fill=col, font=FONT)
    return img


CODE = open(__file__, encoding="utf-8").read().splitlines()
LH = 20


def code_panel(t):
    img = Image.new("RGB", (W, H - SH), (12, 12, 14))
    d = ImageDraw.Draw(img)
    d.line([(0, 0), (W, 0)], fill=(60, 20, 20))
    total = len(CODE) * LH
    off = (t / LOOP) * total                      # one full scroll per loop
    first = int(off // LH)
    for i in range(-1, (H - SH) // LH + 2):
        n = (first + i) % len(CODE)
        y = 12 + i * LH - (off % LH)
        line = CODE[n].replace("\t", "    ")
        if not line.strip():
            continue
        s = line.strip()
        col = (110, 110, 120) if s.startswith(("#", '"')) else \
              (230, 90, 90) if s.startswith(("def ", "return", "for ", "if ")) else (200, 200, 205)
        d.text((10, y), f"{n + 1:3d}", fill=(70, 70, 80), font=CFONT)
        d.text((52, y), line[:70], fill=col, font=CFONT)
    return img


def render(t):
    w = roots(t)
    p = pulse(t)
    flick = 0.92 + 0.08 * np.sin(TAU * t / LOOP * 3)
    r = np.clip(RED * p + LUM + w, 0, 1)
    g = np.clip(LUM * 0.95 + w, 0, 1) * flick
    b = np.clip(LUM + w, 0, 1) * flick
    rgb = np.dstack([r, g, b]) * (1 - SIL[..., None])
    frame = Image.new("RGB", (W, H))
    frame.paste(to_ascii(rgb.astype(np.float32)), (0, 0))
    frame.paste(code_panel(t), (0, SH))
    return frame


if __name__ == "__main__":
    os.makedirs("fr", exist_ok=True)
    for f in range(LOOP):
        render(f).save(f"fr/{f:04d}.png")
