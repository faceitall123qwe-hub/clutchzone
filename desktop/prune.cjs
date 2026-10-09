// The game is English only: drop Chromium's other UI translations (~45 MB) from the packaged app.
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "out", "Clutchzone-win32-x64", "locales");
for (const f of fs.readdirSync(dir)) if (f !== "en-US.pak") fs.rmSync(path.join(dir, f));
