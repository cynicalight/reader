import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === "win32";
const source = windows
  ? join(root, "release/win-unpacked")
  : join(
      root,
      `release/mac${process.arch === "arm64" ? "-arm64" : ""}/Reader.app`,
    );
const temporary = await mkdtemp(join(tmpdir(), "reader-package-smoke-"));
const isolated = join(temporary, windows ? "Reader" : "Reader.app");
const app = windows ? isolated : join(isolated, "Contents");
const resources = join(app, windows ? "resources" : "Resources");
const electron = join(app, windows ? "Reader.exe" : "MacOS/Reader");
let child;
let stopped;
try {
  // Node resolves modules relative to the script, regardless of cwd. Relocate the
  // whole app so a missing packaged dependency cannot fall back to the checkout.
  await cp(source, isolated, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  if (!windows) {
    const signature = spawnSync(
      "codesign",
      ["--verify", "--deep", "--strict", dirname(app)],
      { stdio: "inherit" },
    );
    if (signature.error) throw signature.error;
    assert.equal(signature.status, 0, "Packaged ad-hoc signature is invalid");
  }
  const native = spawnSync(electron, [join(resources, "processor/smoke.mjs")], {
    cwd: temporary,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    timeout: 60000,
  });
  if (native.error) throw native.error;
  assert.equal(native.status, 0, "Packaged native processor smoke failed");
  const token = randomBytes(32).toString("hex");
  child = spawn(
    join(resources, "bin", `reader-server${windows ? ".exe" : ""}`),
    [
      "--port",
      "0",
      "--data",
      join(temporary, "library"),
      "--web",
      join(resources, "web"),
    ],
    {
      cwd: temporary,
      env: {
        ...process.env,
        READER_TOKEN: token,
        READER_NODE: electron,
        READER_PROCESSOR: join(resources, "processor/main.mjs"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  stopped = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Packaged sidecar readiness timeout")),
      20000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Sidecar exited: ${code}`)));
    lines.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
  });
  lines.close();
  assert.equal(new URL(ready.url).hostname, "127.0.0.1");
  const request = (path, authorized = true) =>
    fetch(ready.url + path, {
      headers: authorized ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    });
  assert.equal((await request("/api/documents", false)).status, 401);
  const documents = await request("/api/documents");
  assert.equal(documents.status, 200);
  assert.deepEqual(await documents.json(), []);
  const web = await request("/");
  assert.equal(web.status, 200);
  assert.match(await web.text(), /<div id="root">/);
  assert.equal((await request("/samples/reading-notes.pdf")).status, 200);
  console.log(
    "Packaged Go service, SQLite, API authentication and web resources passed.",
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      await stopped;
    } finally {
      clearTimeout(timer);
    }
  } else if (stopped) await stopped;
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
