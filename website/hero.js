import * as THREE from "three";

const hero = document.getElementById("hero");
const canvas = document.getElementById("hero-canvas");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
} catch {
  hero.classList.add("no-webgl");
  throw new Error("WebGL unavailable");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => {
  const t = document.documentElement.dataset.theme;
  return (
    t === "dark" ||
    (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  );
};

/* Page textures */
const PAGE_W = 2.5;
const PAGE_H = 3.4;
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * PAGE_H) / PAGE_W);
const serif =
  '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "Newsreader", Georgia, serif';
const sans = '"Geist", -apple-system, "PingFang SC", sans-serif';

const pages = [
  {
    head: "THE ART OF READING / CHAPTER 01",
    title: "从问题开始",
    body: "阅读之前，先写下你希望理解的问题。问题不必复杂，它可以是一个概念、一种方法，或者一个结论成立的条件。|对于一本书，目录提供了作者安排内容的方式。先看章标题，再看章节之间的关系。|不要把目录当作内容本身。标题能告诉你主题，却不能替代论证。",
    mark: "不要把目录当作内容本身。",
  },
  {
    head: "01 · 从问题开始",
    body: "对于一篇论文，可以先读摘要、引言与结论。记录作者声称解决的问题，再到方法和实验中核对证据。|第一次阅读不需要理解每一个细节。把暂时不明白的术语标记下来，同时记录它出现的位置。|一个有用的问题包含对象和条件。",
    mark: "核对证据",
    under: "记录它出现的位置",
  },
  {
    head: "THE ART OF READING / CHAPTER 02",
    title: "区分主张与证据",
    body: "作者提出了什么主张？为这个主张提供了什么证据？从证据到结论，中间还需要哪些假设？|实验中的相关性不自动意味着因果关系。观察到两个变量同时变化时，还需要考虑共同原因。",
    mark: "中间还需要哪些假设？",
  },
  {
    head: "Reading with a question",
    figure: true,
    body: "Before reading, describe the question you want to answer. Use the outline to inspect the structure of the argument.|A claim is not the same as evidence.",
    mark: "A claim is not the same as evidence.",
    latin: true,
  },
  {
    head: "THE ART OF READING / CHAPTER 03",
    title: "让笔记可以复用",
    body: "读完一章后，暂时离开原文，尝试回答开始时的问题。|一条可复用的笔记至少说明主题、理由和适用条件。笔记的长度并不重要。|保留原文位置能够降低核对成本。",
    mark: "保留原文位置能够降低核对成本。",
  },
  {
    head: "03 · 让笔记可以复用",
    body: "PDF 的页码与 EPUB 的章节位置不同。调整电子书的字号会改变排版，因此阅读位置应当独立于屏幕上显示的页数。|最后，把本次阅读没有解决的问题单独列出。它们可以成为下一次阅读的起点。",
    mark: "下一次阅读的起点",
    under: "阅读位置应当独立于屏幕上显示的页数",
  },
];

