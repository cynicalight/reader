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

  /* Reading demo: three scenes, each showing only the panes its task needs */
  const win = $("#window");
  const doc = $("#doc");
  const cursor = $("#cursor");
  const selBar = $("#sel-bar");
  const notePop = $("#note-pop");
  const noteText = $("#np-text");
  const noteCount = $("#note-count");
  const freshCards = [$("#card-hl"), $("#card-note")];
  const empty = $("#ai-empty");
  const userMsg = $("#m-user");
  const refBtn = $("#ref-btn");
  const refPop = $("#ref-pop");
  const refCard = $("#ref-card");
  const waiting = $("#m-wait");
  const aiMsg = $("#m-ai");
  const answer = $("#answer");
  const actions = $("#m-actions");
  const flows = [$("#src"), $("#tr")];
  const sceneTabs = $$("#steps .step");
  const scenes = sceneTabs.map((tab) => tab.dataset.scene);
  const sentence = (n, flow = flows[0]) => $(`[data-s="${n}"]`, flow);
  const sentences = (n) => flows.map((flow) => sentence(n, flow));
  const blocks = (n) => flows.map((flow) => $(`p[data-b="${n}"]`, flow));
  const note = "对照 4.2 节的消融实验，看结论是否超出证据。";
  const reply = [
    ["原文结论：", 1],
    [
      "作者认为，不看原文段落就作答的助手，会让读者更难判断一句话出自哪里、是否成立。\n",
    ],
    ["补充说明：", 1],
    [
      "流畅本身不是问题，问题在于回答与原句脱节。读者无法回到出处核对时，容易把助手的概括当成作者的主张；所以作者主张每次解释都附着在引出它的那句原文上。",
    ],
  ];
  const replyLength = reply.reduce((n, [text]) => n + text.length, 0);
  const renderReply = (count, caret = false) => {
    let left = count;
    let html = "<p>";
    for (const [text, bold] of reply) {
      if (left <= 0) break;
      const part = text.slice(0, left).replace(/\n/g, "</p><p>");
      left -= text.length;
      html += bold ? `<b>${part}</b>` : part;
    }
    return `${html}${caret ? '<span class="caret"></span>' : ""}</p>`;
  };
  const rel = (el, base = win) => {
    const b = base.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - b.left) / scale,
      y: (r.top - b.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  };
  const lineRects = (el) => {
    const b = win.getBoundingClientRect();
    return [...el.getClientRects()].map((r) => ({
      left: (r.left - b.left) / scale,
      right: (r.right - b.left) / scale,
      top: (r.top - b.top) / scale,
      bottom: (r.bottom - b.top) / scale,
    }));
  };
  const moveCursor = (x, y) =>
    (cursor.style.transform = `translate(${x}px, ${y}px)`);
  const parkCursor = () => moveCursor(1060, 640);
  const mark = (n, kind) =>
    sentences(n).forEach((el) => (el.dataset.mark = kind));
  const pulse = (el) => {
    delete el.dataset.pulse;
    void el.offsetWidth;
    el.dataset.pulse = "";
  };
  const clearHover = () => {
    $$("p[data-hover]", win).forEach((p) => delete p.dataset.hover);
    $$("[data-linked]", win).forEach((s) => delete s.dataset.linked);
  };
  // Pop-ups sit in the document pane, above or below the selected sentence.
  const place = (pop, el, below) => {
    const d = rel(doc);
    const lines = lineRects(el);
    const line = below ? lines[lines.length - 1] : lines[0];
    const left = Math.min(
      doc.clientWidth - pop.offsetWidth - 12,
      Math.max(12, line.left - d.x - 10),
    );
    const top = below
      ? line.bottom - d.y + 10
      : line.top - d.y - pop.offsetHeight - 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };

  function reset(name, done = false) {
    win.dataset.scene = name;
    win.dataset.view = "src";
    sceneTabs.forEach((tab) =>
      tab.setAttribute("aria-selected", String(tab.dataset.scene === name)),
    );
    for (const el of $$("[data-s]", win)) {
      delete el.dataset.mark;
      delete el.dataset.sel;
      delete el.dataset.pulse;
    }
    clearHover();
    $$(".hit", win).forEach((el) => el.classList.remove("hit"));
    flows.forEach((flow) => (flow.style.transform = ""));
    [selBar, notePop, refPop].forEach((el) => el.classList.remove("on"));
    // Later scenes keep the marks the first scene makes.
    const annotated = done || name !== "notes";
    mark(1, "hl");
    mark(8, "q");
    if (annotated) [3, 5].forEach((n) => mark(n, "hl"));
    for (const card of freshCards) {
      card.style.transition = "none";
      card.classList.toggle("on", annotated);
      card.classList.remove("flash");
      void card.offsetWidth;
      card.style.transition = "";
    }
    noteCount.textContent = annotated ? "4" : "2";
    noteText.textContent = "";
    empty.style.display = "";
    [userMsg, waiting, aiMsg, actions].forEach((el) =>
      el.classList.remove("on"),
    );
    answer.innerHTML = "";
  }

  function showFinal(name) {
    reset(name, true);
    if (name === "translate") {
      win.dataset.view = "both";
      blocks(2).forEach((p) => (p.dataset.hover = ""));
      sentences(5).forEach((s) => (s.dataset.linked = ""));
    }
    if (name === "ask") {
      empty.style.display = "none";
      [userMsg, aiMsg, actions].forEach((el) => el.classList.add("on"));
      answer.innerHTML = renderReply(replyLength);
    }
    moveCursor(-40, -40);
  }

  const wait = gate(win);
  const cancelled = Symbol("cancelled");
  let token = 0;

  async function clickOn(el, step) {
    const r = rel(el);
    moveCursor(r.x + r.w / 2, r.y + r.h / 2);
    await step(900);
    el.classList.add("hit");
    cursor.classList.remove("click");
    void cursor.offsetWidth;
    cursor.classList.add("click");
    await step(260);
  }
  async function select(n, step) {
    const el = sentence(n);
    const lines = lineRects(el);
    moveCursor(lines[0].left - 2, lines[0].top + 4);
    await step(950);
    el.dataset.sel = "";
    void el.offsetWidth;
    el.dataset.sel = "on";
    const last = lines[lines.length - 1];
    moveCursor(last.right, last.top + 4);
    await step(1100);
    place(selBar, el, false);
    selBar.classList.add("on");
    await step(650);
    return el;
  }
  async function hover(block, n, side, step) {
    const target = sentence(n, flows[side]);
    const r = lineRects(target)[0];
    moveCursor((r.left + r.right) / 2, r.top + 6);
    await step(850);
    clearHover();
    blocks(block).forEach((p) => (p.dataset.hover = ""));
    sentences(n).forEach((s) => (s.dataset.linked = ""));
    await step(1500);
  }

  const play = {
    async notes(step) {
      await step(700);
      let s = await select(3, step);
      await clickOn($('[data-tool="yellow"]', selBar), step);
      selBar.classList.remove("on");
      delete s.dataset.sel;
      mark(3, "hl");
      noteCount.textContent = "3";
      freshCards[0].classList.add("on", "flash");
      await step(1300);
      freshCards[0].classList.remove("flash");
      s = await select(5, step);
      await clickOn($('[data-tool="note"]', selBar), step);
      selBar.classList.remove("on");
      place(notePop, s, true);
      notePop.classList.add("on");
      await step(500);
      for (const ch of note) {
        noteText.textContent += ch;
        await step(55);
      }
      await clickOn($("#np-save"), step);
      notePop.classList.remove("on");
      delete s.dataset.sel;
      mark(5, "hl");
      noteCount.textContent = "4";
      freshCards[1].classList.add("on", "flash");
      await step(1300);
      freshCards[1].classList.remove("flash");
      // Every record leads back to its passage.
      await clickOn(freshCards[0], step);
      pulse(sentence(3));
      await step(2600);
    },
    async translate(step) {
      await step(600);
      const both = $('.view-seg [data-view="both"]', win);
      await clickOn(both, step);
      both.classList.remove("hit");
      win.dataset.view = "both";
      await step(1400);
      await hover(2, 5, 0, step);
      await hover(2, 6, 1, step);
      clearHover();
      // The two panes scroll together.
      flows.forEach((flow) => (flow.style.transform = "translateY(-110px)"));
      await step(1300);
      await hover(4, 10, 0, step);
      await step(1600);
    },
    async ask(step) {
      await step(700);
      const s = await select(4, step);
      await clickOn($('[data-tool="ask"]', selBar), step);
      selBar.classList.remove("on");
      delete s.dataset.sel;
      empty.style.display = "none";
      userMsg.classList.add("on");
      await step(600);
      waiting.classList.add("on");
      await step(1800);
      waiting.classList.remove("on");
      aiMsg.classList.add("on");
      for (let i = 1; i <= replyLength; i += 2) {
        answer.innerHTML = renderReply(i, true);
        await step(30);
      }
      answer.innerHTML = renderReply(replyLength);
      actions.classList.add("on");
      await step(900);
      await clickOn(refBtn, step);
      refPop.classList.add("on");
      await step(700);
      await clickOn(refCard, step);
      refPop.classList.remove("on");
      refBtn.classList.remove("hit");
      blocks(2)[0].dataset.hover = "";
      pulse(s);
      await step(2800);
    },
  };

  async function runDemo(from) {
    const mine = ++token;
    const step = async (ms) => {
      await wait(ms);
      if (mine !== token) throw cancelled;
    };
    try {
      for (let i = from; ; i = (i + 1) % scenes.length) {
        reset(scenes[i]);
        parkCursor();
        await play[scenes[i]](step);
      }
    } catch (error) {
      if (error !== cancelled) throw error;
    }
  }
  sceneTabs.forEach((tab, i) =>
    tab.addEventListener("click", () =>
      reduced ? showFinal(scenes[i]) : runDemo(i),
    ),
  );
  if (reduced) showFinal(scenes[0]);
  else runDemo(0);

  /* Cover processing stages */
  const panel = $("#stage-panel");
  const label = $("#stage-label");
  const pct = $("#stage-pct");
  const bar = $("#stage-bar");
  const labels = () =>
    root.lang === "en" ? ["Learning", "Translating"] : ["学习中", "翻译中"];
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

  /* Citation formats */
  const citeFormats = $$("#cite .fmts span");
  const citeText = $("#cite-text");
  const citations = [
    citeText.textContent,
    "Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
    "@inproceedings{vaswani2017attention,\n  title  = {Attention Is All You Need},\n  author = {Vaswani, Ashish and …},\n  year   = {2017}\n}",
    "TY  - CONF\nTI  - Attention Is All You Need\nAU  - Vaswani, Ashish\nPY  - 2017\nER  -",
  ];
  async function runCite() {
    const wait = gate($("#cite"));
    for (let i = 0; ; ) {
      await wait(2600);
      i = (i + 1) % citations.length;
      citeFormats.forEach((s, n) => s.classList.toggle("on", n === i));
      citeText.textContent = citations[i];
    }
  }
  if (!reduced) runCite();

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
