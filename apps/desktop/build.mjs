import { build } from "esbuild";
await build({
  entryPoints: ["main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["preload/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