function wrapText(ctx, text, maxWidth, latin) {
  const lines = [];
  const tokens = latin ? text.split(/(\s+)/) : [...text];
  let line = "";
  for (const token of tokens) {
    const next = line + token;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function pageTexture(spec, side, mirror) {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d");
  if (mirror) {
    ctx.translate(TEX_W, 0);
    ctx.scale(-1, 1);
  }
  const isDark = dark();
  const paper = isDark ? "#25241f" : "#fbf8f0";
  const ink = isDark ? "#d9d4c7" : "#2f2d28";
  const soft = isDark ? "#7d796e" : "#a29d90";
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // gutter shadow on the spine side
  const spineLeft = side === "right";
  const g = ctx.createLinearGradient(
    spineLeft ? 0 : TEX_W,
    0,
    spineLeft ? 140 : TEX_W - 140,
    0,
  );
  g.addColorStop(0, isDark ? "rgba(0,0,0,.45)" : "rgba(90,70,40,.16)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const pad = 110;
  const width = TEX_W - pad * 2;
  let y = 150;
  ctx.fillStyle = soft;
  ctx.font = `500 22px ${sans}`;
  ctx.letterSpacing = "4px";
  ctx.fillText(spec.head, pad, y);
  ctx.letterSpacing = "0px";
  y += 70;
  if (spec.title) {
    ctx.fillStyle = ink;
    ctx.font = `500 66px ${serif}`;
    ctx.fillText(spec.title, pad, y + 40);
    y += 140;
  }
  if (spec.figure) {
    ctx.strokeStyle = soft;
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, y, width, 300);
    const bars = [0.45, 0.7, 0.35, 0.85, 0.95];
    bars.forEach((h, i) => {
      ctx.fillStyle = i % 2 ? "#c2643f" : soft;
      ctx.globalAlpha = i % 2 ? 0.85 : 0.5;
      ctx.fillRect(pad + 50 + i * 150, y + 270 - h * 230, 90, h * 230);
    });
    ctx.globalAlpha = 1;
    y += 370;
  }
  const size = spec.latin ? 38 : 36;
  const lh = spec.latin ? 64 : 70;
  ctx.font = `400 ${size}px ${serif}`;
  for (const para of spec.body.split("|")) {
    const lines = wrapText(ctx, para, width, spec.latin);
    for (const line of lines) {
      for (const [phrase, kind] of [
        [spec.mark, "mark"],
        [spec.under, "under"],
      ]) {
        if (!phrase) continue;
        // decorate the overlap between this line and the phrase
        const joined = para;
        const pStart = joined.indexOf(phrase);
        const lStart = joined.indexOf(line);
        if (pStart < 0 || lStart < 0) continue;
        const a = Math.max(pStart, lStart);
        const b = Math.min(pStart + phrase.length, lStart + line.length);
        if (b <= a) continue;
        const x0 = pad + ctx.measureText(line.slice(0, a - lStart)).width;
        const x1 = pad + ctx.measureText(line.slice(0, b - lStart)).width;
        if (kind === "mark") {
          ctx.fillStyle = isDark
            ? "rgba(240,196,76,.32)"
            : "rgba(240,196,76,.5)";
          ctx.fillRect(x0 - 2, y - size + 4, x1 - x0 + 4, size + 12);
        } else {
          ctx.fillStyle = "#c2643f";
          ctx.fillRect(x0, y + 10, x1 - x0, 3);
        }
      }
      ctx.fillStyle = ink;
      ctx.fillText(line, pad, y);
      y += lh;
    }
    y += 26;
  }
  ctx.fillStyle = soft;
  ctx.font = `400 22px ${sans}`;
  ctx.fillText(
    String(pages.indexOf(spec) + 12),
    side === "right" ? TEX_W - pad - 30 : pad,
    TEX_H - 90,
  );
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

let textures = [];
function buildTextures() {
  for (const t of textures) for (const tex of Object.values(t)) tex.dispose();
  // spread k: left = pages[2k % n], right = pages[(2k+1) % n]; back = mirrored left-page render
  textures = pages.map((spec) => ({
    left: pageTexture(spec, "left", false),
    right: pageTexture(spec, "right", false),
    back: pageTexture(spec, "left", true),
  }));
}

/* Book */
const book = new THREE.Group();
scene.add(book);
const OPEN = 0.16;
const coverMat = new THREE.MeshStandardMaterial({
  roughness: 0.7,
  metalness: 0,
});
const edgeMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
const leftTop = new THREE.MeshStandardMaterial({ roughness: 0.92 });
const rightTop = new THREE.MeshStandardMaterial({ roughness: 0.92 });

function half(sign, topMat) {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(PAGE_W + 0.14, PAGE_H + 0.18, 0.05),
    coverMat,
  );
  cover.position.set((sign * (PAGE_W + 0.14)) / 2, 0, -0.2);
  const stack = new THREE.Mesh(
    new THREE.BoxGeometry(PAGE_W, PAGE_H, 0.17),
    edgeMat,
  );
  stack.position.set((sign * PAGE_W) / 2, 0, -0.09);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), topMat);
  top.position.set((sign * PAGE_W) / 2, 0, 0.0);
  g.add(cover, stack, top);
  g.rotation.y = sign > 0 ? -OPEN : OPEN;
  return g;
}
book.add(half(-1, leftTop), half(1, rightTop));

