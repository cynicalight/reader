// Simplified Reader interface pieces drawn on the guide canvas. Positions are
// in the scene's logical 640 × 400 space.
import { ease, type Frame, type Rect } from "./canvas";

export const sidebarWidth = 150;
export const main: Rect = { x: 156, y: 8, w: 476, h: 384 };

/** Window controls in the sidebar header, as on macOS. */
export function chrome(f: Frame) {
  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) =>
    f.p.circle(18 + i * 14, 18, 4.5, color),
  );
}

export function card(f: Frame, r: Rect = main) {
  f.p.box(r, {
    fill: f.c.background,
    radius: 12,
    shadow: 14,
    stroke: f.c.dark ? "rgb(255 255 255 / 6%)" : "rgb(0 0 0 / 4%)",
  });
}

export type Variant = "primary" | "outline" | "ghost" | "nav" | "pill";

export function button(
  f: Frame,
  r: Rect,
  label: string,
  variant: Variant = "outline",
  o: { active?: boolean; size?: number; icon?: Glyph; align?: "left" } = {},
) {
  const { p, c } = f;
  const hover = f.hover(r);
  const pressed = f.pressed(r);
  const radius = variant === "pill" ? r.h / 2 : 6;
  const primary = variant === "primary" || variant === "pill";
  let fill: string | undefined;
  if (primary) fill = c.primary;
  else if (variant === "outline") fill = hover ? c.accent : c.background;
  else if (o.active || hover) fill = c.accent;
  p.alpha(pressed ? 0.8 : 1, () => {
    p.box(r, {
      fill,
      radius,
      stroke: variant === "outline" ? c.border : undefined,
    });
    if (primary && hover)
      p.box(r, {
        fill: c.dark ? "rgb(0 0 0 / 10%)" : "rgb(255 255 255 / 12%)",
        radius,
      });
    const color = primary
      ? c.primaryForeground
      : variant === "nav" && !o.active
        ? c.mutedForeground
        : c.foreground;
    const size = o.size ?? 11.5;
    const left = o.align === "left" || variant === "nav";
    const iconWidth = o.icon ? 16 : 0;
    const textWidth = p.measure(label, size, 500);
    if (!label) {
      o.icon?.(f, r.x + r.w / 2, r.y + r.h / 2, color);
      return;
    }
    const start = left ? r.x + 10 : r.x + (r.w - textWidth - iconWidth) / 2;
    if (o.icon) o.icon(f, start + 5, r.y + r.h / 2, color);
    p.text(label, start + iconWidth, r.y + r.h / 2, {
      size,
      weight: 500,
      color,
      max: r.w - 16 - iconWidth,
    });
  });
}

export type Glyph = (f: Frame, x: number, y: number, color: string) => void;

export const glyphs = {
  gear: ((f, x, y, color) => {
    f.p.circle(x, y, 4.2, undefined, color);
    f.p.circle(x, y, 1.4, color);
  }) as Glyph,
  plus: ((f, x, y, color) => {
    f.p.circle(x, y, 5, undefined, color);
    f.p.line(x - 2.5, y, x + 2.5, y, color, 1.3);
    f.p.line(x, y - 2.5, x, y + 2.5, color, 1.3);
  }) as Glyph,
  info: ((f, x, y, color) => {
    f.p.circle(x, y, 5, undefined, color);
    f.p.line(x, y - 0.5, x, y + 2.5, color, 1.3);
    f.p.circle(x, y - 2.4, 0.7, color);
  }) as Glyph,
  book: ((f, x, y, color) => {
    f.p.box(
      { x: x - 5, y: y - 4.5, w: 10, h: 9 },
      { stroke: color, radius: 1.5, line: 1.2 },
    );
    f.p.line(x, y - 4.5, x, y + 4.5, color, 1.2);
  }) as Glyph,
  library: ((f, x, y, color) => {
    for (const dx of [-3.5, 0, 3.5])
      f.p.line(x + dx, y - 4, x + dx, y + 4, color, 1.3);
  }) as Glyph,
  star: ((f, x, y, color) => sparkle(f, x, y, 5, color)) as Glyph,
  sparkle: ((f, x, y, color) => sparkle(f, x, y, 5.5, color)) as Glyph,
  search: ((f, x, y, color) => {
    f.p.circle(x - 1, y - 1, 3.5, undefined, color);
    f.p.line(x + 1.6, y + 1.6, x + 4, y + 4, color, 1.3);
  }) as Glyph,
  file: ((f, x, y, color) => {
    f.p.box(
      { x: x - 4, y: y - 5, w: 8, h: 10 },
      { stroke: color, radius: 1.5, line: 1.2 },
    );
  }) as Glyph,
  refresh: ((f, x, y, color) => {
    const ctx = f.p.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 4.5, -Math.PI * 0.2, Math.PI * 1.45);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
    f.p.line(x + 3.6, y - 2.6, x + 4.8, y - 5.4, color, 1.3);
    f.p.line(x + 3.6, y - 2.6, x + 1, y - 2.2, color, 1.3);
  }) as Glyph,
  back: ((f, x, y, color) => {
    f.p.line(x + 2, y - 5, x - 3, y, color, 1.5);
    f.p.line(x - 3, y, x + 2, y + 5, color, 1.5);
  }) as Glyph,
  send: ((f, x, y, color) => {
    f.p.line(x, y + 4, x, y - 4, color, 1.5);
    f.p.line(x - 3.5, y - 0.5, x, y - 4, color, 1.5);
    f.p.line(x + 3.5, y - 0.5, x, y - 4, color, 1.5);
  }) as Glyph,
};

