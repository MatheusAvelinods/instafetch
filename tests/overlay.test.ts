// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describe as describeItem, visibleBox } from "../src/content/overlay";
import { resolveElement } from "../src/content/resolve";
import { MediaStore } from "../src/content/store";
import type { MediaItem } from "../src/shared/types";

const viewport = { left: 0, top: 0, right: 1200, bottom: 800 };
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe("visibleBox", () => {
  it("mostra o botão no slide atual do carrossel e esconde os vizinhos", () => {
    const track = box(100, 100, 400, 400); // contêiner com overflow: hidden
    expect(visibleBox(box(100, 100, 400, 400), [track], viewport)).toEqual(box(100, 100, 400, 400));
    expect(visibleBox(box(500, 100, 400, 400), [track], viewport)).toBeNull();
    // Durante a animação, o slide que está saindo deixa de ter botão.
    expect(visibleBox(box(-150, 100, 400, 400), [track], viewport)).toBeNull();
  });

  it("acompanha a parte visível quando a mídia está parcialmente fora da janela", () => {
    expect(visibleBox(box(100, -200, 400, 500), [], viewport)).toEqual(box(100, 0, 400, 300));
  });

  it("aceita DOMRect de verdade (propriedades no protótipo)", () => {
    const rect = new DOMRect(100, 100, 400, 400);
    expect(visibleBox(rect, [new DOMRect(100, 100, 400, 400)], viewport)).toEqual(box(100, 100, 400, 400));
  });

  it("ignora elementos pequenos ou fora da tela", () => {
    expect(visibleBox(box(0, 0, 40, 40), [], viewport)).toBeNull();
    expect(visibleBox(box(0, 900, 400, 400), [], viewport)).toBeNull();
  });
});

function sized<T extends HTMLElement>(el: T, size = 400): T {
  el.getBoundingClientRect = () => ({ width: size, height: size }) as DOMRect;
  return el;
}

const cdn = (path: string, q = "") => `https://scontent.cdninstagram.com${path}${q}`;

describe("resolveElement", () => {
  it("troca a miniatura exibida pela versão em alta resolução conhecida", () => {
    document.body.innerHTML = `<article><a href="/p/Cpost/">p</a><img alt="" src="${cdn("/v/a_n.jpg", "?s=320")}"></article>`;
    const img = sized(document.querySelector("img")!);
    const store = new MediaStore();
    const full: MediaItem = {
      key: "/v/a_n.jpg",
      type: "image",
      url: cdn("/v/a_n.jpg", "?s=1440"),
      width: 1440,
      height: 1800,
      shortcode: "Cpost",
      owner: "fulano",
      index: 2,
      source: "network",
    };
    store.add([full]);
    expect(resolveElement(img, store)).toEqual(full);
  });

  it("na grade do perfil, a capa de um reel baixa o vídeo", () => {
    document.body.innerHTML = `<a href="/reel/Creel/"><img alt="" src="${cdn("/v/capa_n.jpg", "?s=320")}"></a>`;
    const img = sized(document.querySelector("img")!);
    const store = new MediaStore();
    store.add([
      { key: "/o1/v.mp4", type: "video", url: cdn("/o1/v.mp4"), thumbnailUrl: cdn("/v/capa_n.jpg", "?s=1080"), source: "network" },
    ]);
    expect(resolveElement(img, store)?.type).toBe("video");
  });

  it("vídeo em streaming: encontra o link direto pela capa (poster)", () => {
    document.body.innerHTML = `<article><video poster="${cdn("/v/poster_n.jpg", "?s=640")}"></video></article>`;
    const video = sized(document.querySelector("video")!);
    Object.defineProperty(video, "currentSrc", { value: "blob:https://www.instagram.com/x" });
    const store = new MediaStore();
    store.add([
      { key: "/o1/a.mp4", type: "video", url: cdn("/o1/a.mp4"), thumbnailUrl: cdn("/v/outro_n.jpg"), source: "network" },
      { key: "/o1/b.mp4", type: "video", url: cdn("/o1/b.mp4"), thumbnailUrl: cdn("/v/poster_n.jpg", "?s=1080"), source: "network" },
    ]);
    expect(resolveElement(video, store)?.key).toBe("/o1/b.mp4");
  });

  it("vídeo em streaming: usa o único vídeo conhecido da publicação", () => {
    document.body.innerHTML = `<article><a href="/reel/Creel/">r</a><video></video></article>`;
    const video = sized(document.querySelector("video")!);
    Object.defineProperty(video, "currentSrc", { value: "blob:https://www.instagram.com/x" });
    const store = new MediaStore();
    store.add([{ key: "/o1/r.mp4", type: "video", url: cdn("/o1/r.mp4"), shortcode: "Creel", source: "network" }]);
    expect(resolveElement(video, store)?.key).toBe("/o1/r.mp4");
  });

  it("vídeo sem link conhecido fica indisponível com explicação", () => {
    document.body.innerHTML = `<article><video></video></article>`;
    const video = sized(document.querySelector("video")!);
    Object.defineProperty(video, "currentSrc", { value: "blob:https://www.instagram.com/x" });
    expect(resolveElement(video, new MediaStore())?.unavailableReason).toBeTruthy();
  });
});

describe("rótulo do botão", () => {
  it("descreve tipo, resolução e posição no carrossel", () => {
    expect(
      describeItem({ key: "k", type: "image", url: "u", width: 1080, height: 1350, index: 2, source: "network" }),
    ).toBe("Baixar foto · 1080×1350 · item 2");
  });
});
