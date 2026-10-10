// Regenerates every logo file from the geometry below. macOS only: it shells
// out to rsvg-convert and ImageMagick (Homebrew) and the system iconutil.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = join(root, "assets");
const website = join(root, "website/assets");

const ivory = "#F7F6F2";
const ink = "#1F1E1D";
const clay = "#C2643F";
const blob =
  "M58 21C68 21.5 74 29.5 73 38.5C72 47.5 64.5 53 56.5 52C48.5 51 44 44 45 36C46 27.5 50.5 20.6 58 21Z";
const letter =
  "M35 77C34.4 62 35.4 41 34.6 24M34.6 24C44 22.6 56 22.4 61 27C67 32.5 65 45 56 48.5C50 50.6 42 50.5 35 50M47 50.5C53 58 60 67 68 77.5";
// Heavier strokes keep the hand-drawn R legible once it shrinks.
const weight = { large: 5.5, medium: 6.5, small: 8 };

const mark = (stroke, width, cls = "") =>
  `<g transform="translate(-2 0)"><path d="${blob}" fill="${clay}"/><path${cls} d="${letter}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const svg = (viewBox, body, size = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}>${body}</svg>\n`;
// Full-bleed rounded tile on a 100-unit grid.
const logo = ({
  tile = ivory,
  stroke = ink,
  width = weight.large,
  rx = 22.5,
} = {}) =>
  svg(
    "0 0 100 100",
    `<rect width="100" height="100" rx="${rx}" fill="${tile}"/>${mark(stroke, width)}`,
  );
// macOS grid: 824 px tile inset 100 px on a 1024 canvas, with the system-style drop shadow.
const macos = (width) =>
  svg(
    "0 0 1024 1024",
    `<defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="100" y="100" width="824" height="824" rx="185" fill="${ivory}" filter="url(#s)"/><g transform="translate(100 100) scale(8.24)">${mark(ink, width)}</g>`,
    ' width="1024" height="1024"',
  );
const favicon = svg(
  "0 0 100 100",
  `<style>@media (prefers-color-scheme: dark){.t{fill:${ink}}.i{stroke:${ivory}}}</style><rect class="t" width="100" height="100" rx="22.5" fill="${ivory}"/>${mark(ink, weight.small, ' class="i"')}`,
);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
const png = (source, target, size) =>
  run("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    "-o",
    target,
    source,
  ]);

const tmp = await mkdtemp(join(tmpdir(), "reader-brand-"));
try {
  const write = async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    return path;
  };
  const source = {
    large: await write(join(assets, "logo/reader-logo.svg"), logo()),
    medium: await write(
      join(tmp, "medium.svg"),
      logo({ width: weight.medium }),
    ),
    small: await write(join(tmp, "small.svg"), logo({ width: weight.small })),
    dark: await write(
      join(assets, "logo/reader-logo-dark.svg"),
      logo({ tile: ink, stroke: ivory }),
    ),
    square: await write(join(tmp, "square.svg"), logo({ rx: 0 })),
    macos: await write(
      join(assets, "icons/macos/icon.svg"),
      macos(weight.large),
    ),
    macosMedium: await write(
      join(tmp, "macos-medium.svg"),
      macos(weight.medium),
    ),
    macosSmall: await write(join(tmp, "macos-small.svg"), macos(weight.small)),
  };
  // The bare mark, cropped to its bounds, for surfaces that supply their own background.
  await write(
    join(assets, "logo/reader-mark.svg"),
    svg("25.5 17 50 67", mark(ink, weight.large)),
  );
  await write(
    join(assets, "logo/reader-mark-light.svg"),
    svg("25.5 17 50 67", mark(ivory, weight.large)),
  );

  await mkdir(join(assets, "logo/png"), { recursive: true });
  for (const size of [256, 512, 1024])
    png(source.large, join(assets, `logo/png/reader-logo-${size}.png`), size);
  png(source.dark, join(assets, "logo/png/reader-logo-dark-1024.png"), 1024);

  // macOS .icns from a full iconset; the 16 and 32 pt slots use heavier strokes.
  const iconset = join(tmp, "icon.iconset");
  await mkdir(iconset);
  for (const [name, size] of [
    ["16x16", 16],
    ["16x16@2x", 32],
    ["32x32", 32],
    ["32x32@2x", 64],
    ["128x128", 128],
    ["128x128@2x", 256],
    ["256x256", 256],
    ["256x256@2x", 512],
    ["512x512", 512],
    ["512x512@2x", 1024],
  ])
    png(
      size <= 32
        ? source.macosSmall
        : size <= 64
          ? source.macosMedium
          : source.macos,
      join(iconset, `icon_${name}.png`),
      size,
    );
  run("iconutil", [
    "-c",
    "icns",
    "-o",
    join(assets, "icons/macos/icon.icns"),
    iconset,
  ]);

  // Windows .ico: full-bleed tile, which is how Windows 11 app icons sit in the taskbar.
  await mkdir(join(assets, "icons/windows"), { recursive: true });
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const frame = join(tmp, `win-${size}.png`);
    png(
      size <= 32 ? source.small : size <= 64 ? source.medium : source.large,
      frame,
      size,
    );
    frames.push(frame);
  }
  run("magick", [...frames, join(assets, "icons/windows/icon.ico")]);

  // Website favicons. Pages deploys only website/, so these are copies, not links.
  await write(join(website, "favicon.svg"), favicon);
  const ico = [];
  for (const size of [16, 32, 48]) {
    const frame = join(tmp, `fav-${size}.png`);
    png(size <= 32 ? source.small : source.medium, frame, size);
    ico.push(frame);
  }
  run("magick", [...ico, join(website, "favicon.ico")]);
  // iOS masks its own corners, so the touch icon is a plain square.
  png(source.square, join(website, "apple-touch-icon.png"), 180);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