export function sparkle(
  f: Frame,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const ctx = f.p.ctx;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(angle) * d, y + Math.sin(angle) * d);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export const sidebarRects = {
  importButton: { x: 14, y: 302, w: 122, h: 26 },
  settings: { x: 10, y: 334, w: 130, h: 22 },
  guide: { x: 10, y: 356, w: 130, h: 22 },
  about: { x: 10, y: 378, w: 130, h: 22 },
};

/** The paper library sidebar, with the guide entry above About. */
export function sidebar(f: Frame, o: { mode?: "论文库" | "图书库" } = {}) {
  const { p, c } = f;
  chrome(f);
  p.text(o.mode ?? "论文库", 16, 48, { size: 13.5, weight: 600 });
  p.chevron(
    16 + p.measure(o.mode ?? "论文库", 13.5, 600) + 9,
    48,
    6,
    c.mutedForeground,
  );
  button(f, { x: 12, y: 66, w: 126, h: 24 }, "快速查找", "outline", {
    align: "left",
    size: 11,
    icon: glyphs.search,
  });
  const nav: [string, number, keyof typeof glyphs][] = [
    ["全部论文", 104, "library"],
    ["收藏", 128, "star"],
  ];
  nav.forEach(([label, y, icon], i) =>
    button(f, { x: 10, y, w: 130, h: 22 }, label, "nav", {
      active: i === 0,
      icon: glyphs[icon],
      size: 11,
    }),
  );
  p.text("分类", 20, 166, { size: 10, color: c.mutedForeground });
  ["机器学习", "语言模型"].forEach((label, i) =>
    p.text(label, 20, 186 + i * 22, { size: 11, color: c.mutedForeground }),
  );
  const r = sidebarRects;
  button(f, r.importButton, "导入论文", "pill", {
    icon: glyphs.plus,
    size: 11,
  });
  button(f, r.settings, "设置", "nav", { icon: glyphs.gear, size: 11 });
  button(f, r.guide, "指南", "nav", { icon: glyphs.book, size: 11 });
  button(f, r.about, "关于", "nav", { icon: glyphs.info, size: 11 });
}

export const paperTitles = [
  "Scaling Laws for Neural Language Models",
  "Denoising Diffusion Probabilistic Models",
  "Language Models are Few-Shot Learners",
  "Deep Residual Learning for Image Recognition",
  "BERT: Pre-training of Deep Bidirectional Transformers",
];

/** One row of the paper list. */
export function paperRow(
  f: Frame,
  y: number,
  title: string,
  meta: string,
  o: { highlight?: number } = {},
) {
  const { p, c } = f;
  const r = { x: main.x + 16, y, w: main.w - 32, h: 40 };
  if (o.highlight)
    p.alpha(o.highlight, () => p.box(r, { fill: c.accent, radius: 8 }));
  p.box(
    { x: r.x + 8, y: y + 7, w: 20, h: 26 },
    { fill: c.muted, stroke: c.border, radius: 3 },
  );
  p.text(title, r.x + 38, y + 14, { size: 11.5, weight: 500, max: r.w - 60 });
  p.text(meta, r.x + 38, y + 29, {
    size: 10,
    color: c.mutedForeground,
    max: r.w - 60,
  });
  p.line(r.x + 8, y + 40, r.x + r.w - 8, y + 40, c.border);
}

