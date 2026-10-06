import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const scripts = dirname(fileURLToPath(import.meta.url));
const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "reader-release-test-"));
  temporary.push(cwd);
  await mkdir(join(cwd, "apps/desktop"), { recursive: true });
  await mkdir(join(cwd, "release"));
  for (const path of ["package.json", "apps/desktop/package.json"])
    await writeFile(join(cwd, path), JSON.stringify({ version: "0.2.0" }));
  return cwd;
}
function run(script, cwd, env = {}, args = []) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "", GITHUB_OUTPUT: "", ...env },
    timeout: 10000,
  });
}
async function installers(cwd) {
  const files = [];
  for (const target of ["mac-arm64.dmg"]) {
    const file = `Reader-0.2.0-${target}`;
    const bytes = Buffer.alloc(1024 * 1024 + 512);
    if (target.endsWith("dmg")) bytes.write("koly", bytes.length - 512);
    else bytes.write("MZ", 0);
    await writeFile(join(cwd, "release", file), bytes);
    files.push({ file, bytes });
  }
  return files;
}
test("release refuses a version mismatch before building", async () => {
  const cwd = await fixture();
  const tag = run("release-source.mjs", cwd, { RELEASE_TAG: "v9.9.9" });
  expect(tag.status).not.toBe(0);
  expect(tag.stderr).toContain("Release tag must match app version");
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ version: "0.3.0" }),
  );
  const manifests = run("release-source.mjs", cwd);
  expect(manifests.status).not.toBe(0);
  expect(manifests.stderr).toContain("Root and desktop versions must match");
});
test("release refuses missing or unexpected artifacts", async () => {
  const cwd = await fixture();
  expect(run("release-assets.mjs", cwd).status).not.toBe(0);
  await installers(cwd);
  await rm(join(cwd, "release/Reader-0.2.0-mac-arm64.dmg"));
  expect(run("release-assets.mjs", cwd).status).not.toBe(0);
  await installers(cwd);
  await writeFile(join(cwd, "release/Reader-0.2.0-mac-x64.dmg"), "unexpected");
  expect(run("release-assets.mjs", cwd).status).not.toBe(0);
});
test("release checks installer format before writing hashes", async () => {
  const cwd = await fixture();
  const files = await installers(cwd);
  await writeFile(
    join(cwd, "release", files[0].file),
    Buffer.alloc(1024 * 1024 + 512),
  );
  const result = run("release-assets.mjs", cwd);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Invalid installer format");
});
test("complete artifacts get correct hashes and upload requires the matching tag", async () => {
  const cwd = await fixture();
  const files = await installers(cwd);
  expect(run("release-assets.mjs", cwd).status).toBe(0);
  const hashes = await readFile(join(cwd, "release/SHA256SUMS.txt"), "utf8");
  for (const { file, bytes } of files)
    expect(hashes).toContain(
      `${createHash("sha256").update(bytes).digest("hex")}  ${file}\n`,
    );
  const upload = run("release-assets.mjs", cwd, { RELEASE_TAG: "v0.3.0" }, [
    "--upload",
  ]);
  expect(upload.status).not.toBe(0);
  expect(upload.stderr).toContain("Release tag must match app version");
});
