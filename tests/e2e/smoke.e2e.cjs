/**
 * Teste de integração: carrega a extensão (dist/) no Chromium, abre uma página
 * simulada do Instagram e verifica detecção, seleção, fila e tratamento de erro.
 * Uso: npm run build && node tests/e2e/smoke.e2e.cjs
 * Requer o pacote "playwright" com Chromium instalado.
 */
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { chromium } = require("playwright");

const DIST = path.resolve(__dirname, "../../dist");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const cdn = (id, w) => `https://scontent.cdninstagram.com/v/t51/${id}_n.jpg?stp=p${w}`;
const embedded = {
  require: [{
    items: [{
      code: "Ctest123",
      user: { username: "perfil_teste" },
      carousel_media: [
        { image_versions2: { candidates: [{ url: cdn("a", 1080), width: 1080, height: 1350 }] } },
        { image_versions2: { candidates: [{ url: cdn("b", 1080), width: 1080, height: 1080 }] } },
        {
          image_versions2: { candidates: [{ url: cdn("c", 640), width: 640, height: 1136 }] },
          video_versions: [{ url: "https://scontent.cdninstagram.com/o1/v/c.mp4", width: 720, height: 1280 }],
        },
        { image_versions2: { candidates: [{ url: cdn("d", 320), width: 320, height: 320 }] } },
      ],
    }],
  }],
};
const HTML = `<!doctype html><html><head><title>Instagram</title>
<script type="application/json">${JSON.stringify(embedded)}</script>
<style>
  body { margin: 0; font-family: sans-serif; }
  .carousel { width: 400px; height: 400px; overflow: hidden; margin: 40px; position: relative; }
  .carousel ul { display: flex; margin: 0; padding: 0; list-style: none; transition: transform .3s; }
  .carousel li, .carousel img, .carousel video { width: 400px; height: 400px; flex-shrink: 0; display: block; object-fit: cover; }
</style></head>
<body><main><article><a href="/p/Ctest123/">post</a>
<div class="carousel"><ul id="track">
  <li><img alt="Foto" src="${cdn("a", 320)}"></li>
  <li><img alt="Foto" src="${cdn("b", 320)}"></li>
  <li><video poster="${cdn("c", 320)}"></video></li>
  <li><img alt="Foto" src="${cdn("d", 150)}"></li>
</ul></div>
<button id="next" onclick="window.slide=(window.slide||0)+1;document.getElementById('track').style.transform='translateX(' + (-400*window.slide) + 'px)'">próximo</button>
</article></main></body></html>`;

// Perfil com grade de posts e uma publicação aberta em janela (modal) por cima.
const PROFILE_HTML = `<!doctype html><html><head><title>Instagram</title><style>
  body { margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 300px); gap: 4px; padding: 20px; }
  .grid a { position: relative; display: block; width: 300px; height: 300px; }
  .grid img { width: 300px; height: 300px; object-fit: cover; display: block; }
  .grid .cover { position: absolute; inset: 0; }
  #modal { position: fixed; inset: 0; background: rgb(0 0 0 / 0.65); display: none; place-items: center; }
  #modal.open { display: grid; }
  #dialog { width: 700px; height: 520px; background: #fff; display: flex; }
  #dialog img { width: 420px; height: 520px; object-fit: cover; }
</style></head><body><main>
  <div class="grid">
    <a href="/p/Cg1/"><img alt="" src="${cdn("g1", 320)}"><div class="cover"></div></a>
    <a href="/p/Cg2/"><img alt="" src="${cdn("g2", 320)}"><div class="cover"></div></a>
    <a href="/p/Cg3/"><img alt="" src="${cdn("g3", 320)}"><div class="cover"></div></a>
    <a href="/p/Cg4/"><img alt="" src="${cdn("g4", 320)}"><div class="cover"></div></a>
    <a href="/p/Cg5/"><img alt="" src="${cdn("g5", 320)}"><div class="cover"></div></a>
    <a href="/p/Cg6/"><img alt="" src="${cdn("g6", 320)}"><div class="cover"></div></a>
  </div>
  <button id="open" onclick="document.getElementById('modal').classList.add('open')">abrir</button>
</main>
<div id="modal" role="dialog"><div id="dialog"><article><a href="/p/Cmodal/">p</a><img alt="" src="${cdn("modal", 640)}"></article><div>comentários</div></div></div>
</body></html>`;

