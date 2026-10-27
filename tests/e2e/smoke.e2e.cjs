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
      ],
    }],
  }],
};
const HTML = `<!doctype html><html><head><title>Instagram</title>
<script type="application/json">${JSON.stringify(embedded)}</script></head>
<body><main><article><a href="/p/Ctest123/">post</a>
<img alt="Foto" width="400" height="400" src="${cdn("a", 640)}"></article></main></body></html>`;

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
    await context.route("https://www.instagram.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: HTML }),
    );
    await context.route("https://scontent.cdninstagram.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );

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

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector(".card");
    const cards = await popup.$$eval(".card", (els) => els.map((e) => e.querySelector(".meta")?.textContent));
    console.log("   cards:", cards);
    assert(cards.length === 3, "3 mídias do carrossel detectadas sem duplicata da imagem do DOM");
    const badges = await popup.$$eval(".type-badge", (els) => els.map((e) => e.textContent));
    assert(badges[2] === "Vídeo", "vídeo do carrossel identificado");
    assert(cards[0].startsWith("1080×1350"), "resolução exibida");

    await popup.click('.chip[data-filter="video"]');
    assert((await popup.$$(".card")).length === 1, "filtro de vídeos");
    await popup.click('.chip[data-filter="all"]');

    await popup.click("#select-all");
    assert((await popup.textContent("#selection-info")) === "3 selecionadas", "selecionar todas");
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
        return statuses.length === 3 && statuses.every((s) => ["Concluído", "Falhou"].includes(s));
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
