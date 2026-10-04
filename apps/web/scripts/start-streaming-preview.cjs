// Run from repository root: node apps/web/scripts/start-streaming-preview.cjs <backend-binary>
// Uses only a new disposable library, and serves this worktree's production renderer.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const binary = process.argv[2];
if (!binary) throw new Error("Pass the verified backend reader-server binary.");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "reader-frontend-preview-"));
const readyPath = path.join(data, "preview.json");
const child = spawn(binary, ["--data", data, "--port", "0", "--web", path.resolve("apps/web/dist")], { stdio: ["ignore", "pipe", "inherit"] });
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const end = buffer.indexOf("\n");
  if (end < 0) return;
  const ready = JSON.parse(buffer.slice(0, end));
  fs.writeFileSync(readyPath, JSON.stringify({ ...ready, data, pid: child.pid }), { mode: 0o600 });
  console.log(JSON.stringify({ url: ready.url, readyPath, data }));
  child.stdout.removeAllListeners("data");
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code || 0));
