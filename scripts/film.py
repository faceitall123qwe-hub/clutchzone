"""Gameplay footage filmed frame by frame (see src/film.ts): an even 60 fps however slow the machine, with
the game's own sound in sync. The autopilot ambushes bots, as in footage.py; only frames where we're alive
in a live round are kept. Writes <out>.mp4 and <out>.json (kill times in seconds into the video, and the
weapon of each kill).
Needs `npm run dev` and `npm run server:dev` (the server only names the room; the match runs in the page).

    py -3.14 scripts/film.py marketing/raw/plaza-film 1080x1920 plaza 40 [slot:distance:head:strafe,...]
"""
import base64
import json
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

out, size, map_id, seconds = Path(sys.argv[1]), sys.argv[2], sys.argv[3], float(sys.argv[4])
w, h = map(int, size.split("x"))
WEAPONS = [(0, 9, False, 1), (0, 11, False, -1), (1, 6, True, 1), (0, 8, False, 0)]  # slot, distance, aim at head, strafe
if len(sys.argv) > 5:
    WEAPONS = [(int(s), float(d), hd == "1", float(r)) for s, d, hd, r in (x.split(":") for x in sys.argv[5].split(","))]
FPS = 60
frames_dir = out.parent / f"{out.name}-frames"
shutil.rmtree(frames_dir, ignore_errors=True)
frames_dir.mkdir(parents=True)
KILLS = "JSON.parse(localStorage.getItem('clutchzone-profile') || '{\"stats\":{\"kills\":0}}').stats.kills"

with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=["--window-size=1300,800", "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
    pg = b.new_page(viewport={"width": w, "height": h})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(f"http://localhost:5173/?room=pub-film{int(time.time()) % 100000}")
    pg.wait_for_timeout(2000)
    pg.evaluate("__game.film()")
    pg.evaluate(f"__game.join('{map_id}'); 0")
    for _ in range(200):  # warmup and freeze time, unfilmed
        pg.evaluate("__film.step(30)")
        s = pg.evaluate("__game.state()")
        if s.get("round") and s["round"]["phase"] == "live" and s["alive"]:
            break
    pg.evaluate("__game.god(true)")
    pg.evaluate("__film.step(2)")

    times, kills, slots, n = [], [], [], 0
    kills_before = pg.evaluate(KILLS)
    plan_i, engaged, settle = 0, None, 0
    t0 = time.time()
    while n < seconds * FPS:
        s = pg.evaluate("__game.state()")
        if not s["alive"] or s["round"]["phase"] != "live":
            pg.evaluate("__film.step(6)")
            engaged = None
            continue
        if engaged is None and settle <= 0:
            slot, dist, head, strafe = WEAPONS[plan_i % len(WEAPONS)]
            plan_i += 1
            pg.evaluate(f"__game.weapon({slot})")
            pg.evaluate("__film.step(30)")  # draw the weapon off camera
            if not pg.evaluate(f"__game.ambush({dist}, 0.55)"):
                pg.evaluate("__film.step(20)")
                continue
            pg.evaluate(f"__game.auto(true, {str(head).lower()}, {strafe})")
            engaged = n
        t, jpg = pg.evaluate("() => { __film.step(1); return [__film.time(), __film.frame()]; }")
        (frames_dir / f"{n:06d}.jpg").write_bytes(base64.b64decode(jpg))
        times.append(t)
        n += 1
        if engaged is not None and n % 6 == 0:
            k = pg.evaluate(KILLS)
            if k > kills_before:
                kills_before = k
                kills.append(round(n / FPS, 3))
                slots.append(s["slot"])
                engaged, settle = None, int(0.8 * FPS)  # keep filming the kill a moment before the next ambush
            elif n - engaged > 4 * FPS:
                engaged = None
            if engaged is None:
                pg.evaluate("__game.auto(false)")
        settle -= 1
    pg.evaluate("__game.auto(false)")
    sound = pg.evaluate("__film.sound()")
    print(f"{n} frames in {time.time() - t0:.0f} s, errors: {errors[:3]}")
    b.close()

# the sound: for each kept frame, the 1/60 s of audio that led up to it
full = out.parent / f"{out.name}-full.wav"
full.write_bytes(base64.b64decode(sound))
with wave.open(str(full)) as src:
    rate, ch, width = src.getframerate(), src.getnchannels(), src.getsampwidth()
    pcm = src.readframes(src.getnframes())
per = rate // FPS
step = ch * width
audio = b"".join(pcm[max(0, round(t * rate) - per) * step:round(t * rate) * step].ljust(per * step, b"\0") for t in times)
cut = out.parent / f"{out.name}.wav"
with wave.open(str(cut), "wb") as dst:
    dst.setnchannels(ch)
    dst.setsampwidth(width)
    dst.setframerate(rate)
    dst.writeframes(audio)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(frames_dir / "%06d.jpg"), "-i", str(cut),
                "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-shortest", str(out.with_suffix(".mp4"))], check=True)
shutil.rmtree(frames_dir)
full.unlink()
cut.unlink()
json.dump({"kills": kills, "weapons": slots, "size": [w, h], "map": map_id, "fps": FPS}, open(out.with_suffix(".json"), "w"))
print(f"{out.with_suffix('.mp4')}: {len(kills)} kills at {kills}")