export function libraryHeader(f: Frame, title = "全部论文") {
  const { p, c } = f;
  p.text(title, main.x + 22, main.y + 26, { size: 14, weight: 600 });
  p.line(main.x, main.y + 48, main.x + main.w, main.y + 48, c.border);
}

/** A dialog with its backdrop; `appear` animates from 0 to 1. */
export function dialog(f: Frame, r: Rect, appear: number, draw: () => void) {
  const { p, c } = f;
  if (appear <= 0) return;
  p.alpha(appear, () => {
    p.box(
      { x: 0, y: 0, w: 640, h: 400 },
      { fill: c.dark ? "rgb(0 0 0 / 40%)" : "rgb(0 0 0 / 10%)", radius: 0 },
    );
    const ctx = p.ctx;
    ctx.save();
    const s = 0.96 + 0.04 * ease(appear);
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(s, s);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    p.box(r, {
      fill: c.popover,
      radius: 12,
      shadow: 24,
      stroke: c.dark ? "rgb(255 255 255 / 10%)" : "rgb(0 0 0 / 8%)",
    });
    draw();
    ctx.restore();
  });
}

export function input(
  f: Frame,
  r: Rect,
  value: string,
  o: { placeholder?: string; focus?: boolean; secret?: boolean } = {},
) {
  const { p, c, t } = f;
  p.box(r, {
    fill: c.background,
    stroke: o.focus ? c.ring : c.input,
    radius: 6,
  });
  if (o.focus)
    p.alpha(0.35, () =>
      p.box(
        { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 },
        { stroke: c.ring, radius: 8, line: 2 },
      ),
    );
  const shown = o.secret ? "•".repeat(value.length) : value;
  const y = r.y + r.h / 2;
  if (shown) p.text(shown, r.x + 9, y, { size: 11.5, max: r.w - 18 });
  else if (o.placeholder)
    p.text(o.placeholder, r.x + 9, y, {
      size: 11.5,
      color: c.mutedForeground,
      max: r.w - 18,
    });
  if (o.focus && Math.floor(t / 500) % 2 === 0) {
    const x = r.x + 9 + Math.min(p.measure(shown, 11.5), r.w - 18) + 1;
    p.line(x, y - 6, x, y + 6, c.foreground, 1);
  }
}

export function select(
  f: Frame,
  r: Rect,
  value: string,
  o: { open?: boolean } = {},
) {
  const { p, c } = f;
  p.box(r, {
    fill: f.hover(r) ? c.accent : c.background,
    stroke: o.open ? c.ring : c.input,
    radius: 6,
  });
  p.text(value, r.x + 9, r.y + r.h / 2, { size: 11.5, max: r.w - 30 });
  p.chevron(r.x + r.w - 12, r.y + r.h / 2, 6, c.mutedForeground);
}

/** An open select or dropdown list; returns each option's rectangle. */
export function menu(
  f: Frame,
  x: number,
  y: number,
  w: number,
  options: string[],
  o: { appear: number; selected?: string },
) {
  const { p, c } = f;
  const rows = options.map((_, i) => ({
    x: x + 4,
    y: y + 4 + i * 26,
    w: w - 8,
    h: 24,
  }));
  p.alpha(o.appear, () => {
    p.box(
      { x, y, w, h: options.length * 26 + 8 },
      {
        fill: c.popover,
        radius: 8,
        shadow: 16,
        stroke: c.dark ? "rgb(255 255 255 / 10%)" : "rgb(0 0 0 / 8%)",
      },
    );
    options.forEach((label, i) => {
      const r = rows[i];
      if (f.hover(r)) p.box(r, { fill: c.accent, radius: 5 });
      p.text(label, r.x + 8, r.y + r.h / 2, { size: 11.5 });
      if (label === o.selected)
        p.check(r.x + r.w - 12, r.y + r.h / 2, 8, c.foreground);
    });
  });
  return rows;
}

/** Equal-width segments, so scripts can aim at them without measuring. */
export const tabRects = (r: Rect, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    x: r.x + 3 + ((r.w - 6) / count) * i,
    y: r.y + 3,
    w: (r.w - 6) / count,
    h: r.h - 6,
  }));

