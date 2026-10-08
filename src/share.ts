/** A picture of how your match went, to post anywhere, with a link that brings friends in with a bonus. */
export type MatchSummary = {
  map: string; kills: number; deaths: number; heads: number; won: boolean | null; score: [number, number] | null;
  level: number; name: string; shot?: HTMLCanvasElement; // a frame from one of our kills
};

export const inviteUrl = (profileId: string) => `${location.origin}/?ref=${profileId}`;

/** 1200 × 630, the size link previews and most feeds use. */
export async function drawCard(m: MatchSummary): Promise<HTMLCanvasElement> {
  await document.fonts.load('80px "Lilita One"').catch(() => {});
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 630);
  sky.addColorStop(0, "#2f8ff0");
  sky.addColorStop(1, "#c8f0ff");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = "#f4c98c"; // sand
  g.fillRect(0, 470, 1200, 160);
  g.fillStyle = "#14161c";
  g.fillRect(0, 466, 1200, 8);

  const text = (s: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = "left") => {
    g.font = `${size}px "Lilita One", system-ui, sans-serif`;
    g.textAlign = align;
    g.lineJoin = "round";
    g.lineWidth = size / 6;
    g.strokeStyle = "#14161c";
    g.strokeText(s, x, y);
    g.fillStyle = fill;
    g.fillText(s, x, y);
  };
  text("CLUTCHZONE", 60, 120, 96, "#ffd23f");
  text(`${m.name} · level ${m.level}`, 64, 190, 40, "#ffffff");
  const result = m.won === null ? "Just played" : m.won ? "VICTORY" : "Defeat";
  text(result + (m.score ? `  ${m.score[0]} : ${m.score[1]}` : ""), 64, 280, 72, m.won ? "#7cff6b" : "#ffffff");
  text(`${m.kills} kills · ${m.deaths} deaths · ${m.heads} headshots`, 64, 360, 46, "#ffffff");
  text(`on ${m.map}`, 64, 420, 38, "#ffe08a");
  if (m.shot) { // the kill, like a photo pinned to the card
    g.save();
    g.translate(948, 250);
    g.rotate(0.05);
    g.fillStyle = "#14161c";
    g.fillRect(-252, -152, 504, 304);
    g.fillStyle = "#ffffff";
    g.fillRect(-244, -144, 488, 288);
    g.drawImage(m.shot, -232, -132, 464, 264);
    g.restore();
  }
  text("Beat me — free in your browser", 600, 545, 44, "#ffffff", "center");
  text(location.host || "clutchzone.pro", 600, 605, 48, "#ffd23f", "center");
  return c;
}

/** Native share sheet with the picture where the browser allows it, otherwise the link is copied. */
export async function share(m: MatchSummary, url: string): Promise<"shared" | "copied"> {
  const textLine = `I went ${m.kills}-${m.deaths} in Clutchzone, a free shooter in the browser. Beat me:`;
  const canvas = await drawCard(m);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  const file = blob ? new File([blob], "clutchzone.png", { type: "image/png" }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${textLine} ${url}` });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ text: textLine, url });
      return "shared";
    }
  } catch { /* cancelled: fall back to copying */ }
  await navigator.clipboard.writeText(`${textLine} ${url}`).catch(() => {});
  return "copied";
}

export async function download(m: MatchSummary): Promise<void> {
  const canvas = await drawCard(m);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "clutchzone.png";
  a.click();
}
