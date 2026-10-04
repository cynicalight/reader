import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const { version } = JSON.parse(
  await readFile("apps/desktop/package.json", "utf8"),
);
const expected = [
  `Reader-${version}-mac-arm64.dmg`,
  `Reader-${version}-mac-x64.dmg`,
  `Reader-${version}-win-x64.exe`,
].sort();
const actual = (await readdir("release"))
  .filter((file) => file !== "SHA256SUMS.txt")
  .sort();
assert.deepEqual(
  actual,
  expected,
  "Release must contain exactly all three installers",
);
const checksums = [];
for (const file of expected) {
  const bytes = await readFile(`release/${file}`);
  assert.ok(
    bytes.length > 1024 * 1024,
    `Installer is unexpectedly small: ${file}`,
  );
  const mac = file.endsWith(".dmg");
  assert.equal(
    mac
      ? bytes.subarray(-512, -508).toString()
      : bytes.subarray(0, 2).toString(),
    mac ? "koly" : "MZ",
    `Invalid installer format: ${file}`,
  );
  checksums.push(
    `${createHash("sha256").update(bytes).digest("hex")}  ${file}`,
  );
}
await writeFile("release/SHA256SUMS.txt", checksums.join("\n") + "\n");
console.log(checksums.join("\n"));
if (process.argv.includes("--upload")) {
  assert.equal(
    process.env.RELEASE_TAG,
    `v${version}`,
    "Release tag must match app version",
  );
  const result = spawnSync(
    "gh",
    [
      "release",
      "upload",
      process.env.RELEASE_TAG,
      ...expected.map((file) => `release/${file}`),
      "release/SHA256SUMS.txt",
      "--clobber",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