/** Segmented tabs; returns each tab's rectangle. */
export function tabs(f: Frame, r: Rect, labels: string[], active: number) {
  const { p, c } = f;
  p.box(r, { fill: c.muted, radius: 8 });
  const rects = tabRects(r, labels.length);
  labels.forEach((label, i) => {
    const tab = rects[i];
    if (i === active)
      p.box(tab, {
        fill: c.dark ? c.input : c.background,
        radius: 6,
        shadow: 3,
      });
    p.text(label, tab.x + tab.w / 2, tab.y + tab.h / 2, {
      size: 11.5,
      weight: 500,
      align: "center",
      color: i === active || f.hover(tab) ? c.foreground : c.mutedForeground,
    });
  });
  return rects;
}

/** Splits text into lines: Latin text by word, CJK by character. */
export function wrap(
  f: Frame,
  text: string,
  width: number,
  size: number,
  weight = 400,
) {
  const tokens =
    text.match(
      /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]|[^\s\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+\s*|\s+/g,
    ) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    // Closing punctuation never starts a line.
    const closing = /^[，。、；：！？）」』》,.;:!?)]/.test(token);
    if (
      !closing &&
      line.trim() &&
      f.p.measure(line + token, size, weight) > width
    ) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line += token;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** Draws wrapped text and returns the y below it. */
export function paragraph(
  f: Frame,
  text: string,
  x: number,
  y: number,
  width: number,
  o: { size?: number; leading?: number; weight?: number; color?: string } = {},
) {
  const size = o.size ?? 12;
  const leading = o.leading ?? size * 1.65;
  const lines = wrap(f, text, width, size, o.weight);
  lines.forEach((line, i) =>
    f.p.text(line, x, y + i * leading, {
      size,
      weight: o.weight,
      color: o.color,
    }),
  );
  return y + lines.length * leading;
}

/** A callout below a control, pointing up at it from (x, y). */
export function callout(
  f: Frame,
  x: number,
  y: number,
  label: string,
  appear: number,
) {
  const { p, c } = f;
  const w = p.measure(label, 11, 500) + 20;
  const left = x - 18;
  p.alpha(appear, () => {
    const ctx = p.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y + 7);
    ctx.lineTo(x - 6, y + 7);
    ctx.closePath();
    ctx.fillStyle = c.primary;
    ctx.fill();
    ctx.restore();
    p.box({ x: left, y: y + 6, w, h: 26 }, { fill: c.primary, radius: 7 });
    p.text(label, left + w / 2, y + 19, {
      size: 11,
      weight: 500,
      align: "center",
      color: c.primaryForeground,
    });
  });
}

export function badge(f: Frame, right: number, y: number, label: string) {
  const { p, c } = f;
  const w = p.measure(label, 10, 500) + 14;
  p.box({ x: right - w, y: y - 9, w, h: 18 }, { stroke: c.border, radius: 9 });
  p.text(label, right - w / 2, y, {
    size: 10,
    weight: 500,
    align: "center",
    color: c.mutedForeground,
  });
}

/** A provider mark: a rounded tile with the provider's initial. */
export function providerMark(
  f: Frame,
  x: number,
  y: number,
  letter: string,
  tint: string,
) {
  f.p.box({ x, y, w: 22, h: 22 }, { fill: tint, radius: 6 });
  f.p.text(letter, x + 11, y + 11.5, {
    size: 11,
    weight: 700,
    align: "center",
    color: "#ffffff",
  });
}

export type CheckState = "pending" | "passed" | "failed" | "idle";

/** The text and image checks shown on an agent card. */
export function checks(
  f: Frame,
  x: number,
  y: number,
  states: [CheckState, CheckState],
) {
  const { p, c, t } = f;
  ["文本推理", "图片理解"].forEach((label, i) => {
    const state = states[i];
    const cx = x + i * 74 + 6;
    if (state === "idle") return;
    if (state === "pending") p.spinner(cx, y, 4.5, t, c.mutedForeground);
    else if (state === "passed") p.checkCircle(cx, y, 10, c.success);
    else p.warning(cx, y, 10, c.warning);
    p.text(label, cx + 10, y, { size: 10.5, color: c.mutedForeground });
  });
}

/** A hover label above a control. */
export function tooltip(
  f: Frame,
  x: number,
  y: number,
  label: string,
  appear = 1,
) {
  const { p, c } = f;
  const w = p.measure(label, 10.5, 500) + 14;
  p.alpha(appear, () => {
    p.box(
      { x: x - w / 2, y: y - 24, w, h: 19 },
      { fill: c.foreground, radius: 5 },
    );
    p.text(label, x, y - 14.5, {
      size: 10.5,
      weight: 500,
      align: "center",
      color: c.background,
    });
  });
}