const SEG = 36;
const flipGeo = new THREE.PlaneGeometry(PAGE_W, PAGE_H, SEG, 1);
const frontMat = new THREE.MeshStandardMaterial({
  roughness: 0.92,
  side: THREE.FrontSide,
});
const backMat = new THREE.MeshStandardMaterial({
  roughness: 0.92,
  side: THREE.BackSide,
});
const flipFront = new THREE.Mesh(flipGeo, frontMat);
const flipBack = new THREE.Mesh(flipGeo, backMat);
const flipper = new THREE.Group();
flipper.add(flipFront, flipBack);
flipper.position.z = 0.012;
book.add(flipper);

function bendPage(theta, progress) {
  const pos = flipGeo.attributes.position;
  const bend = 0.85 * Math.sin(progress * Math.PI * 2);
  const dx = PAGE_W / SEG;
  let x = 0;
  let z = 0;
  const xs = [0];
  const zs = [0];
  for (let i = 1; i <= SEG; i++) {
    const u = (i - 0.5) / SEG;
    let a = theta + bend * Math.pow(u, 1.4);
    a = Math.min(Math.PI - OPEN, Math.max(OPEN, a));
    x += Math.cos(a) * dx;
    z += Math.sin(a) * dx;
    xs.push(x);
    zs.push(z);
  }
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i <= SEG; i++) {
      const idx = row * (SEG + 1) + i;
      pos.setX(idx, xs[i]);
      pos.setZ(idx, zs[i]);
    }
  }
  pos.needsUpdate = true;
  flipGeo.computeVertexNormals();
}

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(PAGE_W * 3.2, PAGE_H * 1.6),
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
);
shadow.position.z = -0.4;
book.add(shadow);
function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, dark() ? "rgba(0,0,0,.55)" : "rgba(60,40,20,.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a890, 1.6));
const key = new THREE.DirectionalLight(0xfff4e6, 1.6);
key.position.set(-3, 5, 6);
scene.add(key);

/* Glyph particles: rise from the right page, orbit, settle into the left page */
const GLYPHS =
  "阅读问题证据主张笔记原文结构理解概念方法结论目录章节论证假设AIPDFEPUBreadtxquestion";
const ATLAS = 8;
const atlas = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...GLYPHS].slice(0, ATLAS * ATLAS);
  chars.forEach((ch, i) => {
    ctx.font = `400 46px ${serif}`;
    ctx.fillText(ch, (i % ATLAS) * 64 + 32, Math.floor(i / ATLAS) * 64 + 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return { tex: t, count: chars.length };
})();

const COUNT = innerWidth < 720 ? 240 : 520;
const positions = new Float32Array(COUNT * 3);
const glyph = new Float32Array(COUNT);
const alpha = new Float32Array(COUNT);
const size = new Float32Array(COUNT);
const tint = new Float32Array(COUNT);
const seeds = [];
for (let i = 0; i < COUNT; i++) {
  glyph[i] = Math.floor(Math.random() * atlas.count);
  size[i] = 0.6 + Math.random() * 0.8;
  tint[i] = Math.random() < 0.22 ? 1 : 0;
  seeds.push({
    offset: Math.random(),
    speed: 0.045 + Math.random() * 0.05,
    sx: 0.25 + Math.random() * (PAGE_W - 0.5),
    sy: (Math.random() - 0.5) * (PAGE_H - 0.6),
    ex: -(0.25 + Math.random() * (PAGE_W - 0.5)),
    ey: (Math.random() - 0.5) * (PAGE_H - 0.6),
    ring: 1.4 + Math.random() * 1.5,
    phi: Math.random() * Math.PI * 2,
    sweep: 1.4 + Math.random() * 2.2,
    lift: 1.3 + Math.random() * 1.1,
    wob: Math.random() * Math.PI * 2,
  });
}
const pgeo = new THREE.BufferGeometry();
pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
pgeo.setAttribute("aGlyph", new THREE.BufferAttribute(glyph, 1));
pgeo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
pgeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
pgeo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
const pmat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uAtlas: { value: atlas.tex },
    uInk: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uScale: { value: 1 },
    uGrid: { value: ATLAS },
  },
  vertexShader: /* glsl */ `
    attribute float aGlyph; attribute float aAlpha; attribute float aSize; attribute float aTint;
    varying float vGlyph; varying float vAlpha; varying float vTint;
    uniform float uScale;
    void main() {
      vGlyph = aGlyph; vAlpha = aAlpha; vTint = aTint;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uAtlas; uniform vec3 uInk; uniform vec3 uAccent; uniform float uGrid;
    varying float vGlyph; varying float vAlpha; varying float vTint;
    void main() {
      vec2 cell = vec2(mod(vGlyph, uGrid), floor(vGlyph / uGrid));
      vec2 uv = (cell + vec2(gl_PointCoord.x, gl_PointCoord.y)) / uGrid;
      float a = texture2D(uAtlas, vec2(uv.x, 1.0 - uv.y)).a * vAlpha;
      if (a < 0.02) discard;
      gl_FragColor = vec4(mix(uInk, uAccent, vTint), a);
    }`,
});
const points = new THREE.Points(pgeo, pmat);
points.frustumCulled = false;
book.add(points);