// Destaque (story fixado) com dois vídeos transmitidos em partes.
const dash = (name) =>
  `<MPD><Period><AdaptationSet><Representation><BaseURL>https://scontent.cdninstagram.com/v/${name}-video.mp4?x=1&amp;y=2</BaseURL></Representation></AdaptationSet><AdaptationSet><Representation><BaseURL>https://scontent.cdninstagram.com/v/${name}-audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
const storyItem = (pk, duration, name) => ({
  pk,
  id: `${pk}_77`,
  video_duration: duration,
  video_dash_manifest: dash(name),
  image_versions2: { candidates: [{ url: cdn(`capa-${name}`, 720), width: 720, height: 1280 }] },
  video_versions: [{ url: `https://scontent.cdninstagram.com/o1/v/story-${name}.mp4`, width: 720, height: 1280 }],
});
const STORY_HTML = `<!doctype html><html><head><title>Instagram</title>
<script type="application/json">${JSON.stringify({
  reels_media: [{ id: "highlight:179", user: { username: "perfil_teste" }, items: [storyItem("5001", 15, "s1"), storyItem("5002", 15, "s2")] }],
})}</script>
<style>body { margin: 0; background: #111; } section { position: relative; width: 400px; height: 700px; margin: 0 auto; }
video { width: 400px; height: 700px; display: block; background: #000; }
header { position: absolute; top: 20px; left: 60px; color: #fff; }</style></head>
<body><section><video muted></video><header>perfil_teste</header></section>
<script>
  // Player em partes: src é um blob e os pedaços vêm do CDN via fetch.
  document.querySelector("video").src = URL.createObjectURL(new Blob(["x"], { type: "video/mp4" }));
  fetch("https://scontent.cdninstagram.com/v/s1-video.mp4?bytestart=0&byteend=99");
  setTimeout(() => fetch("https://scontent.cdninstagram.com/v/s2-video.mp4?bytestart=0&byteend=99"), 200);
</script></body></html>`;

