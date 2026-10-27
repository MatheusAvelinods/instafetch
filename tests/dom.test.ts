// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSrcset, scanDom } from "../src/content/dom";

function sized<T extends HTMLElement>(el: T, size: number): T {
  el.getBoundingClientRect = () => ({ width: size, height: size }) as DOMRect;
  return el;
}

describe("scanDom", () => {
  it("encontra imagens grandes, escolhe a maior do srcset e ignora avatares", () => {
    document.body.innerHTML = `
      <article>
        <a href="/p/Cpost1/">post</a>
        <img id="main" alt="Foto" src="https://a.cdninstagram.com/v/1_n.jpg?s=320"
          srcset="https://a.cdninstagram.com/v/1_n.jpg?s=640 640w, https://a.cdninstagram.com/v/1_n.jpg?s=1080 1080w" />
        <img id="avatar" alt="Foto do perfil de fulano" src="https://a.cdninstagram.com/v/p.jpg" />
        <img id="tiny" alt="" src="https://a.cdninstagram.com/v/t.jpg" />
        <img id="other" alt="" src="https://example.com/x.jpg" />
      </article>`;
    sized(document.getElementById("main")!, 400);
    sized(document.getElementById("avatar")!, 400);
    sized(document.getElementById("tiny")!, 32);
    sized(document.getElementById("other")!, 400);

    const items = scanDom(document);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "image", width: 1080, shortcode: "Cpost1", key: "/v/1_n.jpg" });
    expect(items[0].url).toContain("s=1080");
  });

  it("marca vídeos em streaming (blob) como indisponíveis", () => {
    document.body.innerHTML = `<article><a href="/reel/Creel1/">r</a><video poster="https://a.cdninstagram.com/v/poster.jpg"></video></article>`;
    const video = sized(document.querySelector("video")!, 500);
    Object.defineProperty(video, "currentSrc", { value: "blob:https://www.instagram.com/abc" });
    const [item] = scanDom(document);
    expect(item.type).toBe("video");
    expect(item.unavailableReason).toBeTruthy();
    expect(item.shortcode).toBe("Creel1");
  });
});

describe("parseSrcset", () => {
  it("lê URLs com vírgulas na query", () => {
    const list = parseSrcset("https://a.com/1.jpg?a=1,2 640w, https://a.com/2.jpg 1080w");
    expect(list).toEqual([
      { url: "https://a.com/1.jpg?a=1,2", width: 640 },
      { url: "https://a.com/2.jpg", width: 1080 },
    ]);
  });
});
