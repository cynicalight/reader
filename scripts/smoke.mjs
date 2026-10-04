import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
const data = await mkdtemp(join(tmpdir(), "reader-smoke-"));
const token = randomBytes(32).toString("hex");
const child = spawn(
  `./apps/desktop/bin/reader-server${process.platform === "win32" ? ".exe" : ""}`,
  ["--port", "0", "--data", data, "--web", "apps/web/dist"],
  {
    env: { ...process.env, READER_TOKEN: token },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
try {
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, "line");
  lines.close();
  const { url } = JSON.parse(line);
  const api = async (path, init = {}) => {
    const res = await fetch(url + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res;
  };
  for (const name of ["the-art-of-reading.epub", "reading-notes.pdf"]) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([await readFile("apps/web/public/samples/" + name)]),
      name,
    );
    const doc = await (
      await api("/api/documents", { method: "POST", body: form })
    ).json();
    console.log(`Imported ${doc.type}: ${doc.title}`);
  }
  const docs = await (await api("/api/documents")).json();
  if (docs.length !== 2) throw new Error("library mismatch");
  const providers = await (await api("/api/providers")).json();
  console.log(
    "CLI status:",
    providers.map(({ id, installed, authenticated }) => ({
      id,
      installed,
      authenticated,
    })),
  );
  const root = await fetch(url);
  if (!root.ok || !(await root.text()).includes("root"))
    throw new Error("web entrypoint unavailable");
  if (process.argv.includes("--ai")) {
    if (!providers.find((p) => p.id === "codex")?.authenticated)
      throw new Error("Codex not authenticated");
    const res = await api(`/api/documents/${docs[0].id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "codex",
        prompt: "Reply with exactly READER_OK. This is a connection test.",
        context: "An original Reader sample document.",
      }),
      signal: AbortSignal.timeout(180000),
    });
    const stream = await res.text();
    if (!stream.includes("event: done") || !stream.includes("READER_OK"))
      throw new Error("Real CLI response did not complete: " + stream);
    console.log("Real Codex CLI: READER_OK; SSE completed.");
  }
  console.log("HTTP smoke passed.");
} finally {
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
  await rm(data, { recursive: true, force: true });
  console.log("Sidecar stopped and temporary library removed.");
}
