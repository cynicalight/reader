import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Start development with pnpm dev");
execFileSync(
  process.execPath,
  [pnpm, "--filter", "@reader/processor", "build"],
  {
    stdio: "inherit",
  },
);
const token = randomBytes(32).toString("hex");
execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./build-server.mjs", import.meta.url))],
  { stdio: "inherit" },
);
const binary =
  process.platform === "win32" ? "reader-server.exe" : "reader-server";
const server = spawn(
  `../desktop/bin/${binary}`,
  ["--data", "../../.reader", "--port", "17840"],
  {
    cwd: new URL("../apps/server/", import.meta.url),
    env: {
      ...process.env,
      READER_TOKEN: token,
      READER_NODE: process.execPath,
      READER_PROCESSOR: fileURLToPath(
        new URL("../apps/processor/dist/main.mjs", import.meta.url),
      ),
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
let web;
createInterface({ input: server.stdout }).once("line", () => {
  web = spawn(process.execPath, [pnpm, "--filter", "@reader/web", "dev"], {
    stdio: "inherit",
  });
  console.log(`\nReader: http://127.0.0.1:5173/#token=${token}\n`);
  web.once("exit", () => stop());
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.kill("SIGINT");
  web?.kill("SIGTERM");
}
server.once("exit", () => stop());
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
  });
