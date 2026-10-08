import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canUpdateInPlace, stageUpdate } from "./mac-squirrel";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});
async function archive(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "reader-squirrel-test-"));
  temporary.push(directory);
  const path = join(directory, "Reader.zip");
  await writeFile(path, bytes);
  return path;
}
class FakeUpdater extends EventEmitter {
  feed = "";
  constructor(private readonly fetchUpdate: (feed: string) => Promise<void>) {
    super();
  }
  setFeedURL({ url }: { url: string; serverType: "json" }) {
    this.feed = url;
  }
  checkForUpdates() {
    this.fetchUpdate(this.feed).then(
      () => this.emit("update-downloaded"),
      (error) => this.emit("error", error),
    );
  }
}

it("updates in place only from a certificate signature", async () => {
  const run = (stderr: string) => async () => ({ stdout: "", stderr });
  expect(
    await canUpdateInPlace(
      "/Applications/Reader.app",
      run("Signature size=9000\nAuthority=Reader Self-Signed\n"),
    ),
  ).toBe(true);
  expect(
    await canUpdateInPlace(
      "/Applications/Reader.app",
      run("Signature=adhoc\n"),
    ),
  ).toBe(false);
  expect(
    await canUpdateInPlace("/Applications/Reader.app", async () => {
      throw new Error("code object is not signed at all");
    }),
  ).toBe(false);
});

it("serves the verified archive to Squirrel on loopback under a secret path", async () => {
  const bytes = Buffer.from("PK\u0003\u0004 verified archive");
  let received: Buffer | undefined;
  let feed = "";
  const updater = new FakeUpdater(async (url) => {
    feed = url;
    const origin = new URL(url);
    expect(origin.hostname).toBe("127.0.0.1");
    expect((await fetch(`${origin.origin}/feed.json`)).status).toBe(404);
    const { url: download } = await (await fetch(url)).json();
    expect(new URL(download).origin).toBe(origin.origin);
    received = Buffer.from(await (await fetch(download)).arrayBuffer());
  });
  await stageUpdate(updater, await archive(bytes));
  expect(received).toEqual(bytes);
  expect(feed).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/feed\.json$/);
  await expect(fetch(feed)).rejects.toThrow();
  expect(updater.listenerCount("error")).toBe(0);
});

it("reports a Squirrel failure and stops serving", async () => {
  let feed = "";
  const updater = new FakeUpdater(async (url) => {
    feed = url;
    throw new Error("Code signature did not pass validation");
  });
  await expect(
    stageUpdate(updater, await archive(Buffer.from("PK"))),
  ).rejects.toThrow("Code signature did not pass validation");
  await expect(fetch(feed)).rejects.toThrow();
});
