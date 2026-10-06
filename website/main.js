(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };

  /* Theme */
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () =>
    root.dataset.theme === "dark" ||
    (root.dataset.theme !== "light" && systemDark.matches);
  const syncTheme = () => {
    const dark = isDark();
    $(".theme-sun").style.display = dark ? "none" : "";
    $(".theme-moon").style.display = dark ? "" : "none";
    $$("#shot-frame img").forEach((img) => {
      const src = dark ? img.dataset.dark : img.dataset.light;
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
    window.dispatchEvent(new CustomEvent("site-theme"));
  };
  $("#theme").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    store.set("reader-site-theme", next);
    syncTheme();
  });
  systemDark.addEventListener("change", syncTheme);
  syncTheme();

  /* Language */
  const translatable = $$("[data-en]");
  translatable.forEach((el) => (el.dataset.zh = el.innerHTML));
  const titles = {
    zh: document.title,
    en: "Reader — A local-first EPUB / PDF reader",
  };
  const setLang = (lang) => {
    root.lang = lang === "en" ? "en" : "zh-CN";
    translatable.forEach(
      (el) => (el.innerHTML = lang === "en" ? el.dataset.en : el.dataset.zh),
    );
    document.title = titles[lang];
    $("#lang").textContent = lang === "en" ? "中文" : "EN";
    store.set("reader-site-lang", lang);
  };
  $("#lang").addEventListener("click", () =>
    setLang(root.lang === "en" ? "zh" : "en"),
  );
  const savedLang = store.get("reader-site-lang");
  if (
    savedLang === "en" ||
    (!savedLang && !/^zh/i.test(navigator.language || ""))
  )
    setLang("en");

  /* Nav + reveal */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const revealer = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        revealer.unobserve(e.target);
      }),
    { rootMargin: "0px 0px -8% 0px" },
  );
  $$(".reveal").forEach((el, i) => {
    if (el.closest(".hero")) el.style.transitionDelay = `${120 + i * 90}ms`;
    revealer.observe(el);
  });

  /* Visibility-gated timing for looping demos */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function gate(el) {
    let visible = false;
    let waiters = [];
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && !document.hidden;
      if (visible) {
        waiters.forEach((r) => r());
        waiters = [];
      }
    }).observe(el);
    const ready = () =>
      visible ? Promise.resolve() : new Promise((r) => waiters.push(r));
    return async (ms) => {
      await ready();
      await sleep(ms);
      await ready();
    };
  }

  /* Scaled app window */
  const stage = $("#stage");
  const scaler = $("#stage-scale");
  let scale = 1;
  const fit = () => {
    scale = Math.min(1, stage.clientWidth / 1120);
    scaler.style.transform = `translateX(-50%) scale(${scale})`;
    stage.style.height = `${700 * scale}px`;
  };
  new ResizeObserver(fit).observe(stage);
  fit();

  /* Reading demo */
  const win = $("#window");
  const page = $("#page");
  const target = $("#target");
  const toolbar = $("#toolbar");
  const explain = $("#tb-explain");
  const cursor = $("#cursor");
  const chip = $("#chip");
  const userMsg = $("#msg-user");
  const aiMsg = $("#msg-ai");
  const aiText = $("#ai-text");
  const source = $("#source");
  const hintEls = [$("#chat-hint"), $("#chat-s1"), $("#chat-s2")];
  const steps = $$(".step");
  const answer = [
    ["作者区分了"],
    ["目录", 1],
    ["与"],
    ["论证", 1],
    [
      "：目录只告诉你这一章“讲什么”，论证才说明结论“为什么成立”。\n\n阅读时可以先用目录搭起结构，再回到正文，逐段核对每一步推理所依赖的证据。",
    ],
  ];
  const rel = (el, base, first = false) => {
    const b = base.getBoundingClientRect();
    const r = first ? el.getClientRects()[0] : el.getBoundingClientRect();
    return {
      x: (r.left - b.left) / scale,
      y: (r.top - b.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  };
  const moveCursor = (x, y) =>
    (cursor.style.transform = `translate(${x}px, ${y}px)`);
  const click = async (wait) => {
    cursor.classList.remove("click");
    void cursor.offsetWidth;
    cursor.classList.add("click");
    await wait(260);
  };
  const setStep = (i) =>
    steps.forEach((s, n) => s.classList.toggle("active", n === i));
  const renderAnswer = (count) => {
    let left = count;
    let html = "";
    for (const [text, bold] of answer) {
      if (left <= 0) break;
      const part = text.slice(0, left).replace(/\n/g, "<br />");
      left -= text.length;
      html += bold ? `<b>${part}</b>` : part;
    }
    return html;
  };
  const answerLength = answer.reduce((n, [t]) => n + t.length, 0);
  const resetDemo = () => {
    target.className = "sel";
    toolbar.classList.remove("on");
    explain.classList.remove("hit");
    chip.classList.remove("on");
    userMsg.classList.remove("on");
    aiMsg.classList.remove("on");
    source.classList.remove("on", "hit");
    aiText.innerHTML = "";
    hintEls.forEach((el) => (el.style.display = ""));
  };
  const finalDemo = () => {
    target.className = "sel marked";
    hintEls.forEach((el) => (el.style.display = "none"));
    userMsg.classList.add("on");
    aiMsg.classList.add("on");
    aiText.innerHTML = renderAnswer(answerLength);
    source.classList.add("on");
    moveCursor(-40, -40);
  };
  async function runDemo() {
    const wait = gate(win);
    moveCursor(760, 560);
    for (;;) {
      resetDemo();
      setStep(0);
      await wait(900);
      const t = rel(target, win, true);
      moveCursor(t.x - 2, t.y + 4);
      await wait(1000);
      target.classList.add("on");
      const end = target.getClientRects();
      const last = end[end.length - 1];
      const wb = win.getBoundingClientRect();
      moveCursor(
        (last.right - wb.left) / scale,
        (last.top - wb.top) / scale + 4,
      );
      await wait(1100);
      const tp = rel(target, page, true);
      toolbar.style.left = `${Math.min(page.clientWidth - toolbar.offsetWidth - 16, Math.max(20, tp.x - 10))}px`;
      toolbar.style.top = `${tp.y - 46}px`;
      toolbar.classList.add("on");
      await wait(700);
      setStep(1);
      const ex = rel(explain, win);
      moveCursor(ex.x + ex.w / 2, ex.y + ex.h / 2);
      await wait(950);
      explain.classList.add("hit");
      await click(wait);
      toolbar.classList.remove("on");
      target.style.transition = "none";
      target.classList.remove("on");
      void target.offsetWidth;
      target.style.transition = "";
      chip.classList.add("on");
      await wait(600);
      hintEls.forEach((el) => (el.style.display = "none"));
      chip.classList.remove("on");
      userMsg.classList.add("on");
      await wait(700);
      aiMsg.classList.add("on");
      aiText.innerHTML = '<span class="caret"></span>';
      await wait(500);
      for (let i = 1; i <= answerLength; i += 2) {
        aiText.innerHTML = renderAnswer(i) + '<span class="caret"></span>';
        await wait(34);
      }
      aiText.innerHTML = renderAnswer(answerLength);
      source.classList.add("on");
      await wait(900);
      setStep(2);
      const s = rel(source, win);
      moveCursor(s.x + s.w / 2, s.y + s.h / 2);
      await wait(1000);
      source.classList.add("hit");
      await click(wait);
      target.classList.add("marked", "pulse");
      await wait(400);
      moveCursor(t.x + 200, t.y + 90);
      await wait(3200);
    }
  }
  if (reduced) {
    finalDemo();
    setStep(2);
  } else runDemo();

  /* Cover processing stages */
  const panel = $("#stage-panel");
  const label = $("#stage-label");
  const pct = $("#stage-pct");
  const bar = $("#stage-bar");
  const labels = () =>
    root.lang === "en" ? ["Learning", "Consolidating"] : ["学习中", "沉淀中"];
  async function runCover() {
    const wait = gate(panel);
    for (;;) {
      for (let stageIndex = 0; stageIndex < 2; stageIndex++) {
        label.textContent = labels()[stageIndex];
        bar.style.width = "0%";
        pct.textContent = "0%";
        panel.classList.remove("out");
        await wait(500);
        for (let p = 0; p <= 100; p += 2 + Math.round(Math.random() * 3)) {
          bar.style.width = `${p}%`;
          pct.textContent = `${p}%`;
          await wait(45 + Math.random() * 50);
        }
        bar.style.width = "100%";
        pct.textContent = "100%";
        await wait(500);
        panel.classList.add("out");
        await wait(800);
      }
      await wait(2200);
    }
  }
  if (reduced) {
    label.textContent = labels()[1];
    bar.style.width = "64%";
    pct.textContent = "64%";
  } else runCover();

  /* Provider capability checks */
  const caps = $$("#providers .cap");
  async function runProviders() {
    const wait = gate($("#providers"));
    for (;;) {
      caps.forEach((c) => c.classList.remove("ok"));
      await wait(1000);
      for (const cap of caps) {
        await wait(380 + Math.random() * 300);
        cap.classList.add("ok");
      }
      await wait(4200);
    }
  }
  if (reduced) caps.forEach((c) => c.classList.add("ok"));
  else runProviders();

  /* Search typing */
  const typed = $("#typed");
  const results = $$("#results .res");
  async function runSearch() {
    const wait = gate($("#results"));
    for (;;) {
      typed.textContent = "";
      results.forEach((r) => r.classList.remove("on"));
      await wait(900);
      for (const ch of "证据") {
        typed.textContent += ch;
        await wait(260);
      }
      for (const r of results) {
        await wait(220);
        r.classList.add("on");
      }
      await wait(4200);
    }
  }
  if (reduced) {
    typed.textContent = "证据";
    results.forEach((r) => r.classList.add("on"));
  } else runSearch();

  /* Theme mini cycle */
  const themeSeg = $$("#themes .seg-theme span");
  const minis = $$("#themes .mini");
  async function runThemes() {
    const wait = gate($("#themes"));
    let i = 2;
    for (;;) {
      await wait(1800);
      i = (i + 1) % 3;
      themeSeg.forEach((s, n) => s.classList.toggle("on", n === i));
      minis[0].style.opacity = i === 1 ? 0.35 : 1;
      minis[1].style.opacity = i === 0 ? 0.35 : 1;
    }
  }
  if (!reduced) runThemes();

  /* File tree */
  const tree = $("#tree");
  $$(".row", tree).forEach(
    (row, i) => (row.style.transitionDelay = `${i * 110}ms`),
  );
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    tree.classList.add("in");
    obs.disconnect();
  }).observe(tree);
  $("#port").textContent = String(49152 + Math.floor(Math.random() * 16000));

  /* Gallery */
  const tabs = $$("#gallery-tabs button");
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      $$("#shot-frame img").forEach((img) =>
        img.classList.toggle("on", img.dataset.shot === tab.dataset.shot),
      );
    }),
  );

  /* Copy buttons */
  $$(".copy").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const code = btn.parentElement.cloneNode(true);
      code.querySelectorAll(".copy, .c").forEach((n) => n.remove());
      const text = code.textContent
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      try {
        await navigator.clipboard.writeText(text);
        btn.innerHTML = '<svg class="icon"><use href="#i-check" /></svg>';
        setTimeout(
          () =>
            (btn.innerHTML = '<svg class="icon"><use href="#i-copy" /></svg>'),
          1400,
        );
      } catch {}
    }),
  );
})();