const CENTER = new THREE.Vector3(0, 0.7, 1.5);
const smooth = (t) => t * t * (3 - 2 * t);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
function ringPoint(s, angle, out) {
  return out.set(
    CENTER.x + Math.cos(angle) * s.ring * 1.45,
    CENTER.y + Math.sin(angle) * s.ring * 0.42,
    CENTER.z + Math.sin(angle) * s.ring * 0.3,
  );
}
function surfaceZ(x) {
  return Math.abs(x) * Math.sin(OPEN) + 0.03;
}
function updateParticles(time) {
  for (let i = 0; i < COUNT; i++) {
    const s = seeds[i];
    const t = (time * s.speed + s.offset) % 1;
    let x, y, z, a;
    const enter = s.phi;
    const leave = s.phi + s.sweep;
    if (t < 0.32) {
      const k = smooth(t / 0.32);
      ringPoint(s, enter, tmpA);
      tmpB.set(s.sx, s.sy, surfaceZ(s.sx));
      tmpC.set(s.sx * 0.7, s.sy + 0.4, s.lift);
      // quadratic bezier: page -> lift -> ring
      x = (1 - k) ** 2 * tmpB.x + 2 * (1 - k) * k * tmpC.x + k * k * tmpA.x;
      y = (1 - k) ** 2 * tmpB.y + 2 * (1 - k) * k * tmpC.y + k * k * tmpA.y;
      z = (1 - k) ** 2 * tmpB.z + 2 * (1 - k) * k * tmpC.z + k * k * tmpA.z;
      a = Math.min(1, t / 0.08);
    } else if (t < 0.68) {
      const k = (t - 0.32) / 0.36;
      ringPoint(s, enter + (leave - enter) * k, tmpA);
      x = tmpA.x;
      y = tmpA.y + Math.sin(time * 1.3 + s.wob) * 0.05;
      z = tmpA.z;
      a = 1;
    } else {
      const k = smooth((t - 0.68) / 0.32);
      ringPoint(s, leave, tmpA);
      tmpB.set(s.ex, s.ey, surfaceZ(s.ex));
      tmpC.set(s.ex * 0.7, s.ey + 0.4, s.lift);
      x = (1 - k) ** 2 * tmpA.x + 2 * (1 - k) * k * tmpC.x + k * k * tmpB.x;
      y = (1 - k) ** 2 * tmpA.y + 2 * (1 - k) * k * tmpC.y + k * k * tmpB.y;
      z = (1 - k) ** 2 * tmpA.z + 2 * (1 - k) * k * tmpC.z + k * k * tmpB.z;
      a = Math.min(1, (1 - t) / 0.1);
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    alpha[i] = a * 0.62;
  }
  pgeo.attributes.position.needsUpdate = true;
  pgeo.attributes.aAlpha.needsUpdate = true;
}

/* Theme */
function applyTheme() {
  const isDark = dark();
  coverMat.color.set(isDark ? "#7a3a22" : "#b4552f");
  edgeMat.color.set(isDark ? "#3a3830" : "#efe9dc");
  pmat.uniforms.uInk.value.set(css("--ink") || "#141413");
  pmat.uniforms.uAccent.value.set(css("--accent") || "#c2643f");
  shadow.material.map?.dispose();
  shadow.material.map = shadowTexture();
  shadow.material.needsUpdate = true;
  buildTextures();
  setSpread(spread, flipping);
}

/* Flip sequencing */
let spread = 0;
let flipping = false;
const n = pages.length;
function setSpread(k, midFlip) {
  const L = textures[(2 * k) % n];
  const R = textures[(2 * k + 1) % n];
  const nextL = textures[(2 * k + 2) % n];
  const nextR = textures[(2 * k + 3) % n];
  leftTop.map = L.left;
  rightTop.map = midFlip ? nextR.right : R.right;
  frontMat.map = R.right;
  backMat.map = nextL.back;
  [leftTop, rightTop, frontMat, backMat].forEach((m) => (m.needsUpdate = true));
}

const FLIP = 1.7;
const HOLD = 2.6;
let cycleStart = 0;

/* Layout + interaction */
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener(
  "pointermove",
  (e) => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / innerHeight) * 2 - 1;
  },
  { passive: true },
);

