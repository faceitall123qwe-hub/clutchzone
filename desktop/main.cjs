// Clutchzone as a Windows app: one window with the game build from ../ (copied into game/ by `npm run build:desktop`).
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Served as app://game/ rather than file://, so ES modules, fetch and localStorage behave as on the web.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const root = path.join(__dirname, "game");

app.whenReady().then(() => {
  protocol.handle("app", (req) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(root)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null); // no Ctrl+W / Ctrl+R accelerators in the middle of a fight
  const win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 960, minHeight: 540,
    title: "Clutchzone", backgroundColor: "#0e1116", icon: path.join(__dirname, "icon.png"),
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  void win.loadURL("app://game/index.html");
});

app.on("window-all-closed", () => app.quit());
