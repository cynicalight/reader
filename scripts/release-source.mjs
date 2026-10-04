import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = JSON.parse(await readFile("package.json", "utf8"));
const app = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
assert.equal(root.version, app.version, "Root and desktop versions must match");
assert.match(
  app.version,
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
  "Invalid release version",
);
if (process.env.RELEASE_TAG)
  assert.equal(
    process.env.RELEASE_TAG,
    `v${app.version}`,
    "Release tag must match app version",
  );
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
console.log(`Building Reader ${app.version} from ${sha}`);