function assert(cond, msg) {
  if (!cond) throw new Error("FALHOU: " + msg);
  console.log("ok -", msg);
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "instafetch-e2e-"));
  const context = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      // Opcional: aponta o CDN para um servidor HTTPS local (ver README) para testar downloads reais.
      ...(process.env.CDN_MAP ? [`--host-resolver-rules=MAP scontent.cdninstagram.com ${process.env.CDN_MAP}`, "--ignore-certificate-errors", "--no-proxy-server"] : []),
    ],
  });
  try {
    await context.route("https://www.instagram.com/**", (route) => {
      const { pathname } = new URL(route.request().url());
      const body = pathname.startsWith("/stories/") ? STORY_HTML : pathname === "/perfil_teste/" ? PROFILE_HTML : HTML;
      return route.fulfill({ status: 200, contentType: "text/html", body });
    });
    await context.route("https://scontent.cdninstagram.com/**", (route) => {
      const isVideo = route.request().url().includes(".mp4");
      return route.fulfill({ status: 200, contentType: isVideo ? "video/mp4" : "image/png", body: isVideo ? Buffer.alloc(100) : PNG });
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto("https://www.instagram.com/p/Ctest123/");
    await page.waitForTimeout(800);
    const tabId = await worker.evaluate(async () => {
      // Sem a permissão "tabs" a URL não é visível; a aba recém-aberta é a ativa.
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id;
    });
    assert(typeof tabId === "number", "aba do Instagram encontrada");

    // ---------- Botão sobre a mídia ----------
    await page.setViewportSize({ width: 900, height: 700 });
    const visibleButtons = () =>
      page.evaluate(() => document.querySelector("instafetch-overlay").shadowRoot.querySelectorAll(".wrap:not([hidden])").length);
    const overlayLabel = async () => {
      await page.mouse.move(0, 0);
      await page.mouse.move(65, 83); // sobre o botão do slide visível
      await page.waitForTimeout(150);
      return page.evaluate(() => {
        const wrap = document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden])");
        return wrap.querySelector(".label").textContent;
      });
    };
    await page.waitForFunction(() => document.querySelector("instafetch-overlay"));
    await page.waitForTimeout(300);
    assert((await visibleButtons()) === 1, "carrossel: só o slide visível tem botão");
    const label1 = await overlayLabel();
    assert(label1 === "Baixar foto · 1080×1350 · item 1", `rótulo mostra a versão em alta resolução (${label1})`);

    await page.click("#next");
    await page.waitForTimeout(700);
    assert((await visibleButtons()) === 1, "botão acompanha a troca de slide");
    const label2 = await overlayLabel();
    assert(label2 === "Baixar foto · 1080×1080 · item 2", `slide 2 identificado (${label2})`);
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), "page-overlay.png"), clip: { x: 0, y: 0, width: 500, height: 520 } });

    const btn = await page.evaluate(() => {
      const r = document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden]) button").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(btn.x, btn.y);
    await page.waitForFunction(
      () => /done|error/.test(document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden]) button").dataset.state),
      null,
      { timeout: 20000 },
    );
    const overlayState = await page.evaluate(() => {
      const wrap = document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden])");
      return `${wrap.querySelector("button").dataset.state} | ${wrap.querySelector(".label").textContent}`;
    });
    console.log("   botão após clique:", overlayState);
    assert(process.env.CDN_MAP ? overlayState.startsWith("done") : true, "download pelo botão concluído");

    await page.click("#next");
    await page.waitForTimeout(700);
    const label3 = await overlayLabel();
    assert(label3 === "Baixar vídeo · 720×1280 · item 3", `vídeo do carrossel encontrado pela capa (${label3})`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector(".card");
    const cards = await popup.$$eval(".card", (els) => els.map((e) => e.querySelector(".meta")?.textContent));
    console.log("   cards:", cards);
    assert(cards.length === 4, "4 mídias do carrossel detectadas sem duplicatas das imagens do DOM");
    const badges = await popup.$$eval(".type-badge", (els) => els.map((e) => e.textContent));
    assert(badges[2] === "Vídeo", "vídeo do carrossel identificado");
    assert(cards[0].startsWith("1080×1350"), "resolução exibida");

    await popup.click('.chip[data-filter="video"]');
    assert((await popup.$$(".card")).length === 1, "filtro de vídeos");
    await popup.click('.chip[data-filter="all"]');

    // ---------- Filtro de resolução ----------
    await popup.selectOption("#min-resolution", "1080");
    const filtered = await popup.$$eval(".card .meta", (els) => els.map((e) => e.textContent));
    assert(filtered.length === 3 && !filtered.some((t) => t.startsWith("320×320")), "filtro ≥1080 esconde a imagem pequena");
    assert((await popup.textContent("#hidden-info")) === "1 oculta (menores)", "informa quantas foram ocultadas");
    await popup.reload();
    await popup.waitForSelector(".card");
    assert((await popup.inputValue("#min-resolution")) === "1080" && (await popup.$$(".card")).length === 3, "filtro de resolução é lembrado");

    await popup.click("#select-all");
    assert((await popup.textContent("#selection-info")) === "3 selecionadas", "selecionar todas respeita o filtro");
    await popup.click("#clear-selection");
    assert((await popup.textContent("#selection-info")) === "Nenhuma selecionada", "limpar seleção");

    await popup.click("#select-all");
    await popup.click("#download-selected");
    await popup.click('.tab[data-tab="queue"]');
    // Os downloads reais saem pela rede do navegador (fora do mock), então podem
    // concluir ou falhar; o importante é que cada item chegue a um estado final.
    await popup.waitForFunction(
      () => {
        const statuses = [...document.querySelectorAll("#queue-list .status")].map((s) => s.textContent);
        return statuses.length >= 3 && statuses.every((s) => ["Concluído", "Falhou"].includes(s));
      },
      null,
      { timeout: 30000 },
    ).catch(async (e) => {
      console.log(await popup.textContent("#queue-list"), await popup.textContent("#toast"));
      throw e;
    });
    const rows = await popup.$$eval("#queue-list .row", (els) =>
      els.map((e) => `${e.querySelector(".name").textContent} | ${e.querySelector(".detail").textContent}`),
    );
    console.log("   fila:\n     " + rows.join("\n     "));
    assert(rows.some((r) => r.includes("perfil_teste_Ctest123_03.mp4")), "nome de arquivo descritivo com extensão correta");
    assert(!rows.some((r) => /SERVER_|NETWORK_/.test(r.split("|")[1])), "erros exibidos em linguagem compreensível");

    const failed = await popup.$$(".row .icon-btn[title='Tentar novamente']");
    if (failed.length) {
      await failed[0].click();
      await popup.waitForFunction(() => /tentativa 2|Falhou/.test(document.querySelector("#queue-list").textContent), null, { timeout: 15000 });
      assert(true, "tentar novamente reenfileira o item");
    }

    if (process.env.CDN_MAP) {
      // O Playwright intercepta e renomeia os arquivos baixados, então o caminho
      // solicitado pela extensão é conferido pelo histórico salvo.
      const { history } = await worker.evaluate(() => chrome.storage.local.get("history"));
      console.log("   histórico:", history.map((h) => h.filename));
      assert(history.some((h) => h.filename === "InstaFetch/perfil_teste_Ctest123/perfil_teste_Ctest123_01.jpg"), "arquivo organizado em subpasta");
      await popup.click('.tab[data-tab="history"]');
      assert((await popup.$$("#history-list .row")).length >= 2, "histórico registra os downloads concluídos");
      await popup.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), "popup-history.png") });
    }

    // ---------- Publicação aberta sobre a grade do perfil ----------
    const profile = await context.newPage();
    await profile.setViewportSize({ width: 1000, height: 760 });
    await profile.goto("https://www.instagram.com/perfil_teste/");
    await profile.waitForTimeout(900);
    const shown = () =>
      profile.evaluate(() =>
        [...document.querySelector("instafetch-overlay").shadowRoot.querySelectorAll(".wrap:not([hidden])")].map((w) => w.style.transform),
      );
    const gridButtons = await shown();
    assert(gridButtons.length === 6, `grade do perfil: um botão por post (${gridButtons.length})`);
    await profile.click("#open");
    await profile.waitForTimeout(900);
    const modalButtons = await shown();
    console.log("   botões com a janela aberta:", modalButtons);
    assert(modalButtons.length === 1, "com a publicação aberta, só ela tem botão (nada da grade por cima)");
    const modalBox = await profile.evaluate(() => document.querySelector("#dialog img").getBoundingClientRect().toJSON());
    const [, bx, by] = modalButtons[0].match(/translate\((-?\d+)px, (-?\d+)px\)/).map(Number);
    assert(Math.abs(bx - (modalBox.left + 8)) <= 1 && Math.abs(by - (modalBox.top + 8)) <= 1, "botão fica no canto da mídia aberta");
    await profile.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), "page-modal.png") });
    await profile.close();

    // ---------- Vídeo de destaque (story fixado) em partes ----------
    const story = await context.newPage();
    await story.setViewportSize({ width: 900, height: 760 });
    await story.goto("https://www.instagram.com/stories/highlights/179/");
    await story.waitForTimeout(1200);
    const storyWrap = () => story.evaluate(() => {
      const wrap = document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden])");
      if (!wrap) return null;
      const r = wrap.querySelector("button").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const storyBtn = await storyWrap();
    assert(storyBtn, "vídeo do destaque tem botão");
    await story.mouse.move(storyBtn.x, storyBtn.y);
    await story.waitForTimeout(150);
    const storyLabel = await story.evaluate(() => document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden]) .label").textContent);
    assert(storyLabel === "Baixar vídeo · 720×1280", `vídeo em partes identificado (${storyLabel})`);
    await story.mouse.click(storyBtn.x, storyBtn.y);
    await story.waitForFunction(
      () => /done|error/.test(document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden]) button").dataset.state),
      null,
      { timeout: 20000 },
    );
    const storyState = await story.evaluate(() => {
      const wrap = document.querySelector("instafetch-overlay").shadowRoot.querySelector(".wrap:not([hidden])");
      return `${wrap.querySelector("button").dataset.state} | ${wrap.querySelector(".label").textContent}`;
    });
    console.log("   destaque após clique:", storyState);
    assert(!storyState.includes("transmitido em partes") && !storyState.includes("identificar"), "não mostra mais o erro de vídeo em partes");
    if (process.env.CDN_MAP) assert(storyState.startsWith("done"), "vídeo do destaque baixado");
    const storyTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${storyTabId}`);
    await popup.waitForSelector(".card");
    const storyQueue = await worker.evaluate(async () => (await chrome.storage.session.get("jobs")).jobs.map((j) => j.filename));
    console.log("   fila:", storyQueue.filter((f) => f.includes("story")));
    assert(storyQueue.some((f) => f === "InstaFetch/perfil_teste_story_5002/perfil_teste_story_5002_01.mp4"), "o vídeo certo (o que está tocando) foi baixado, com nome do story");
    const firstCard = await popup.$eval(".card", (c) => c.classList.contains("unavailable"));
    assert(!firstCard, "popup no destaque lista o vídeo atual como disponível");
    await story.close();

    await popup.setViewportSize({ width: 420, height: 580 });
    await popup.click('.tab[data-tab="media"]');
    await popup.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), "popup-media.png") });
    await popup.click('.tab[data-tab="queue"]');
    await popup.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), "popup-queue.png") });
    console.log("\nTodos os testes de integração passaram.");
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