function resize() {
  const w = hero.clientWidth;
  const h = hero.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const narrow = w / h < 0.9;
  camera.fov = narrow ? 44 : 30;
  camera.position.set(0, 0, narrow ? 17 : 14);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  // keep the book in the lower part of the hero, below the copy
  const visibleH =
    2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  book.position.set(0, -visibleH * (narrow ? 0.33 : 0.36), 0);
  const s = narrow ? 0.72 : Math.min(0.84, (w / h) * 0.5);
  book.scale.setScalar(s);
  pmat.uniforms.uScale.value =
    h * renderer.getPixelRatio() * s * (narrow ? 0.17 : 0.21);
}
new ResizeObserver(resize).observe(hero);
resize();

let running = true;
new IntersectionObserver(([e]) => (running = e.isIntersecting)).observe(hero);

const start = performance.now();
function frame() {
  const time = (performance.now() - start) / 1000;
  pointer.x += (pointer.tx - pointer.x) * 0.04;
  pointer.y += (pointer.ty - pointer.y) * 0.04;
  book.rotation.x = -0.92 + pointer.y * 0.06 + Math.sin(time * 0.5) * 0.015;
  book.rotation.y = pointer.x * 0.16 + Math.sin(time * 0.3) * 0.03;
  book.rotation.z = Math.sin(time * 0.4) * 0.01;

  const local = time - cycleStart;
  if (local < HOLD) {
    if (flipping) {
      flipping = false;
      spread = (spread + 1) % (n / 2);
      setSpread(spread, false);
    }
    bendPage(OPEN, 0);
  } else if (local < HOLD + FLIP) {
    if (!flipping) {
      flipping = true;
      setSpread(spread, true);
    }
    const p = (local - HOLD) / FLIP;
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    bendPage(OPEN + (Math.PI - 2 * OPEN) * e, p);
  } else {
    cycleStart = time;
  }
  updateParticles(time);
  const fade = Math.max(0, 1 - scrollY / (hero.clientHeight * 0.9));
  canvas.style.opacity = String(fade);
  renderer.render(scene, camera);
}

applyTheme();
addEventListener("site-theme", applyTheme);
// canvas text needs webfonts; re-render textures once fonts arrive
document.fonts?.ready.then(() => applyTheme());

if (reduced) {
  bendPage(OPEN, 0);
  updateParticles(7.3);
  book.rotation.x = -0.92;
  renderer.render(scene, camera);
  addEventListener("site-theme", () => renderer.render(scene, camera));
  new ResizeObserver(() => renderer.render(scene, camera)).observe(hero);
} else {
  renderer.setAnimationLoop(() => {
    if (running && !document.hidden) frame();
  });
}
