// Run using the workspace Electron executable. Numeric telemetry only, no screenshots or visual assertions.
const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "reader-benchmark-")));
app.commandLine.appendSwitch("js-flags", "--expose-gc");
const results = [];
app.whenReady().then(async () => {
  console.log(JSON.stringify({ machine: os.cpus()[0].model, arch: os.arch(), os: os.release(), electron: process.versions.electron }));
  for (const bytes of [10240, 102400, 1048500]) {
    for (const animated of [false, true]) {
      const window = new BrowserWindow({ show: false, width: 420, height: 800, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`benchmark timeout ${bytes}/${animated}`)), 180000);
        window.webContents.on("console-message", (_, level, message) => {
          if (message.startsWith("READER_BENCHMARK=")) {
            const result = JSON.parse(message.slice("READER_BENCHMARK=".length));
            results.push(result); console.log(JSON.stringify(result)); clearTimeout(timer); resolve();
          }
          if (level >= 3) console.error(message);
        });
        window.loadURL(`http://127.0.0.1:15173/__streaming-benchmark?bytes=${bytes}&animated=${animated}`).catch(reject);
      });
      window.destroy();
    }
  }
  if (process.env.READER_BENCHMARK_OUTPUT) fs.writeFileSync(process.env.READER_BENCHMARK_OUTPUT, JSON.stringify(results, null, 2) + "\n");
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
