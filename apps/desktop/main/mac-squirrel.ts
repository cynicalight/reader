import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

export interface SquirrelUpdater {
  setFeedURL(options: { url: string; serverType: "json" }): void;
  checkForUpdates(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): unknown;
}

// Squirrel.Mac only accepts an update signed like the running app. An ad-hoc
// signature pins one exact build, so such an app can never update in place.
type Run = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stderr: string }>;
export async function canUpdateInPlace(
  bundle: string,
  run: Run = promisify(execFile),
): Promise<boolean> {
  try {
    const { stderr } = await run("/usr/bin/codesign", ["-dv", bundle], {
      timeout: 10_000,
    });
    return /^Authority=/m.test(stderr) && !/^Signature=adhoc$/m.test(stderr);
  } catch {
    return false;
  }
}

// Hands an already verified archive to Squirrel.Mac. Squirrel only reads from
// a feed URL, so serve the file on loopback under an unguessable path for the
// duration of the download. Squirrel installs it when the app next quits.
export async function stageUpdate(
  updater: SquirrelUpdater,
  archive: string,
): Promise<void> {
  const { size } = await stat(archive);
  const secret = randomBytes(32).toString("hex");
  let base = "";
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === `/${secret}/feed.json`) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ url: `${base}/update.zip` }));
    } else if (
      request.method === "GET" &&
      request.url === `/${secret}/update.zip`
    ) {
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": size,
      });
      createReadStream(archive).pipe(response);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${secret}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => done(new Error("更新准备超时")),
        10 * 60 * 1000,
      );
      const done = (error?: unknown) => {
        clearTimeout(timer);
        updater.removeListener("update-downloaded", downloaded);
        updater.removeListener("update-not-available", missing);
        updater.removeListener("error", failed);
        if (error) reject(error);
        else resolve();
      };
      const downloaded = () => done();
      const missing = () => done(new Error("更新服务没有返回安装包"));
      const failed = (error: unknown) =>
        done(error instanceof Error ? error : new Error(String(error)));
      updater.on("update-downloaded", downloaded);
      updater.on("update-not-available", missing);
      updater.on("error", failed);
      try {
        updater.setFeedURL({
          url: `${base}/feed.json`,
          serverType: "json",
        });
        updater.checkForUpdates();
      } catch (error) {
        failed(error);
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
