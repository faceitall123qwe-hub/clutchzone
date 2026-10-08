"""Cuts the raw takes from scripts/footage.py into store previews and vertical shorts.

    py -3.14 scripts/edit.py      # run from the project folder; reads marketing/raw, writes marketing/out
"""
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW, OUT, FONT = Path("marketing/raw"), Path("marketing/out"), "marketing/fonts/LilitaOne-Regular.ttf"
OUT.mkdir(parents=True, exist_ok=True)
TMP = OUT / "tmp"
TMP.mkdir(exist_ok=True)
X264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30"]
AAC = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def normalised(take):
    """MediaRecorder's webm has no duration and a variable frame rate: make a seekable 30 fps copy once."""
    dst = TMP / f"{take}.mp4"
    if not dst.exists():
        ff("-i", str(RAW / f"{take}.webm"), "-vf", "fps=30", *X264, "-crf", "14", *AAC, str(dst))
    return dst


def moments(take, before=1.7, after=0.6):
    kills = json.load(open(RAW / f"{take}.json"))["kills"]
    spans = []
    for k in kills:
        s, e = max(0.0, k - before), k + after
        if spans and s < spans[-1][1] + 0.3:
            spans[-1] = (spans[-1][0], e)  # two kills close together: one longer moment
        else:
            spans.append((s, e))
    return spans


def clip(src, start, dur, dst, vf, audio):
    ff("-ss", f"{start:.2f}", "-i", str(src), "-t", f"{dur:.2f}", "-vf", vf, *X264, *(AAC if audio else ["-an"]), str(dst))


def still(png, dur, dst, vf, audio):
    inputs = ["-loop", "1", "-t", f"{dur:.2f}", "-i", str(png)]
    if audio:
        inputs += ["-f", "lavfi", "-t", f"{dur:.2f}", "-i", "anullsrc=r=48000:cl=stereo"]
    ff(*inputs, "-vf", vf, *X264, *(AAC if audio else ["-an"]), "-shortest", str(dst))


def concat(parts, dst):
    lst = TMP / f"{dst.stem}.txt"
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in parts))
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(dst))


def pick(takes, limit):
    """Moments from the takes in turn, so every map shows up, until the time runs out."""
    lists = [[(t, s, e) for s, e in moments(t)] for t in takes]
    out, total = [], 0.0
    while any(lists) and total < limit:
        for l in lists:
            if l and total < limit:
                t, s, e = l.pop(0)
                out.append((t, s, min(e - s, limit - total)))
                total += out[-1][2]
    return [m for m in out if m[2] > 0.8]


def preview(name, takes, cover, size, crop):
    """CrazyGames: the cover as the first frame, then gameplay; no sound, at most 20 s."""
    w, h = size
    parts = [TMP / f"{name}-0.mp4"]
    still(cover, 1.5, parts[0], f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}", False)
    for i, (t, s, d) in enumerate(pick(takes, 18.0)):
        parts.append(TMP / f"{name}-{i + 1}.mp4")
        clip(normalised(t), s, d, parts[-1], f"{crop}scale={w}:{h}", False)
    concat(parts, OUT / f"{name}.mp4")


def end_card(path, cover):
    """Last frame of a short: the portrait cover, darkened, with where to play."""
    img = Image.open(cover).convert("RGB")
    img = img.resize((1080, int(img.height * 1080 / img.width))).crop((0, 0, 1080, 1920)) if img.height * 1080 / img.width >= 1920 \
        else img.resize((int(img.width * 1920 / img.height), 1920)).crop((0, 0, 1080, 1920))
    img = Image.blend(img.filter(ImageFilter.GaussianBlur(16)), Image.new("RGB", img.size, (12, 16, 26)), 0.6)
    g = ImageDraw.Draw(img)

    def text(s, y, size, fill):
        f = ImageFont.truetype(FONT, size)
        w = g.textlength(s, font=f)
        g.text(((1080 - w) / 2, y), s, font=f, fill=fill, stroke_width=size // 8, stroke_fill=(20, 22, 28))

    text("CLUTCHZONE", 560, 150, (255, 210, 63))
    text("PLAY FREE", 860, 120, (255, 255, 255))
    text("IN YOUR BROWSER", 1000, 84, (255, 255, 255))
    text("clutchzone.pro", 1180, 110, (124, 255, 107))
    img.save(path)


def short(name, takes, hooks, limit=13.0):
    """TikTok / Shorts / Reels: 1080 x 1920 with game sound, a hook on screen, an end card."""
    parts = []
    for i, (t, s, d) in enumerate(pick(takes, limit)):
        parts.append(TMP / f"{name}-{i}.mp4")
        clip(normalised(t), s, d, parts[-1], "scale=1080:1920", True)
    card = TMP / "endcard.png"
    if not card.exists():
        end_card(card, "marketing/covers/cover-portrait.png")
    parts.append(TMP / f"{name}-end.mp4")
    still(card, 2.5, parts[-1], "scale=1080:1920", True)
    body = TMP / f"{name}-body.mp4"
    concat(parts, body)
    # big outlined captions in the safe area (away from the app's buttons on the right and at the bottom)
    draws = []
    for text, start, end in hooks:
        for j, line in enumerate(text.split("|")):
            line = line.replace("'", "’").replace(":", "\\:")
            draws.append(f"drawtext=fontfile={FONT}:text='{line}':fontsize=92:fontcolor=white:borderw=10:bordercolor=0x14161c"
                         f":x=(w-text_w)/2:y={300 + j * 115}:enable='between(t,{start},{end})'")
    ff("-i", str(body), "-vf", ",".join(draws), *X264, "-c:a", "copy", str(OUT / f"{name}.mp4"))


LAND = ["dockyard-land", "frostbite-land", "outpost-land"]
VERT = ["dockyard-vert", "frostbite-vert", "outpost-vert"]
preview("crazygames-landscape", LAND, "marketing/covers/cover-landscape.png", (1920, 1080), "")
preview("crazygames-portrait", VERT, "marketing/covers/cover-portrait.png", (1080, 1620), "crop=1080:1620:0:150,")
short("short-1-browser", VERT, [("THIS SHOOTER|RUNS IN YOUR|BROWSER", 0, 2.8), ("NO DOWNLOAD.|FREE.", 6.5, 9)])
short("short-2-pov", ["frostbite-vert", "outpost-vert", "dockyard-vert"],
      [("POV: YOU FOUND|A FREE SHOOTER|IN YOUR BROWSER", 0, 3)])
short("short-3-hats", ["outpost-vert", "dockyard-vert", "frostbite-vert"],
      [("LEVEL UP|UNLOCK HATS|BEAT YOUR FRIENDS", 0, 3), ("PLAYS ON ANY|LAPTOP", 7, 9.5)])
print("done:", *sorted(p.name for p in OUT.glob("*.mp4")))
